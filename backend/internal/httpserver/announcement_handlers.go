package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/announcements"

	"github.com/go-chi/chi/v5"
)

type announcementHandlers struct {
	deps    Dependencies
	service *announcements.Service
}

func newAnnouncementHandlers(deps Dependencies) announcementHandlers {
	return announcementHandlers{
		deps:    deps,
		service: announcements.NewService(deps.DB),
	}
}

func (handlers announcementHandlers) listPublished(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, announcementsListRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}

	query := request.URL.Query()
	result, err := handlers.service.ListPublished(request.Context(), announcements.ListOptions{
		Page:  parsePositiveIntQuery(query.Get("page"), 1),
		Limit: parsePositiveIntQuery(query.Get("limit"), 20),
	})
	if err != nil {
		handlers.writeServiceError(writer, "查询公开公告失败", err, "获取公告失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (handlers announcementHandlers) listAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, announcementsAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}

	query := request.URL.Query()
	result, err := handlers.service.ListAdmin(request.Context(), announcements.ListOptions{
		Page:   parsePositiveIntQuery(query.Get("page"), 1),
		Limit:  parsePositiveIntQuery(query.Get("limit"), 20),
		Status: parseAnnouncementStatus(query.Get("status")),
	})
	if err != nil {
		handlers.writeServiceError(writer, "查询后台公告失败", err, "获取公告失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": result})
}

func (handlers announcementHandlers) createAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, announcementsAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}

	var payload struct {
		Title   any `json:"title"`
		Content any `json:"content"`
		Status  any `json:"status"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	result, err := handlers.service.Create(request.Context(), announcements.SaveInput{
		Title:   stringFromAny(payload.Title),
		Content: stringFromAny(payload.Content),
		Status:  parseAnnouncementStatus(stringFromAny(payload.Status)),
	}, *admin)
	if err != nil {
		handlers.writeMutationError(writer, err, "创建公告失败")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success": true,
		"message": "公告创建成功",
		"data":    result,
	})
}

func (handlers announcementHandlers) updateAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, announcementsAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}

	id := strings.TrimSpace(chi.URLParam(request, "id"))
	input, ok := parseAnnouncementUpdatePayload(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Update(request.Context(), id, input, *admin)
	if err != nil {
		handlers.writeMutationError(writer, err, "更新公告失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "公告更新成功",
		"data":    result,
	})
}

func (handlers announcementHandlers) archiveAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *admin, announcementsAdminRateLimit) {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}

	archived, err := handlers.service.Archive(request.Context(), strings.TrimSpace(chi.URLParam(request, "id")), *admin)
	if err != nil {
		handlers.writeMutationError(writer, err, "删除公告失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "公告已归档",
		"data": map[string]any{
			"announcement": archived,
		},
	})
}

func parseAnnouncementUpdatePayload(writer http.ResponseWriter, request *http.Request) (announcements.UpdateInput, bool) {
	var raw map[string]any
	if err := json.NewDecoder(request.Body).Decode(&raw); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return announcements.UpdateInput{}, false
	}
	input := announcements.UpdateInput{}
	if value, exists := raw["title"]; exists {
		title := stringFromAny(value)
		input.Title = &title
		input.HasTitle = true
	}
	if value, exists := raw["content"]; exists {
		content := stringFromAny(value)
		input.Content = &content
		input.HasContent = true
	}
	if value, exists := raw["status"]; exists {
		status := parseAnnouncementStatus(stringFromAny(value))
		input.Status = &status
		input.HasStatus = true
	}
	return input, true
}

func parseAnnouncementStatus(value string) announcements.Status {
	switch announcements.Status(strings.TrimSpace(value)) {
	case announcements.StatusDraft:
		return announcements.StatusDraft
	case announcements.StatusPublished:
		return announcements.StatusPublished
	case announcements.StatusArchived:
		return announcements.StatusArchived
	default:
		return announcements.StatusAll
	}
}

func stringFromAny(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

func (handlers announcementHandlers) writeMutationError(writer http.ResponseWriter, err error, fallback string) {
	switch {
	case errors.Is(err, announcements.ErrUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
	case errors.Is(err, announcements.ErrNotFound):
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "公告不存在"})
	case errors.Is(err, announcements.ErrInvalidInput):
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": fallback})
	default:
		handlers.deps.Logger.Error(fallback, "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": fallback})
	}
}

func (handlers announcementHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error, responseMessage string) {
	if errors.Is(err, announcements.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "公告数据库未配置"})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": responseMessage})
}
