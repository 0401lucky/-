package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/economy"
	"redemption/backend/internal/notifications"
	"redemption/backend/internal/rewards"
)

type notificationHandlers struct {
	deps          Dependencies
	service       *notifications.Service
	rewardService *rewards.Service
}

type markNotificationsReadPayload struct {
	IDs     []any `json:"ids"`
	MarkAll bool  `json:"markAll"`
}

type deleteNotificationsPayload struct {
	IDs []any `json:"ids"`
}

type claimNotificationPayload struct {
	NotificationID any `json:"notificationId"`
}

func newNotificationHandlers(deps Dependencies) notificationHandlers {
	return notificationHandlers{
		deps:          deps,
		service:       notifications.NewService(deps.DB),
		rewardService: rewards.NewService(deps.DB, economy.NewService(deps.DB), newWalletQuotaClient(deps)),
	}
}

func (handlers notificationHandlers) getUnreadCount(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, notificationsListRateLimit) {
		return
	}

	unreadCount, err := handlers.service.CountUnread(request.Context(), user.ID)
	if err != nil {
		handlers.writeServiceError(writer, err, "查询通知未读数失败", "获取未读数量失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"unreadCount": unreadCount,
		},
	})
}

func (handlers notificationHandlers) list(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, notificationsListRateLimit) {
		return
	}

	query := request.URL.Query()
	options := notifications.ListOptions{
		Page:   parsePositiveIntQuery(query.Get("page"), 1),
		Limit:  parsePositiveIntQuery(query.Get("limit"), 20),
		Type:   parseNotificationType(query.Get("type")),
		Filter: parseNotificationFilter(query.Get("filter")),
	}
	result, err := handlers.service.List(request.Context(), user.ID, options)
	if err != nil {
		handlers.writeServiceError(writer, err, "查询通知列表失败", "获取通知失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (handlers notificationHandlers) markRead(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, notificationsReadRateLimit) {
		return
	}

	payload := markNotificationsReadPayload{}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = markNotificationsReadPayload{}
	}
	ids := []string{}
	for _, rawID := range payload.IDs {
		if id, ok := rawID.(string); ok {
			ids = append(ids, id)
		}
	}
	if !payload.MarkAll && len(ids) == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请提供需要标记的通知 ID",
		})
		return
	}

	result, err := handlers.service.MarkRead(request.Context(), user.ID, notifications.MarkReadOptions{
		IDs:     ids,
		MarkAll: payload.MarkAll,
		NowMs:   time.Now().UnixMilli(),
	})
	if err != nil {
		handlers.writeServiceError(writer, err, "标记通知已读失败", "标记已读失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "标记已读成功",
		"data":    result,
	})
}

func (handlers notificationHandlers) delete(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, notificationsDeleteRateLimit) {
		return
	}

	payload := deleteNotificationsPayload{}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = deleteNotificationsPayload{}
	}
	ids := []string{}
	for _, rawID := range payload.IDs {
		if id, ok := rawID.(string); ok {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "请提供需要删除的通知 ID",
		})
		return
	}

	result, err := handlers.service.Delete(request.Context(), user.ID, ids)
	if err != nil {
		handlers.writeServiceError(writer, err, "删除通知失败", "删除通知失败")
		return
	}
	if result.Deleted == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "仅可删除已读通知",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "通知已删除",
		"data":    result,
	})
}

func (handlers notificationHandlers) claim(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, notificationsClaimRateLimit) {
		return
	}

	payload := claimNotificationPayload{}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = claimNotificationPayload{}
	}
	notificationID := ""
	if raw, ok := payload.NotificationID.(string); ok {
		notificationID = raw
	}
	notificationID = strings.TrimSpace(notificationID)
	if notificationID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "缺少通知 ID",
		})
		return
	}

	result, err := handlers.rewardService.Claim(request.Context(), *user, notificationID)
	if err != nil {
		handlers.writeRewardClaimError(writer, err)
		return
	}
	status := http.StatusOK
	if !result.Success {
		status = http.StatusBadRequest
	}
	writeJSON(writer, status, map[string]any{
		"success": result.Success,
		"message": result.Message,
		"data": map[string]any{
			"claimStatus": result.ClaimStatus,
		},
	})
}

func (handlers notificationHandlers) writeServiceError(writer http.ResponseWriter, err error, logMessage string, responseMessage string) {
	if errors.Is(err, notifications.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "通知数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": responseMessage})
}

func (handlers notificationHandlers) writeRewardClaimError(writer http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, rewards.ErrUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "奖励数据库未配置",
		})
	case errors.Is(err, rewards.ErrNotificationNotFound):
		writeJSON(writer, http.StatusNotFound, map[string]any{
			"success": false,
			"message": "通知不存在",
		})
	case errors.Is(err, rewards.ErrForbidden):
		writeJSON(writer, http.StatusForbidden, map[string]any{
			"success": false,
			"message": "无权操作此通知",
		})
	case errors.Is(err, rewards.ErrNotReward):
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "此通知不是奖励通知",
		})
	case errors.Is(err, rewards.ErrInvalidRewardData):
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": "通知数据无效",
		})
	case errors.Is(err, rewards.ErrQuotaUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"code":    "NEW_API_NOT_CONFIGURED",
			"message": "new-api 管理端未配置，暂时不能处理额度奖励",
		})
	default:
		handlers.deps.Logger.Error("领取通知奖励失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "领取失败，请稍后重试",
		})
	}
}

func parseNotificationType(value string) notifications.Type {
	notificationType := notifications.Type(value)
	if notifications.IsType(notificationType) {
		return notificationType
	}
	return ""
}

func parseNotificationFilter(value string) notifications.Filter {
	filter := notifications.Filter(value)
	if notifications.IsFilter(filter) {
		return filter
	}
	return ""
}

func parsePositiveIntQuery(value string, fallback int) int {
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return fallback
	}
	return int(math.Floor(parsed))
}
