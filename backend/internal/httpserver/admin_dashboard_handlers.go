package httpserver

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/admindashboard"

	"github.com/go-chi/chi/v5"
)

type adminDashboardHandlers struct {
	deps    Dependencies
	service *admindashboard.Service
}

func newAdminDashboardHandlers(deps Dependencies) adminDashboardHandlers {
	return adminDashboardHandlers{
		deps:    deps,
		service: admindashboard.NewService(deps.DB),
	}
}

func (handlers adminDashboardHandlers) get(writer http.ResponseWriter, request *http.Request) {
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "仪表盘数据库未配置",
		})
		return
	}

	data, err := handlers.service.Get(request.Context(), request.URL.Query().Get("detect") == "1", time.Now())
	if err != nil {
		handlers.deps.Logger.Error("查询后台仪表盘失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取管理仪表盘失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers adminDashboardHandlers) listAlerts(writer http.ResponseWriter, request *http.Request) {
	admin, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request)
	if !ok {
		return
	}
	if (economyHandlers{deps: handlers.deps}).rejectRateLimited(writer, request, *admin, adminAlertsRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "告警数据库未配置",
		})
		return
	}

	historyLimit := parseOptionalPositiveInt64(request.URL.Query().Get("historyLimit"), 50)
	if historyLimit > 200 {
		historyLimit = 200
	}
	alerts, detection, err := handlers.service.GetAlerts(request.Context(), request.URL.Query().Get("detect") == "1", time.Now(), historyLimit)
	if err != nil {
		handlers.deps.Logger.Error("查询后台告警失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取告警列表失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"active":    alerts.Active,
			"history":   alerts.History,
			"detection": detection,
		},
	})
}

func (handlers adminDashboardHandlers) resolveAlert(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, adminAlertsRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "告警数据库未配置",
		})
		return
	}

	id := strings.TrimSpace(chi.URLParam(request, "id"))
	if id == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "告警 ID 不能为空",
		})
		return
	}
	if len(id) > 160 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "告警 ID 无效",
		})
		return
	}

	if err := handlers.service.ResolveAlert(request.Context(), id, admin.Username, time.Now()); errors.Is(err, admindashboard.ErrAlertNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "告警不存在",
		})
		return
	} else if err != nil {
		handlers.deps.Logger.Error("处理后台告警失败", "alert_id", id, "admin_id", strconv.FormatInt(admin.ID, 10), "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "处理告警失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "告警已处理",
	})
}
