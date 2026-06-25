package httpserver

import (
	"encoding/json"
	"net/http"
	"strings"

	"redemption/backend/internal/checkin"
)

type checkinHandlers struct {
	deps Dependencies
}

func newCheckinHandlers(deps Dependencies) checkinHandlers {
	return checkinHandlers{deps: deps}
}

func (handlers checkinHandlers) status(writer http.ResponseWriter, request *http.Request) {
	user, ok := (economyHandlers{deps: handlers.deps}).requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "签到数据库未配置",
		})
		return
	}
	snapshot, err := checkin.NewService(handlers.deps.DB).Snapshot(request.Context(), *user)
	if err != nil {
		handlers.deps.Logger.Error("查询签到状态失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "签到状态服务异常",
		})
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (handlers checkinHandlers) checkin(writer http.ResponseWriter, request *http.Request) {
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := (economyHandlers{deps: handlers.deps}).requireUser(writer, request)
	if !ok {
		return
	}
	if (economyHandlers{deps: handlers.deps}).rejectRateLimited(writer, request, *user, checkinRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "签到数据库未配置"})
		return
	}
	result, err := checkin.NewService(handlers.deps.DB).Checkin(request.Context(), *user)
	if err != nil {
		handlers.deps.Logger.Error("签到失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "签到服务异常"})
		return
	}
	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, result)
}

func (handlers checkinHandlers) makeup(writer http.ResponseWriter, request *http.Request) {
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := (economyHandlers{deps: handlers.deps}).requireUser(writer, request)
	if !ok {
		return
	}
	if (economyHandlers{deps: handlers.deps}).rejectRateLimited(writer, request, *user, checkinMakeupRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "签到数据库未配置"})
		return
	}

	var payload struct {
		Date string `json:"date"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	result, err := checkin.NewService(handlers.deps.DB).Makeup(request.Context(), *user, strings.TrimSpace(payload.Date))
	if err != nil {
		handlers.deps.Logger.Error("补签失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "补签服务异常"})
		return
	}
	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, result)
}
