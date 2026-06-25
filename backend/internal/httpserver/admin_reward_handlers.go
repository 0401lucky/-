package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"redemption/backend/internal/economy"
	"redemption/backend/internal/rewards"

	"github.com/go-chi/chi/v5"
)

type adminRewardHandlers struct {
	deps    Dependencies
	service *rewards.Service
}

func newAdminRewardHandlers(deps Dependencies) adminRewardHandlers {
	return adminRewardHandlers{
		deps:    deps,
		service: rewards.NewService(deps.DB, economy.NewService(deps.DB), nil),
	}
}

func (handlers adminRewardHandlers) list(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, adminRewardsRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "奖励数据库未配置",
		})
		return
	}

	query := request.URL.Query()
	result, err := handlers.service.ListRewardBatches(
		request.Context(),
		parseOptionalPositiveInt64(query.Get("page"), 1),
		parseOptionalPositiveInt64(query.Get("limit"), 20),
	)
	if err != nil {
		handlers.deps.Logger.Error("查询后台奖励批次失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取发放记录失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    result,
	})
}

func (handlers adminRewardHandlers) create(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, adminRewardsRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "奖励数据库未配置",
		})
		return
	}

	var payload struct {
		Type          string          `json:"type"`
		Amount        json.RawMessage `json:"amount"`
		TargetMode    string          `json:"targetMode"`
		TargetUserIDs []int64         `json:"targetUserIds"`
		Title         string          `json:"title"`
		Message       string          `json:"message"`
	}
	decoder := json.NewDecoder(request.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}

	amount, ok := parseAdminRewardAmount(payload.Amount)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "奖励数量必须为正数",
		})
		return
	}
	batch, err := handlers.service.CreateAndDistributeRewardBatch(request.Context(), rewards.CreateRewardBatchInput{
		Type:          payload.Type,
		Amount:        amount,
		TargetMode:    payload.TargetMode,
		TargetUserIDs: payload.TargetUserIDs,
		Title:         payload.Title,
		Message:       payload.Message,
		CreatedBy:     admin.Username,
	})
	if err != nil {
		handlers.writeAdminRewardError(writer, err, "发放失败")
		return
	}

	message := "奖励发放完成"
	if batch.Status != "completed" {
		message = "奖励发放已完成（部分失败：" + strconv.FormatInt(batch.TotalTargets-batch.DistributedCount, 10) + "）"
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success": true,
		"message": message,
		"data":    batch,
	})
}

func (handlers adminRewardHandlers) detail(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, adminRewardsRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "奖励数据库未配置",
		})
		return
	}

	batch, err := handlers.service.GetRewardBatch(request.Context(), chi.URLParam(request, "batchId"))
	if err != nil {
		handlers.writeAdminRewardError(writer, err, "获取批次详情失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    batch,
	})
}

func (handlers adminRewardHandlers) writeAdminRewardError(writer http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, rewards.ErrInvalidAdminInput):
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": adminRewardValidationMessage(err, fallback),
		})
	case errors.Is(err, rewards.ErrRewardBatchNotFound):
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "批次不存在",
		})
	case errors.Is(err, rewards.ErrUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "奖励数据库未配置",
		})
	default:
		handlers.deps.Logger.Error("后台奖励接口失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": fallback,
		})
	}
}

func adminRewardValidationMessage(err error, fallback string) string {
	message := strings.TrimSpace(err.Error())
	message = strings.TrimPrefix(message, rewards.ErrInvalidAdminInput.Error()+":")
	message = strings.TrimSpace(message)
	if message == "" {
		return fallback
	}
	return message
}

func parseAdminRewardAmount(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}
	var number json.Number
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&number); err != nil {
		return 0, false
	}
	value, err := strconv.ParseFloat(number.String(), 64)
	if err != nil || value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) || value != math.Trunc(value) || value > float64(math.MaxInt64) {
		return 0, false
	}
	return int64(value), true
}
