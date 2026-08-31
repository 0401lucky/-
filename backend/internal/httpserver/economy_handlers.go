package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"
	"redemption/backend/internal/platform/newapi"
)

type economyHandlers struct {
	deps    Dependencies
	service *economy.Service
}

func newEconomyHandlers(deps Dependencies) economyHandlers {
	return economyHandlers{
		deps:    deps,
		service: economy.NewServiceWithWalletDeps(deps.DB, deps.Redis, newWalletQuotaClient(deps)),
	}
}

func newWalletQuotaClient(deps Dependencies) economy.WalletQuotaClient {
	if deps.Config.NewAPIURL == "" &&
		deps.Config.NewAPIAdminAccessToken == "" &&
		deps.Config.NewAPIAdminUserID == "" &&
		deps.Config.NewAPIAdminUsername == "" &&
		deps.Config.NewAPIAdminPassword == "" {
		return nil
	}

	client, err := newapi.New(newapi.Options{
		BaseURL:          deps.Config.NewAPIURL,
		AdminAccessToken: deps.Config.NewAPIAdminAccessToken,
		AdminUserID:      deps.Config.NewAPIAdminUserID,
		AdminUsername:    deps.Config.NewAPIAdminUsername,
		AdminPassword:    deps.Config.NewAPIAdminPassword,
	})
	if err != nil {
		deps.Logger.Warn("new-api 管理端配置无效，钱包充值/提现接口将返回 503", "error", err)
		return nil
	}
	return client
}

func (handlers economyHandlers) getPoints(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	summary, err := handlers.service.GetPointsSummary(request.Context(), *user, 20)
	if err != nil {
		handlers.deps.Logger.Error("查询积分失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    summary,
	})
}

func (handlers economyHandlers) getStore(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	data, err := handlers.service.GetStoreHome(request.Context(), *user)
	if err != nil {
		handlers.deps.Logger.Error("查询商城失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers economyHandlers) exchangeItem(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		ItemID         string `json:"itemId"`
		Quantity       *int64 `json:"quantity"`
		IdempotencyKey string `json:"idempotencyKey"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}

	quantity := int64(1)
	if payload.Quantity != nil {
		quantity = *payload.Quantity
	}
	idempotencyKey := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(request.Header.Get("X-Idempotency-Key"))
	}
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(payload.IdempotencyKey)
	}

	result, err := handlers.service.ExchangeItem(request.Context(), *user, economy.ExchangeInput{
		ItemID:         payload.ItemID,
		Quantity:       quantity,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		handlers.deps.Logger.Error("商城兑换失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success": result.Success,
		"message": result.Message,
		"data": map[string]any{
			"log":             result.Log,
			"newBalance":      result.Balance,
			"drawsAvailable":  result.DrawsAvailable,
			"rewardAssetKind": result.RewardAssetKind,
		},
	})
}

func (handlers economyHandlers) getTopupBalance(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeBalanceRateLimit) {
		return
	}

	balance, err := handlers.service.GetWalletQuotaBalance(request.Context(), *user)
	if err != nil {
		handlers.writeWalletServiceError(writer, "查询 new-api 余额失败", err)
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "ok",
		"data": map[string]any{
			"newApiQuota":               balance.Quota,
			"newApiUsedQuota":           balance.UsedQuota,
			"newApiBalanceDollars":      balance.BalanceDollars,
			"newApiBalanceWholeDollars": balance.BalanceWholeDollars,
			"quotaPerDollar":            newapi.QuotaPerDollar,
		},
	})
}

func (handlers economyHandlers) topupWallet(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Dollars float64 `json:"dollars"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	if !isFinitePositive(payload.Dollars) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "充值金额必须为正数"})
		return
	}
	if payload.Dollars < float64(economy.MinTopupDollars) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "最低充值 $1"})
		return
	}

	result, err := handlers.service.ExecuteTopup(request.Context(), *user, payload.Dollars)
	if err != nil {
		handlers.writeWalletServiceError(writer, "账户额度充值失败", err)
		return
	}

	balance := handlers.currentPointsBalance(request, *user, result.Balance)
	status := http.StatusOK
	success := result.Success || result.Uncertain
	if !success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success":   success,
		"message":   result.Message,
		"uncertain": result.Uncertain,
		"data": map[string]any{
			"newBalance":                balance,
			"pointsGained":              result.PointsGained,
			"newApiBalanceDollars":      result.NewAPIBalanceDollars,
			"newApiBalanceWholeDollars": result.NewAPIBalanceWholeDollars,
		},
	})
}

func (handlers economyHandlers) withdrawWallet(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		Points float64 `json:"points"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	if !isPositiveInteger(payload.Points) || payload.Points > float64(math.MaxInt64) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "积分数量必须为正整数"})
		return
	}
	points := int64(payload.Points)
	if points < economy.MinWithdrawPoints {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "最低提现 10 积分"})
		return
	}

	result, err := handlers.service.ExecuteWithdraw(request.Context(), *user, points)
	if err != nil {
		handlers.writeWalletServiceError(writer, "积分提现失败", err)
		return
	}

	balance := handlers.currentPointsBalance(request, *user, result.Balance)
	status := http.StatusOK
	success := result.Success || result.Uncertain
	if !success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success":   success,
		"message":   result.Message,
		"code":      result.Code,
		"uncertain": result.Uncertain,
		"data": map[string]any{
			"newBalance":         balance,
			"dollars":            result.Dollars,
			"feePoints":          result.FeePoints,
			"dailyWithdrawUsed":  result.DailyWithdrawUsed,
			"dailyWithdrawLimit": result.DailyWithdrawLimit,
		},
	})
}

func (handlers economyHandlers) getWallet(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	overview, err := handlers.service.GetWalletOverview(request.Context(), user.ID)
	if err != nil {
		handlers.deps.Logger.Error("查询钱包概览失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    overview,
	})
}

func (handlers economyHandlers) listWalletTransactions(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	limit := parsePositiveQueryInt(request, "limit", 20, 100)
	offset := parsePositiveQueryInt(request, "offset", 0, math.MaxInt32)

	transactions, total, err := handlers.service.ListWalletTransactions(request.Context(), user.ID, limit, offset)
	if err != nil {
		handlers.deps.Logger.Error("查询钱包流水失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"transactions": transactions,
			"total":        total,
			"limit":        limit,
			"offset":       offset,
			"hasMore":      int64(offset+len(transactions)) < total,
		},
	})
}

func (handlers economyHandlers) purchaseVIP(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.rejectRateLimited(writer, request, *user, storeExchangeRateLimit) {
		return
	}

	var payload struct {
		IdempotencyKey string `json:"idempotencyKey"`
	}
	// 空请求体也视为合法：幂等键可以只走请求头
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}

	// 三重取值顺序与 exchangeItem 保持一致
	idempotencyKey := strings.TrimSpace(request.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(request.Header.Get("X-Idempotency-Key"))
	}
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(payload.IdempotencyKey)
	}
	// 幂等键必须由客户端提供：beginIdempotency 在 key 为空时直接放行（不做去重），
	// 一次网络重试就会重复扣掉一个周期的 VIP 积分。handler 自己补一个也没用 ——
	// 重试会带上新的 key，幂等性照样失效。因此这里拒绝请求而不是兜底生成。
	if idempotencyKey == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"code":    "IDEMPOTENCY_KEY_REQUIRED",
			"message": "缺少幂等键，请重试",
		})
		return
	}

	result, err := handlers.service.PurchaseVIP(request.Context(), *user, idempotencyKey)
	if err != nil {
		handlers.deps.Logger.Error("购买 VIP 失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "服务器错误",
		})
		return
	}

	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success": result.Success,
		"message": result.Message,
		"code":    result.Code,
		"data": map[string]any{
			"newBalance":  result.Balance,
			"expiresAt":   result.ExpiresAt,
			"daysAdded":   result.DaysAdded,
			"pointsSpent": result.PointsSpent,
		},
	})
}

// parsePositiveQueryInt 解析非负整数查询参数，缺失或非法时回落到 fallback，并夹到 max。
func parsePositiveQueryInt(request *http.Request, name string, fallback int, max int) int {
	raw := strings.TrimSpace(request.URL.Query().Get(name))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func (handlers economyHandlers) requireUser(writer http.ResponseWriter, request *http.Request) (*auth.User, bool) {
	return userFromRequestWithRevocation(handlers.deps, writer, request)
}

func (handlers economyHandlers) currentPointsBalance(request *http.Request, user auth.User, fallback int64) int64 {
	summary, err := handlers.service.GetPointsSummary(request.Context(), user, 1)
	if err != nil {
		handlers.deps.Logger.Warn("查询钱包操作后的积分余额失败", "error", err)
		return fallback
	}
	return summary.Balance
}

func (handlers economyHandlers) writeWalletServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, economy.ErrWalletQuotaClientUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"code":    "NEW_API_NOT_CONFIGURED",
			"message": "new-api 管理端未配置，暂时不能处理充值/提现",
		})
		return
	}
	if errors.Is(err, economy.ErrWalletLockUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"code":    "WALLET_LOCK_UNAVAILABLE",
			"message": "钱包操作锁不可用，请稍后再试",
		})
		return
	}
	if errors.Is(err, newapi.ErrAdminAuthFailed) {
		handlers.deps.Logger.Error(logMessage, "error", err)
		writeJSON(writer, http.StatusBadGateway, map[string]any{
			"success": false,
			"code":    "NEW_API_AUTH_FAILED",
			"message": "new-api 管理端鉴权失败：请检查 NEW_API_ADMIN_ACCESS_TOKEN 是否为管理员的系统访问令牌，以及 NEW_API_ADMIN_USER_ID 是否为该管理员的数字用户 ID",
		})
		return
	}

	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{
		"success": false,
		"message": "服务器错误",
	})
}

func isFinitePositive(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0
}

func isPositiveInteger(value float64) bool {
	return isFinitePositive(value) && value == math.Trunc(value)
}
