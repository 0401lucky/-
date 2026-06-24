package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"

	"redemption/backend/internal/eco"
)

type ecoHandlers struct {
	deps    Dependencies
	service *eco.Service
}

const privateRankingCacheControl = "private, max-age=15, stale-while-revalidate=45"

func newEcoHandlers(deps Dependencies) ecoHandlers {
	return ecoHandlers{
		deps:    deps,
		service: eco.NewService(deps.DB),
	}
}

func (handlers ecoHandlers) collectTrash(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, ecoCollectRateLimit) {
		return
	}
	drags, ok := parseEcoCollectDrags(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.CollectTrash(request.Context(), eco.CollectInput{
		UserID: user.ID,
		Drags:  drags,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动回收失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动回收后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"cleared":       result.Cleared,
			"pointsEarned":  result.PointsEarned,
			"status":        status,
			"balance":       result.Balance,
			"pending":       result.Pending,
			"pointBuffer":   result.PointBuffer,
			"gloveUsesLeft": result.GloveUsesLeft,
			"autoCollected": result.AutoCollected,
		},
	})
}

func (handlers ecoHandlers) getStatus(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.deps.Logger.Error("查询环保行动状态失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
	})
}

func (handlers ecoHandlers) getTrashLeaderboard(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireUser(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保排行榜服务暂时不可用，请稍后重试",
		})
		return
	}

	query := request.URL.Query()
	limit := int64(20)
	if rawLimit := query.Get("limit"); rawLimit != "" {
		if parsed, err := strconv.ParseInt(rawLimit, 10, 64); err == nil {
			limit = parsed
		}
	}
	data, err := handlers.service.GetTrashLeaderboard(request.Context(), query.Get("period"), limit, 0)
	if err != nil {
		handlers.deps.Logger.Error("查询环保排行榜失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取环保排行榜失败",
		})
		return
	}
	writer.Header().Set("Cache-Control", privateRankingCacheControl)
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers ecoHandlers) getAdminOverview(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保管理数据库未配置",
		})
		return
	}

	query := request.URL.Query()
	trashPage := int64(1)
	if rawPage := query.Get("trashPage"); rawPage == "" {
		if rawPage = query.Get("page"); rawPage != "" {
			if parsed, err := strconv.ParseInt(rawPage, 10, 64); err == nil && parsed > 0 {
				trashPage = parsed
			}
		}
	} else if parsed, err := strconv.ParseInt(rawPage, 10, 64); err == nil && parsed > 0 {
		trashPage = parsed
	}

	data, err := handlers.service.GetAdminOverview(request.Context(), eco.AdminOverviewInput{
		TrashPage:  trashPage,
		TrashLimit: 10,
	})
	if err != nil {
		handlers.deps.Logger.Error("查询环保管理数据失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取环保管理数据失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers ecoHandlers) updateAdminSettings(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保管理数据库未配置",
		})
		return
	}

	var payload struct {
		PrizeRates map[string]json.RawMessage `json:"prizeRates"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请提交奖品概率配置",
		})
		return
	}
	patch, ok := parseEcoPrizeRatePatch(writer, payload.PrizeRates)
	if !ok {
		return
	}
	prizes, err := handlers.service.UpdatePrizeRateSettings(request.Context(), patch)
	if err != nil {
		if errors.Is(err, eco.ErrInvalidPrizeRateSettings) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{
				"success": false,
				"message": err.Error(),
			})
			return
		}
		handlers.deps.Logger.Error("保存环保奖品概率失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "保存环保奖品概率失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"prizes": prizes,
		},
	})
}

func (handlers ecoHandlers) buy(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Type string `json:"type"`
		Key  string `json:"key"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.Type != "upgrade" && payload.Type != "item" || payload.Key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}
	if payload.Type == "item" {
		handlers.buyItem(writer, request, user.ID, payload.Key)
		return
	}

	result, err := handlers.service.BuyUpgrade(request.Context(), eco.BuyUpgradeInput{
		UserID: user.ID,
		Key:    payload.Key,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动升级购买失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动升级后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"status":  status,
			"balance": result.Balance,
			"key":     result.Key,
			"level":   result.Level,
			"cost":    result.Cost,
		},
	})
}

func (handlers ecoHandlers) buyItem(writer http.ResponseWriter, request *http.Request, userID int64, key string) {
	result, err := handlers.service.BuyItem(request.Context(), eco.BuyItemInput{
		UserID: userID,
		Key:    key,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动道具购买失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), userID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动道具购买后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"status":         status,
			"balance":        result.Balance,
			"key":            result.Key,
			"cost":           result.Cost,
			"purchasedToday": result.PurchasedToday,
			"remainingToday": result.RemainingToday,
		},
	})
}

func (handlers ecoHandlers) claimPrize(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, ecoGameActionRateLimit) {
		return
	}

	var payload struct {
		PrizeID    string `json:"prizeId"`
		MakePublic bool   `json:"makePublic"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.PrizeID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.ClaimPrize(request.Context(), eco.ClaimPrizeInput{
		UserID:     user.ID,
		PrizeID:    payload.PrizeID,
		MakePublic: payload.MakePublic,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动领取奖品失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动领取奖品后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"prizeKey": result.PrizeKey,
			"status":   status,
		},
	})
}

func (handlers ecoHandlers) stealPrize(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, ecoGameActionRateLimit) {
		return
	}

	var payload struct {
		EntryID string `json:"entryId"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.EntryID == "" || payload.Message == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.StealPublicPrize(request.Context(), eco.StealPublicPrizeInput{
		UserID:  user.ID,
		EntryID: payload.EntryID,
		Message: payload.Message,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动偷盗失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.deps.Logger.Error("环保行动偷盗后查询状态失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"status": status,
		},
	})
}

func (handlers ecoHandlers) sellPrize(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Key      string   `json:"key"`
		Quantity *float64 `json:"quantity"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.Key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	quantity := int64(1)
	if payload.Quantity != nil {
		if math.IsNaN(*payload.Quantity) || math.IsInf(*payload.Quantity, 0) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{
				"success": false,
				"message": "出售数量无效",
			})
			return
		}
		quantity = int64(math.Floor(*payload.Quantity))
	}
	if quantity <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "出售数量无效",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.SellPrize(request.Context(), eco.SellPrizeInput{
		UserID:   user.ID,
		Key:      payload.Key,
		Quantity: quantity,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动出售奖品失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动出售奖品后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"prizeKey":     result.PrizeKey,
			"quantitySold": result.QuantitySold,
			"price":        result.Price,
			"pointsEarned": result.PointsEarned,
			"status":       status,
		},
	})
}

func (handlers ecoHandlers) merchantSellPrize(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.Key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.SellPrizeToMerchant(request.Context(), eco.SellPrizeToMerchantInput{
		UserID: user.ID,
		Key:    payload.Key,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动商人收购失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动商人收购后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"prizeKey":     result.PrizeKey,
			"quantitySold": result.QuantitySold,
			"price":        result.Price,
			"pointsEarned": result.PointsEarned,
			"status":       status,
		},
	})
}

func (handlers ecoHandlers) blackMarketSellPrize(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if payload.Key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "参数错误",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "环保行动数据库未配置",
		})
		return
	}

	result, err := handlers.service.SellStolenPrize(request.Context(), eco.SellStolenPrizeInput{
		UserID: user.ID,
		Key:    payload.Key,
	})
	if err != nil {
		handlers.deps.Logger.Error("环保行动黑市出售失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": result.Message,
		})
		return
	}

	var status any
	if nextStatus, err := handlers.service.GetStatus(request.Context(), user.ID, 0); err != nil {
		handlers.deps.Logger.Warn("环保行动黑市出售后查询状态失败", "error", err)
	} else {
		status = nextStatus
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"prizeKey":     result.PrizeKey,
			"quantitySold": result.QuantitySold,
			"price":        result.Price,
			"pointsEarned": result.PointsEarned,
			"status":       status,
		},
	})
}

func parseEcoCollectDrags(writer http.ResponseWriter, request *http.Request) (int64, bool) {
	var payload struct {
		Drags *float64 `json:"drags"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		if errors.Is(err, io.EOF) {
			return 1, true
		}
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return 0, false
	}
	if payload.Drags == nil {
		return 1, true
	}
	if math.IsNaN(*payload.Drags) || math.IsInf(*payload.Drags, 0) || *payload.Drags <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "无效的回收次数",
		})
		return 0, false
	}
	drags := int64(math.Floor(*payload.Drags))
	if drags <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "无效的回收次数",
		})
		return 0, false
	}
	if drags > eco.MaxDragsPerRequest {
		return eco.MaxDragsPerRequest, true
	}
	return drags, true
}

func parseEcoPrizeRatePatch(writer http.ResponseWriter, raw map[string]json.RawMessage) (map[string]float64, bool) {
	if len(raw) == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请提交奖品概率配置",
		})
		return nil, false
	}
	patch := make(map[string]float64, len(raw))
	for key, value := range raw {
		if len(value) == 0 || string(value) == "null" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{
				"success": false,
				"message": "奖品概率必须是数字",
			})
			return nil, false
		}
		var number float64
		if err := json.Unmarshal(value, &number); err != nil {
			var text string
			if err := json.Unmarshal(value, &text); err != nil {
				writeJSON(writer, http.StatusBadRequest, map[string]any{
					"success": false,
					"message": "奖品概率必须是数字",
				})
				return nil, false
			}
			parsed, err := strconv.ParseFloat(text, 64)
			if err != nil {
				writeJSON(writer, http.StatusBadRequest, map[string]any{
					"success": false,
					"message": "奖品概率必须是数字",
				})
				return nil, false
			}
			number = parsed
		}
		patch[key] = number
	}
	return patch, true
}
