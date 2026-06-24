package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"

	"redemption/backend/internal/cards"
)

type cardHandlers struct {
	deps    Dependencies
	store   *cards.Store
	service *cards.Service
}

func newCardHandlers(deps Dependencies) cardHandlers {
	return cardHandlers{
		deps:    deps,
		store:   cards.NewStore(deps.DB),
		service: cards.NewService(deps.DB),
	}
}

func (handlers cardHandlers) inventory(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, cardsReadRateLimit) {
		return
	}

	state, err := handlers.store.GetUserState(request.Context(), user.ID)
	if err != nil {
		handlers.writeServiceError(writer, "查询卡牌库存失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    cardStateResponse(state),
	})
}

func (handlers cardHandlers) rules(writer http.ResponseWriter, request *http.Request) {
	rules, err := handlers.store.GetRules(request.Context())
	if err != nil {
		handlers.writeServiceError(writer, "查询卡牌规则失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    cardRulesResponse(rules),
	})
}

func (handlers cardHandlers) draw(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, cardsDrawRateLimit) {
		return
	}

	var payload struct {
		Count float64 `json:"count"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = struct {
			Count float64 `json:"count"`
		}{}
	}
	count := normalizeCardDrawCount(payload.Count)

	result, err := handlers.service.ExecuteDraws(request.Context(), cards.DrawCardsInput{
		UserID:  user.ID,
		Count:   count,
		Catalog: cards.AllCards(),
	})
	if err != nil {
		handlers.writeServiceError(writer, "卡牌抽卡失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success":        false,
			"message":        result.Message,
			"drawsAvailable": result.DrawsAvailable,
		})
		return
	}

	if count == 1 {
		first := result.Results[0]
		data := drawResultResponse(first)
		data["success"] = true
		data["drawsAvailable"] = result.DrawsAvailable
		writeJSON(writer, http.StatusOK, map[string]any{
			"success": true,
			"data":    data,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"success":        true,
			"cards":          drawResultsResponse(result.Results),
			"count":          len(result.Results),
			"drawsAvailable": result.DrawsAvailable,
		},
	})
}

func (handlers cardHandlers) exchange(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, cardsExchangeRateLimit) {
		return
	}

	var payload struct {
		CardID string `json:"cardId"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}
	cardID := strings.TrimSpace(payload.CardID)
	if cardID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "无效的卡片 ID",
		})
		return
	}

	result, err := handlers.service.ExecuteFragmentExchange(request.Context(), cards.FragmentExchangeInput{
		UserID:  user.ID,
		CardID:  cardID,
		Catalog: cards.AllCards(),
	})
	if err != nil {
		handlers.writeServiceError(writer, "卡牌碎片兑换失败", err)
		return
	}
	if !result.Success {
		message := result.Message
		if message == "" {
			message = "兑换失败"
		}
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": message,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "兑换成功",
	})
}

func (handlers cardHandlers) claimReward(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, cardsClaimRewardRateLimit) {
		return
	}

	var payload struct {
		RewardType string `json:"rewardType"`
		AlbumID    string `json:"albumId"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}
	rewardType, ok := parseCardRewardType(payload.RewardType)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "无效的奖励类型",
		})
		return
	}
	albumID := strings.TrimSpace(payload.AlbumID)
	if !cards.AlbumExists(albumID) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "无效的卡册ID",
		})
		return
	}
	pointsAwarded, ok := cards.RewardPoints(albumID, rewardType)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "奖励积分配置异常",
		})
		return
	}

	result, err := handlers.service.ExecuteRewardClaim(request.Context(), cards.RewardClaimServiceInput{
		UserID:        user.ID,
		AlbumID:       albumID,
		RewardType:    rewardType,
		PointsAwarded: pointsAwarded,
		Catalog:       cards.AllCards(),
	})
	if err != nil {
		handlers.writeServiceError(writer, "卡牌奖励领取失败", err)
		return
	}
	if !result.Success {
		message := result.Message
		if message == "" {
			message = "领取奖励失败"
		}
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": message,
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success":       true,
		"pointsAwarded": result.PointsAwarded,
		"newBalance":    result.NewBalance,
	})
}

func (handlers cardHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, cards.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "卡牌数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}

func parseCardRewardType(value string) (cards.RewardType, bool) {
	switch cards.RewardType(strings.TrimSpace(value)) {
	case cards.RewardType(cards.RarityCommon):
		return cards.RewardType(cards.RarityCommon), true
	case cards.RewardType(cards.RarityRare):
		return cards.RewardType(cards.RarityRare), true
	case cards.RewardType(cards.RarityEpic):
		return cards.RewardType(cards.RarityEpic), true
	case cards.RewardType(cards.RarityLegendary):
		return cards.RewardType(cards.RarityLegendary), true
	case cards.RewardType(cards.RarityLegendaryRare):
		return cards.RewardType(cards.RarityLegendaryRare), true
	case cards.RewardFullSet:
		return cards.RewardFullSet, true
	default:
		return "", false
	}
}

func normalizeCardDrawCount(value float64) int {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 1 {
		return 1
	}
	if value > 10 {
		return 10
	}
	return int(math.Floor(value))
}

func drawResultsResponse(results []cards.DrawResult) []map[string]any {
	response := make([]map[string]any, 0, len(results))
	for _, result := range results {
		response = append(response, drawResultResponse(result))
	}
	return response
}

func drawResultResponse(result cards.DrawResult) map[string]any {
	payload := map[string]any{
		"card":        result.Card,
		"isDuplicate": result.IsDuplicate,
	}
	if result.FragmentsAdded > 0 {
		payload["fragmentsAdded"] = result.FragmentsAdded
	}
	return payload
}

func cardStateResponse(state cards.UserState) map[string]any {
	return map[string]any{
		"inventory":         state.Inventory,
		"fragments":         state.Fragments,
		"pityCounter":       state.PityLegendaryRare,
		"pityRare":          state.PityRare,
		"pityEpic":          state.PityEpic,
		"pityLegendary":     state.PityLegendary,
		"pityLegendaryRare": state.PityLegendaryRare,
		"drawsAvailable":    state.DrawsAvailable,
		"collectionRewards": state.CollectionRewards,
		"recentDraws":       state.RecentDraws,
	}
}

func cardRulesResponse(rules cards.Rules) map[string]any {
	return map[string]any{
		"rarityProbabilities": rules.RarityProbabilities,
		"pityThresholds":      rules.PityThresholds,
		"cardDrawPrice":       rules.CardDrawPrice,
		"fragmentValues":      rules.FragmentValues,
		"exchangePrices":      rules.ExchangePrices,
		"updatedAt":           rules.UpdatedAtMs,
	}
}
