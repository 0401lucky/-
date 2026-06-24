package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"redemption/backend/internal/profile"
)

var profileOverviewRateLimit = userRateLimitRule{prefix: "ratelimit:profile:overview", windowSeconds: 60, maxRequests: 30}

type profileHandlers struct {
	deps    Dependencies
	service *profile.Service
}

func newProfileHandlers(deps Dependencies) profileHandlers {
	return profileHandlers{
		deps:    deps,
		service: profile.NewService(deps.DB),
	}
}

func (handlers profileHandlers) getSettings(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, profileOverviewRateLimit) {
		return
	}

	data, err := handlers.service.GetSettings(request.Context(), user.ID, time.Now().UnixMilli())
	if err != nil {
		handlers.writeServiceError(writer, "查询个人资料失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers profileHandlers) getOverview(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, profileOverviewRateLimit) {
		return
	}

	data, err := handlers.service.GetOverview(request.Context(), user.ID, user.Username, time.Now().UnixMilli())
	if err != nil {
		handlers.writeServiceError(writer, "查询个人主页失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers profileHandlers) updateSettings(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, profileOverviewRateLimit) {
		return
	}

	var payload map[string]json.RawMessage
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	patch := profile.SettingsPatch{}
	if raw, exists := payload["displayName"]; exists {
		value, message := profile.ValidateDisplayName(raw)
		if message != "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
			return
		}
		patch.DisplayName = value
	}
	if raw, exists := payload["avatarUrl"]; exists {
		value, message := profile.ValidateAvatarValue(raw)
		if message != "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
			return
		}
		patch.AvatarURL = value
	}
	if raw, exists := payload["qqEmail"]; exists {
		value, message := profile.ValidateQQEmail(raw)
		if message != "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
			return
		}
		patch.QQEmail = value
	}
	if patch.Empty() {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "未提供任何可更新字段"})
		return
	}

	data, err := handlers.service.UpdateSettings(request.Context(), user.ID, patch, time.Now().UnixMilli())
	if err != nil {
		handlers.writeServiceError(writer, "更新个人资料失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers profileHandlers) equipAchievement(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, profileOverviewRateLimit) {
		return
	}

	var payload map[string]json.RawMessage
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	var achievementID *string
	if raw, exists := payload["achievementId"]; exists && string(raw) != "null" {
		var value string
		if err := json.Unmarshal(raw, &value); err != nil || !profile.IsAchievementID(value) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "未知成就"})
			return
		}
		achievementID = &value
	}

	result, err := handlers.service.EquipAchievement(request.Context(), user.ID, achievementID, time.Now().UnixMilli())
	if err != nil {
		handlers.writeEquipError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (handlers profileHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, profile.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "个人资料数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}

func (handlers profileHandlers) writeEquipError(writer http.ResponseWriter, err error) {
	if errors.Is(err, profile.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "个人资料数据库未配置",
		})
		return
	}
	if errors.Is(err, profile.ErrForcedAchievementActive) || errors.Is(err, profile.ErrAchievementLocked) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": err.Error()})
		return
	}
	handlers.deps.Logger.Error("佩戴成就失败", "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
