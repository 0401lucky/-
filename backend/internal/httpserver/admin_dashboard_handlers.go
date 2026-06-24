package httpserver

import (
	"net/http"
	"time"

	"redemption/backend/internal/admindashboard"
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
