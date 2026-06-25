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
		DailyPointsLimit json.RawMessage `json:"dailyPointsLimit"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	limit, ok := parseAdminConfigDailyLimit(writer, payload.DailyPointsLimit)
	if !ok {
		return
	}
	config, err := handlers.service.Update(request.Context(), systemconfig.UpdateInput{
		DailyPointsLimit: &limit,
		UpdatedBy:        admin.Username,
	})
	if errors.Is(err, systemconfig.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "系统配置数据库未配置"})
		return
	}
	if errors.Is(err, systemconfig.ErrInvalid) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "每日积分上限必须在 100 - 100000 之间"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("更新系统配置失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "config": config, "message": "配置已更新"})
}

func parseAdminConfigDailyLimit(writer http.ResponseWriter, raw json.RawMessage) (int64, bool) {
	limit, ok := parseJSONInt64Value(raw)
	if !ok || !systemconfig.ValidDailyPointsLimit(limit) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "每日积分上限必须在 100 - 100000 之间",
		})
		return 0, false
	}
	return limit, true
}
