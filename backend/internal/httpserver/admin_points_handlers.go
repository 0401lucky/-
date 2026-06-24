package httpserver

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"redemption/backend/internal/economy"
)

func (handlers economyHandlers) getAdminUserPoints(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	query := request.URL.Query()
	userID, ok := parsePositiveInt64Query(writer, query.Get("userId"), "缺少 userId 参数", "userId 必须是正整数")
	if !ok {
		return
	}
	page := parseOptionalPositiveInt64(query.Get("page"), 1)
	limit := parseOptionalPositiveInt64(query.Get("limit"), 10)
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "积分管理数据库未配置",
		})
		return
	}

	data, err := handlers.service.GetAdminUserPoints(request.Context(), userID, page, limit)
	if err != nil {
		handlers.deps.Logger.Error("查询用户积分失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取积分信息失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers economyHandlers) adjustAdminUserPoints(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := handlers.requireAdmin(writer, request)
	if !ok {
		return
	}

	var payload struct {
		UserID      json.RawMessage `json:"userId"`
		Amount      json.RawMessage `json:"amount"`
		Description string          `json:"description"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}
	userID, ok := parsePositiveInt64Raw(writer, payload.UserID, "userId 必须是正整数")
	if !ok {
		return
	}
	amount, ok := parseSafeNonZeroInt64Raw(writer, payload.Amount, "amount 必须是非零整数")
	if !ok {
		return
	}
	if absInt64(amount) > 1_000_000 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "单次调整不能超过 1,000,000 积分",
		})
		return
	}
	if strings.TrimSpace(payload.Description) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请提供调整原因",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "积分管理数据库未配置",
		})
		return
	}

	result, mutation, err := handlers.service.AdjustAdminUserPoints(request.Context(), *admin, economy.AdminPointsAdjustmentInput{
		UserID:      userID,
		Amount:      amount,
		Description: payload.Description,
	})
	if err != nil {
		handlers.deps.Logger.Error("管理员积分调整失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "积分调整失败",
		})
		return
	}
	if !mutation.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": mutation.Message,
		})
		return
	}

	message := "已增加 " + strconv.FormatInt(amount, 10) + " 积分"
	if amount < 0 {
		message = "已扣除 " + strconv.FormatInt(-amount, 10) + " 积分"
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": message,
		"data":    result,
	})
}

func parsePositiveInt64Query(writer http.ResponseWriter, raw string, missingMessage string, invalidMessage string) (int64, bool) {
	if strings.TrimSpace(raw) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": missingMessage})
		return 0, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": invalidMessage})
		return 0, false
	}
	return value, true
}

func parseOptionalPositiveInt64(raw string, fallback int64) int64 {
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func parsePositiveInt64Raw(writer http.ResponseWriter, raw json.RawMessage, message string) (int64, bool) {
	value, ok := parseJSONInt64Value(raw)
	if !ok || value <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
		return 0, false
	}
	return value, true
}

func parseSafeNonZeroInt64Raw(writer http.ResponseWriter, raw json.RawMessage, message string) (int64, bool) {
	value, ok := parseJSONInt64Value(raw)
	if !ok || value == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
		return 0, false
	}
	return value, true
}

func parseJSONInt64Value(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	valueText := strings.TrimSpace(string(raw))
	if strings.HasPrefix(valueText, `"`) {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return 0, false
		}
		valueText = strings.TrimSpace(text)
	}
	value, err := strconv.ParseInt(valueText, 10, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}

func absInt64(value int64) int64 {
	const minInt64 = -1 << 63
	if value == minInt64 {
		return 1<<63 - 1
	}
	if value < 0 {
		return -value
	}
	return value
}
