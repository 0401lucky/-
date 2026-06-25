package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"redemption/backend/internal/rankings"
)

type rankingHandlers struct {
	deps    Dependencies
	service *rankings.Service
}

func newRankingHandlers(deps Dependencies) rankingHandlers {
	return rankingHandlers{
		deps:    deps,
		service: rankings.NewService(deps.DB),
	}
}

func (handlers rankingHandlers) points(writer http.ResponseWriter, request *http.Request) {
	if !handlers.requireRankingUser(writer, request) {
		return
	}
	limit := parseRankingLimit(request, 20)
	data, err := handlers.service.PointsLeaderboard(request.Context(), request.URL.Query().Get("period"), limit)
	if err != nil {
		handlers.writeRankingError(writer, "查询积分排行榜失败", err, "积分排行榜服务暂时不可用，请稍后重试", "获取积分排行榜失败")
		return
	}
	writer.Header().Set("Cache-Control", privateRankingCacheControl)
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers rankingHandlers) games(writer http.ResponseWriter, request *http.Request) {
	if !handlers.requireRankingUser(writer, request) {
		return
	}
	limit := parseRankingLimit(request, 20)
	data, err := handlers.service.AllGamesLeaderboard(request.Context(), request.URL.Query().Get("period"), limit)
	if err != nil {
		handlers.writeRankingError(writer, "查询游戏排行榜失败", err, "游戏排行榜服务暂时不可用，请稍后重试", "获取游戏排行榜失败")
		return
	}
	writer.Header().Set("Cache-Control", privateRankingCacheControl)
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers rankingHandlers) checkinStreak(writer http.ResponseWriter, request *http.Request) {
	if !handlers.requireRankingUser(writer, request) {
		return
	}
	limit := parseRankingLimit(request, 20)
	data, err := handlers.service.CheckinStreakLeaderboard(request.Context(), request.URL.Query().Get("period"), limit)
	if err != nil {
		handlers.writeRankingError(writer, "查询签到排行榜失败", err, "签到排行榜服务暂时不可用，请稍后重试", "获取签到排行榜失败")
		return
	}
	writer.Header().Set("Cache-Control", privateRankingCacheControl)
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers rankingHandlers) history(writer http.ResponseWriter, request *http.Request) {
	if !handlers.requireRankingUser(writer, request) {
		return
	}
	query := request.URL.Query()
	var (
		data any
		err  error
	)
	if query.Get("mode") == "monthly-peaks" {
		data, err = handlers.service.MonthlyPeakHistory(
			request.Context(),
			parseRankingInt(query.Get("months"), 12, 1, 12),
			parseRankingInt(query.Get("limit"), 10, 1, 10),
		)
	} else {
		data, err = handlers.service.SettlementHistory(
			request.Context(),
			query.Get("period"),
			parseRankingInt(query.Get("page"), 1, 1, 1_000_000),
			parseRankingInt(query.Get("limit"), 20, 1, 50),
		)
	}
	if err != nil {
		handlers.writeRankingError(writer, "查询排行榜历史失败", err, "排行榜历史服务暂时不可用，请稍后重试", "获取排行榜结算历史失败")
		return
	}
	writer.Header().Set("Cache-Control", privateRankingCacheControl)
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers rankingHandlers) settle(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, rankingsSettleRateLimit) {
		return
	}

	var payload struct {
		Period       string          `json:"period"`
		TopN         json.RawMessage `json:"topN"`
		RewardPoints json.RawMessage `json:"rewardPoints"`
		DryRun       bool            `json:"dryRun"`
		RetryFailed  bool            `json:"retryFailed"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	result, err := handlers.service.SettleRankingPeriod(request.Context(), rankings.SettleInput{
		Period:           normalizeRankingSettlePeriod(payload.Period),
		OperatorID:       admin.ID,
		OperatorUsername: admin.Username,
		TopN:             parseOptionalRankingRawInt(payload.TopN),
		RewardPoints:     parseRankingRewardPoints(payload.RewardPoints),
		DryRun:           payload.DryRun,
		RetryFailed:      payload.RetryFailed,
	})
	if err != nil {
		if errors.Is(err, rankings.ErrUnavailable) {
			writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "排行榜结算服务暂时不可用"})
			return
		}
		if errors.Is(err, rankings.ErrSettlementInProgress) {
			writeJSON(writer, http.StatusConflict, map[string]any{"success": false, "message": "结算任务正在进行中，请稍后重试"})
			return
		}
		handlers.deps.Logger.Error("排行榜结算失败", "error", err)
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "排行榜结算失败"})
		return
	}

	message := "排行榜结算完成"
	if result.AlreadySettled {
		message = "当前周期已结算，返回历史结果"
	} else if result.Retried {
		message = "失败奖励重试完成"
	} else if payload.DryRun {
		message = "结算预演完成"
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": message, "data": result})
}

func (handlers rankingHandlers) requireRankingUser(writer http.ResponseWriter, request *http.Request) bool {
	_, ok := (economyHandlers{deps: handlers.deps}).requireUser(writer, request)
	return ok
}

func (handlers rankingHandlers) writeRankingError(writer http.ResponseWriter, logMessage string, err error, unavailableMessage string, fallbackMessage string) {
	if errors.Is(err, rankings.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": unavailableMessage,
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{
		"success": false,
		"message": fallbackMessage,
	})
}

func parseRankingLimit(request *http.Request, fallback int64) int64 {
	return parseRankingInt(request.URL.Query().Get("limit"), fallback, 1, 100)
}

func parseRankingInt(raw string, fallback int64, minValue int64, maxValue int64) int64 {
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func normalizeRankingSettlePeriod(raw string) rankings.SettlementPeriod {
	if raw == string(rankings.SettlementPeriodMonthly) {
		return rankings.SettlementPeriodMonthly
	}
	return rankings.SettlementPeriodWeekly
}

func parseOptionalRankingRawInt(raw json.RawMessage) int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return 0
	}
	var value int64
	if err := json.Unmarshal(raw, &value); err == nil {
		if value < 1 {
			return 0
		}
		if value > 100 {
			return 100
		}
		return value
	}
	var number float64
	if err := json.Unmarshal(raw, &number); err != nil {
		return 0
	}
	if number < 1 {
		return 0
	}
	if number > 100 {
		return 100
	}
	return int64(number)
}

func parseRankingRewardPoints(raw json.RawMessage) []int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var values []int64
	if err := json.Unmarshal(raw, &values); err == nil {
		return sanitizeRankingRewardPoints(values)
	}
	var floats []float64
	if err := json.Unmarshal(raw, &floats); err != nil {
		return nil
	}
	result := make([]int64, 0, len(floats))
	for _, value := range floats {
		if value >= 0 {
			result = append(result, int64(value))
		}
	}
	return sanitizeRankingRewardPoints(result)
}

func sanitizeRankingRewardPoints(values []int64) []int64 {
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value >= 0 {
			result = append(result, value)
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
