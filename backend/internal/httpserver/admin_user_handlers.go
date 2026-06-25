package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/adminusers"

	"github.com/go-chi/chi/v5"
)

type adminUserHandlers struct {
	deps    Dependencies
	service *adminusers.Service
}

func newAdminUserHandlers(deps Dependencies) adminUserHandlers {
	return adminUserHandlers{
		deps:    deps,
		service: adminusers.NewService(deps.DB),
	}
}

func (handlers adminUserHandlers) list(writer http.ResponseWriter, request *http.Request) {
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "用户管理数据库未配置",
		})
		return
	}

	query := request.URL.Query()
	result, err := handlers.service.ListUsers(
		request.Context(),
		parseOptionalPositiveInt64(query.Get("page"), 1),
		parseOptionalPositiveInt64(query.Get("limit"), 50),
		query.Get("search"),
	)
	if err != nil {
		handlers.deps.Logger.Error("查询后台用户列表失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取用户列表失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"users":      result.Users,
		"pagination": result.Pagination,
		"stats":      result.Stats,
	})
}

func (handlers adminUserHandlers) detail(writer http.ResponseWriter, request *http.Request) {
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	userID, ok := parsePositiveInt64Path(writer, chi.URLParam(request, "id"))
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "用户管理数据库未配置",
		})
		return
	}

	detail, err := handlers.service.GetUserDetail(request.Context(), userID)
	if errors.Is(err, adminusers.ErrUserNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "用户不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("查询后台用户详情失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取用户详情失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":        true,
		"claims":         detail.Claims,
		"lotteryRecords": detail.LotteryRecords,
		"achievements":   detail.Achievements,
	})
}

func (handlers adminUserHandlers) updateAchievement(writer http.ResponseWriter, request *http.Request) {
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request)
	if !ok {
		return
	}
	userID, ok := parsePositiveInt64Path(writer, chi.URLParam(request, "id"))
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "用户管理数据库未配置",
		})
		return
	}

	var payload struct {
		AchievementID string `json:"achievementId"`
		Action        string `json:"action"`
		Reason        string `json:"reason"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请求体格式无效",
		})
		return
	}
	action := strings.TrimSpace(payload.Action)
	if action == "" {
		action = "grant"
	}
	achievements, err := handlers.service.SetAchievement(
		request.Context(),
		userID,
		strings.TrimSpace(payload.AchievementID),
		action,
		*admin,
		payload.Reason,
	)
	if errors.Is(err, adminusers.ErrUnsupportedAchievement) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "该成就不支持手动颁发",
		})
		return
	}
	if errors.Is(err, adminusers.ErrInvalidInput) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "成就操作参数无效",
		})
		return
	}
	if errors.Is(err, adminusers.ErrUserNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "用户不存在",
		})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("更新后台用户成就失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "成就操作失败",
		})
		return
	}

	message := "成就颁发成功"
	if action == "revoke" {
		message = "成就已撤销"
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":      true,
		"message":      message,
		"achievements": achievements,
	})
}

func (handlers adminUserHandlers) legacyToolDisabled(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}
	writeJSON(writer, http.StatusGone, map[string]any{
		"success": false,
		"code":    "ADMIN_LEGACY_TOOL_DISABLED",
		"message": "该后台迁移工具已下线。Zeabur 生产环境不再执行旧 Cloudflare/KV 迁移接口，请使用离线迁移命令或重新登录同步用户数据。",
	})
}

func parsePositiveInt64Path(writer http.ResponseWriter, raw string) (int64, bool) {
	return parsePositiveInt64Query(writer, raw, "无效的用户ID", "无效的用户ID")
}
