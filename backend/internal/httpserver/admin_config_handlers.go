package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"

	"redemption/backend/internal/systemconfig"
)

type adminConfigHandlers struct {
	deps    Dependencies
	service *systemconfig.Service
}

func newAdminConfigHandlers(deps Dependencies) adminConfigHandlers {
	return adminConfigHandlers{
		deps:    deps,
		service: systemconfig.NewService(deps.DB),
	}
}

func (handlers adminConfigHandlers) get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	config, err := handlers.service.Get(request.Context())
	if errors.Is(err, systemconfig.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "系统配置数据库未配置"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询系统配置失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "config": config})
}

func (handlers adminConfigHandlers) update(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	var payload struct {
		DailyPointsLimit      json.RawMessage `json:"dailyPointsLimit"`
		DailyWithdrawLimit    json.RawMessage `json:"dailyWithdrawLimit"`
		VIPDailyWithdrawLimit json.RawMessage `json:"vipDailyWithdrawLimit"`
		VIPPricePoints        json.RawMessage `json:"vipPricePoints"`
		VIPDurationDays       json.RawMessage `json:"vipDurationDays"`
		VIPWithdrawFeePercent json.RawMessage `json:"vipWithdrawFeePercent"`
		VIPDailyLotterySpins  json.RawMessage `json:"vipDailyLotterySpins"`
		VIPMaxTotalDays       json.RawMessage `json:"vipMaxTotalDays"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	fields := []adminConfigField{
		{raw: payload.DailyPointsLimit, valid: systemconfig.ValidDailyPointsLimit, message: "每日积分上限必须在 100 - 100000 之间"},
		{raw: payload.DailyWithdrawLimit, valid: systemconfig.ValidDailyWithdrawLimit, message: "普通用户每日提现次数必须在 1 - 100 之间"},
		{raw: payload.VIPDailyWithdrawLimit, valid: systemconfig.ValidVIPDailyWithdrawLimit, message: "VIP 每日提现次数必须在 1 - 100 之间"},
		{raw: payload.VIPPricePoints, valid: systemconfig.ValidVIPPricePoints, message: "月卡价格必须在 1 - 1000000 积分之间"},
		{raw: payload.VIPDurationDays, valid: systemconfig.ValidVIPDurationDays, message: "月卡时长必须在 1 - 365 天之间"},
		{raw: payload.VIPWithdrawFeePercent, valid: systemconfig.ValidVIPWithdrawFeePercent, message: "VIP 手续费百分比必须在 0 - 100 之间"},
		{raw: payload.VIPDailyLotterySpins, valid: systemconfig.ValidVIPDailyLotterySpins, message: "VIP 每日赠送抽奖次数必须在 0 - 50 之间"},
		{raw: payload.VIPMaxTotalDays, valid: systemconfig.ValidVIPMaxTotalDays, message: "VIP 累计时长上限必须在 1 - 3650 天之间"},
	}
	values := make([]int64, len(fields))
	for index, field := range fields {
		value, ok := parseAdminConfigField(writer, field)
		if !ok {
			return
		}
		values[index] = value
	}

	// 跨字段：上限低于月卡时长时，用户第一次购买就会被拒，功能直接不可用
	if !systemconfig.ValidVIPDurationAgainstMaxTotal(values[4], values[7]) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "VIP 累计时长上限不能小于月卡时长",
		})
		return
	}

	config, err := handlers.service.Update(request.Context(), systemconfig.UpdateInput{
		DailyPointsLimit:      &values[0],
		DailyWithdrawLimit:    &values[1],
		VIPDailyWithdrawLimit: &values[2],
		VIPPricePoints:        &values[3],
		VIPDurationDays:       &values[4],
		VIPWithdrawFeePercent: &values[5],
		VIPDailyLotterySpins:  &values[6],
		VIPMaxTotalDays:       &values[7],
		UpdatedBy:             admin.Username,
	})
	if errors.Is(err, systemconfig.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "系统配置数据库未配置"})
		return
	}
	if errors.Is(err, systemconfig.ErrInvalid) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "配置取值非法，请检查各项范围"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("更新系统配置失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "config": config, "message": "配置已更新"})
}

type adminConfigField struct {
	raw     json.RawMessage
	valid   func(int64) bool
	message string
}

// parseAdminConfigField 解析并校验单个配置字段。
// 缺失字段一律报错而不是回落默认值：systemconfig.Update 的 nil 语义是「重置为默认值」，
// 静默重置管理员没填的字段比直接报错危险得多。
func parseAdminConfigField(writer http.ResponseWriter, field adminConfigField) (int64, bool) {
	value, ok := parseJSONInt64Value(field.raw)
	if !ok || !field.valid(value) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": field.message,
		})
		return 0, false
	}
	return value, true
}
