package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"redemption/backend/internal/cards"

	"github.com/go-chi/chi/v5"
)

type adminCardHandlers struct {
	deps    Dependencies
	service *cards.AdminService
}

type adminCardResetPayload struct {
	UserID json.RawMessage `json:"userId"`
}

type adminCardRewardPayload struct {
	AlbumID string          `json:"albumId"`
	TierID  string          `json:"tierId"`
	Reward  json.RawMessage `json:"reward"`
}

type adminCardRulesPatchPayload struct {
	RarityProbabilities map[cards.Rarity]float64 `json:"rarityProbabilities"`
	PityThresholds      map[cards.Rarity]int64   `json:"pityThresholds"`
	CardDrawPrice       *int64                   `json:"cardDrawPrice"`
	FragmentValues      map[cards.Rarity]int64   `json:"fragmentValues"`
	ExchangePrices      map[cards.Rarity]int64   `json:"exchangePrices"`
}

func newAdminCardHandlers(deps Dependencies) adminCardHandlers {
	return adminCardHandlers{
		deps:    deps,
		service: cards.NewAdminService(deps.DB),
	}
}

func (handlers adminCardHandlers) users(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	query := request.URL.Query()
	result, err := handlers.service.ListUsers(request.Context(), cards.AdminUserListInput{
		Page:   parsePositiveIntQuery(query.Get("page"), 1),
		Limit:  parsePositiveIntQuery(query.Get("limit"), 50),
		Search: query.Get("search"),
	})
	if err != nil {
		handlers.writeServiceError(writer, "查询后台卡牌用户列表失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"users":      adminCardUsersResponse(result.Users),
		"pagination": adminCardPaginationResponse(result.Pagination),
	})
}

func (handlers adminCardHandlers) userDetail(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	userID, ok := parseAdminCardUserID(writer, chi.URLParam(request, "userId"))
	if !ok {
		return
	}
	detail, err := handlers.service.GetUserDetail(request.Context(), userID)
	if err != nil {
		handlers.writeServiceError(writer, "查询后台用户卡牌详情失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    adminCardDetailResponse(detail),
	})
}

func (handlers adminCardHandlers) albums(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	config, err := handlers.service.GetRewardConfig(request.Context())
	if err != nil {
		handlers.writeServiceError(writer, "查询后台卡牌奖励配置失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"albums":  adminAlbumRewardsResponse(config.Albums),
		"tiers":   adminTierRewardsResponse(config.Tiers),
	})
}

func (handlers adminCardHandlers) updateReward(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminCardRewardPayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	reward, ok := parseAdminCardRewardValue(writer, payload.Reward)
	if !ok {
		return
	}
	config, err := handlers.service.UpdateReward(request.Context(), cards.AdminRewardUpdateInput{
		AlbumID: payload.AlbumID,
		TierID:  cards.RewardType(strings.TrimSpace(payload.TierID)),
		Reward:  reward,
	})
	if err != nil {
		handlers.writeServiceError(writer, "更新后台卡牌奖励配置失败", err)
		return
	}

	data := map[string]any{"reward": reward}
	message := "卡册奖励更新成功"
	if strings.TrimSpace(payload.TierID) != "" {
		data["tierId"] = strings.TrimSpace(payload.TierID)
		message = "稀有度奖励更新成功"
	} else {
		data["albumId"] = strings.TrimSpace(payload.AlbumID)
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": message,
		"data":    data,
		"albums":  adminAlbumRewardsResponse(config.Albums),
		"tiers":   adminTierRewardsResponse(config.Tiers),
	})
}

func (handlers adminCardHandlers) rules(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	rules, err := handlers.service.GetRules(request.Context())
	if err != nil {
		handlers.writeServiceError(writer, "查询后台卡牌规则失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    cardRulesResponse(rules),
	})
}

func (handlers adminCardHandlers) updateRules(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminCardRulesPatchPayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	rules, err := handlers.service.UpdateRules(request.Context(), cards.AdminRulesUpdateInput{
		RarityProbabilities: payload.RarityProbabilities,
		PityThresholds:      payload.PityThresholds,
		CardDrawPrice:       payload.CardDrawPrice,
		FragmentValues:      payload.FragmentValues,
		ExchangePrices:      payload.ExchangePrices,
	})
	if err != nil {
		handlers.writeServiceError(writer, "更新后台卡牌规则失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    cardRulesResponse(rules),
		"message": "卡牌规则已保存",
	})
}

func (handlers adminCardHandlers) reset(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminCardResetPayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	userID, ok := parseAdminCardResetUserID(writer, payload.UserID)
	if !ok {
		return
	}
	if err := handlers.service.ResetUserProgress(request.Context(), userID); err != nil {
		handlers.writeServiceError(writer, "重置后台用户卡牌进度失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "用户卡牌进度重置成功",
	})
}

func (handlers adminCardHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, cards.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "卡牌数据库未配置",
		})
		return
	}
	if errors.Is(err, cards.ErrInvalidAdminCardInput) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求参数无效",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}

func parseAdminCardResetUserID(writer http.ResponseWriter, raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "用户ID不能为空"})
		return 0, false
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "用户ID无效"})
		return 0, false
	}
	number, ok := numberFromJSONValue(value)
	if !ok || number <= 0 || number > float64(math.MaxInt64) || math.Trunc(number) != number {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "用户ID无效"})
		return 0, false
	}
	return int64(number), true
}

func parseAdminCardRewardValue(writer http.ResponseWriter, raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "奖励值无效"})
		return 0, false
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "奖励值无效"})
		return 0, false
	}
	number, ok := numberFromJSONValue(value)
	if !ok || number < 0 || number > float64(math.MaxInt64) || math.Trunc(number) != number {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "奖励值无效"})
		return 0, false
	}
	return int64(number), true
}

func parseAdminCardUserID(writer http.ResponseWriter, raw string) (int64, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "User ID required",
		})
		return 0, false
	}
	userID, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || userID <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "User ID invalid",
		})
		return 0, false
	}
	return userID, true
}

func adminCardUsersResponse(users []cards.AdminCardUser) []map[string]any {
	response := make([]map[string]any, 0, len(users))
	for _, user := range users {
		response = append(response, map[string]any{
			"id":             user.ID,
			"username":       user.Username,
			"firstSeen":      user.FirstSeen,
			"cardCount":      user.CardCount,
			"fragments":      user.Fragments,
			"drawsAvailable": user.DrawsAvailable,
			"pityCounter":    user.PityCounter,
		})
	}
	return response
}

func adminCardPaginationResponse(pagination cards.AdminPagination) map[string]any {
	return map[string]any{
		"page":       pagination.Page,
		"limit":      pagination.Limit,
		"total":      pagination.Total,
		"totalPages": pagination.TotalPages,
		"hasMore":    pagination.HasMore,
	}
}

func adminCardDetailResponse(detail cards.AdminUserCardDetail) map[string]any {
	return map[string]any{
		"inventory":         detail.Inventory,
		"fragments":         detail.Fragments,
		"pityCounter":       detail.PityCounter,
		"pityRare":          detail.PityRare,
		"pityEpic":          detail.PityEpic,
		"pityLegendary":     detail.PityLegendary,
		"pityLegendaryRare": detail.PityLegendaryRare,
		"drawsAvailable":    detail.DrawsAvailable,
		"collectionRewards": detail.CollectionRewards,
		"recentDraws":       detail.RecentDraws,
	}
}

func adminAlbumRewardsResponse(albums []cards.AdminAlbumReward) []map[string]any {
	response := make([]map[string]any, 0, len(albums))
	for _, album := range albums {
		response = append(response, map[string]any{
			"id":            album.ID,
			"name":          album.Name,
			"description":   album.Description,
			"season":        album.Season,
			"defaultReward": album.DefaultReward,
			"currentReward": album.CurrentReward,
		})
	}
	return response
}

func adminTierRewardsResponse(tiers []cards.AdminTierReward) []map[string]any {
	response := make([]map[string]any, 0, len(tiers))
	for _, tier := range tiers {
		response = append(response, map[string]any{
			"id":            tier.ID,
			"name":          tier.Name,
			"defaultReward": tier.DefaultReward,
			"currentReward": tier.CurrentReward,
		})
	}
	return response
}
