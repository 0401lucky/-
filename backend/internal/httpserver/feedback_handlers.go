package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/feedback"

	"github.com/go-chi/chi/v5"
)

var feedbackReadRateLimit = userRateLimitRule{prefix: "ratelimit:feedback:read", windowSeconds: 60, maxRequests: 60}
var feedbackCreateRateLimit = userRateLimitRule{prefix: "ratelimit:feedback:create", windowSeconds: 600, maxRequests: 5}
var feedbackMessageRateLimit = userRateLimitRule{prefix: "ratelimit:feedback:message", windowSeconds: 60, maxRequests: 20}
var feedbackLikeRateLimit = userRateLimitRule{prefix: "ratelimit:feedback:like", windowSeconds: 60, maxRequests: 60}
var adminFeedbackMessageRateLimit = userRateLimitRule{prefix: "ratelimit:admin:feedback:message", windowSeconds: 60, maxRequests: 60}

const maxFeedbackMessageContentLength = 1000
const maxFeedbackTitleLength = 80
const maxFeedbackContactLength = 100

type feedbackHandlers struct {
	deps       Dependencies
	service    *feedback.Service
	mediaStore *feedback.MediaStore
}

func newFeedbackHandlers(deps Dependencies) feedbackHandlers {
	return feedbackHandlers{
		deps:       deps,
		service:    feedback.NewService(deps.DB),
		mediaStore: feedback.NewMediaStore(deps.Config.FeedbackMediaDir, deps.Config.FeedbackMediaURL),
	}
}

func (handlers feedbackHandlers) list(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, feedbackReadRateLimit) {
		return
	}

	query := request.URL.Query()
	statusRaw := query.Get("status")
	status := feedback.Status(statusRaw)
	if statusRaw != "" && !feedback.IsStatus(status) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的反馈状态"})
		return
	}

	options := feedback.ListOptions{
		Page:   parsePositiveIntQuery(query.Get("page"), 1),
		Limit:  parsePositiveIntQuery(query.Get("limit"), 20),
		Status: status,
	}

	var result feedback.ListResult
	var err error
	if query.Get("scope") == "wall" {
		result, err = handlers.service.ListWall(request.Context(), user.ID, options)
	} else {
		result, err = handlers.service.ListUser(request.Context(), user.ID, options)
	}
	if err != nil {
		handlers.writeServiceError(writer, err, "查询反馈列表失败", "获取反馈列表失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":    true,
		"items":      result.Items,
		"pagination": result.Pagination,
	})
}

func (handlers feedbackHandlers) create(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, feedbackCreateRateLimit) {
		return
	}

	payload, ok := handlers.parseFeedbackCreatePayload(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Create(request.Context(), feedback.CreateInput{
		UserID:    user.ID,
		Username:  user.Username,
		Title:     payload.Title,
		Content:   payload.Content,
		Contact:   payload.Contact,
		Anonymous: payload.Anonymous,
		Images:    payload.Images,
	})
	if err != nil {
		handlers.writeMutationError(writer, err, "提交反馈失败")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success":      true,
		"message":      "反馈提交成功",
		"feedback":     result.Feedback,
		"firstMessage": result.Message,
	})
}

func (handlers feedbackHandlers) detail(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, feedbackReadRateLimit) {
		return
	}

	id := chi.URLParam(request, "id")
	result, err := handlers.service.GetDetail(request.Context(), id, user.ID, false)
	if err != nil {
		handlers.writeDetailError(writer, err, false)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"feedback": result.Feedback,
		"messages": result.Messages,
	})
}

func (handlers feedbackHandlers) addMessage(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, feedbackMessageRateLimit) {
		return
	}

	payload, ok := handlers.parseFeedbackMessagePayload(writer, request, "留言", feedback.RoleUser)
	if !ok {
		return
	}
	result, err := handlers.service.AddMessage(request.Context(), feedback.MessageInput{
		FeedbackID:  chi.URLParam(request, "id"),
		Role:        feedback.RoleUser,
		Content:     payload.Content,
		CreatedBy:   user.Username,
		ActorUserID: user.ID,
		Images:      payload.Images,
	})
	if err != nil {
		handlers.writeMutationError(writer, err, "留言失败，请稍后重试")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success":         true,
		"message":         "留言成功",
		"feedback":        result.Feedback,
		"feedbackMessage": result.Message,
	})
}

func (handlers feedbackHandlers) toggleLike(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, feedbackLikeRateLimit) {
		return
	}

	result, err := handlers.service.ToggleLike(request.Context(), chi.URLParam(request, "id"), user.ID)
	if err != nil {
		handlers.writeMutationError(writer, err, "点赞失败，请稍后重试")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":   true,
		"likeCount": result.LikeCount,
		"likedByMe": result.LikedByMe,
	})
}

func (handlers feedbackHandlers) listAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	query := request.URL.Query()
	includeArchived := parseBooleanQuery(query.Get("includeArchived"))
	statusRaw := query.Get("status")
	status := feedback.Status(statusRaw)
	if !includeArchived && statusRaw != "" && !feedback.IsStatus(status) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的反馈状态"})
		return
	}

	result, err := handlers.service.ListAdmin(request.Context(), feedback.ListOptions{
		Page:            parsePositiveIntQuery(query.Get("page"), 1),
		Limit:           parsePositiveIntQuery(query.Get("limit"), 50),
		Status:          status,
		IncludeArchived: includeArchived,
	})
	if err != nil {
		handlers.writeServiceError(writer, err, "查询后台反馈列表失败", "获取反馈列表失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":         true,
		"items":           result.Items,
		"pagination":      result.Pagination,
		"includeArchived": includeArchived,
		"archive":         nil,
	})
}

func (handlers feedbackHandlers) adminDetail(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	result, err := handlers.service.GetDetail(request.Context(), chi.URLParam(request, "id"), 0, true)
	if err != nil {
		handlers.writeDetailError(writer, err, true)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"feedback": result.Feedback,
		"messages": result.Messages,
	})
}

func (handlers feedbackHandlers) updateStatus(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	var payload struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	status := feedback.Status(strings.TrimSpace(payload.Status))
	if !feedback.IsStatus(status) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的反馈状态"})
		return
	}

	item, err := handlers.service.UpdateStatus(request.Context(), chi.URLParam(request, "id"), status)
	if err != nil {
		handlers.writeMutationError(writer, err, "状态更新失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"message":  "状态更新成功",
		"feedback": item,
	})
}

func (handlers feedbackHandlers) deleteAdmin(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if _, ok := shared.requireAdmin(writer, request); !ok {
		return
	}

	if err := handlers.service.Delete(request.Context(), chi.URLParam(request, "id")); err != nil {
		handlers.writeMutationError(writer, err, "删除反馈失败")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "反馈已删除",
	})
}

func (handlers feedbackHandlers) addAdminMessage(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, adminFeedbackMessageRateLimit) {
		return
	}

	payload, ok := handlers.parseFeedbackMessagePayload(writer, request, "回复", feedback.RoleAdmin)
	if !ok {
		return
	}
	result, err := handlers.service.AddMessage(request.Context(), feedback.MessageInput{
		FeedbackID:  chi.URLParam(request, "id"),
		Role:        feedback.RoleAdmin,
		Content:     payload.Content,
		CreatedBy:   user.Username,
		ActorUserID: user.ID,
		Admin:       true,
		Images:      payload.Images,
	})
	if err != nil {
		handlers.writeMutationError(writer, err, "回复失败，请稍后重试")
		return
	}
	writeJSON(writer, http.StatusCreated, map[string]any{
		"success":         true,
		"message":         "回复成功",
		"feedback":        result.Feedback,
		"feedbackMessage": result.Message,
	})
}

func (handlers feedbackHandlers) writeServiceError(writer http.ResponseWriter, err error, logMessage string, responseMessage string) {
	if errors.Is(err, feedback.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "反馈数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": responseMessage})
}

func (handlers feedbackHandlers) writeDetailError(writer http.ResponseWriter, err error, admin bool) {
	switch {
	case errors.Is(err, feedback.ErrUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "反馈数据库未配置"})
	case errors.Is(err, feedback.ErrNotFound):
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "反馈不存在"})
	case errors.Is(err, feedback.ErrForbidden):
		writeJSON(writer, http.StatusForbidden, map[string]any{"success": false, "message": "无权限访问该反馈"})
	default:
		if admin {
			handlers.deps.Logger.Error("查询后台反馈详情失败", "error", err)
		} else {
			handlers.deps.Logger.Error("查询反馈详情失败", "error", err)
		}
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "获取反馈详情失败"})
	}
}

func (handlers feedbackHandlers) writeMutationError(writer http.ResponseWriter, err error, fallbackMessage string) {
	switch {
	case errors.Is(err, feedback.ErrUnavailable):
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "反馈数据库未配置"})
	case errors.Is(err, feedback.ErrNotFound):
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "反馈不存在"})
	case errors.Is(err, feedback.ErrForbidden):
		writeJSON(writer, http.StatusForbidden, map[string]any{"success": false, "message": "无权限操作该反馈"})
	case errors.Is(err, feedback.ErrArchived):
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "该反馈已归档，不能继续操作"})
	case errors.Is(err, feedback.ErrClosed):
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "该反馈已关闭，不能继续留言"})
	default:
		handlers.deps.Logger.Error("反馈写路径失败", "error", err)
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": fallbackMessage})
	}
}

type feedbackMessagePayload struct {
	Content string
	Images  json.RawMessage
}

type feedbackCreatePayload struct {
	Title     string
	Content   string
	Contact   string
	Anonymous bool
	Images    json.RawMessage
}

func (handlers feedbackHandlers) parseFeedbackCreatePayload(writer http.ResponseWriter, request *http.Request) (feedbackCreatePayload, bool) {
	var payload struct {
		Title     string          `json:"title"`
		Content   string          `json:"content"`
		Contact   string          `json:"contact"`
		Anonymous bool            `json:"anonymous"`
		Images    json.RawMessage `json:"images"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return feedbackCreatePayload{}, false
	}
	title := strings.TrimSpace(payload.Title)
	content := strings.TrimSpace(payload.Content)
	contact := strings.TrimSpace(payload.Contact)
	images, hasImages, ok := handlers.normalizeFeedbackMessageImages(writer, request, payload.Images, feedback.RoleUser)
	if !ok {
		return feedbackCreatePayload{}, false
	}
	if content == "" && !hasImages {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "反馈内容或图片/视频至少填写一项"})
		return feedbackCreatePayload{}, false
	}
	if len([]rune(content)) > maxFeedbackMessageContentLength {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "反馈内容不能超过 1000 字"})
		return feedbackCreatePayload{}, false
	}
	if len([]rune(title)) > maxFeedbackTitleLength {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "反馈标题不能超过 80 字"})
		return feedbackCreatePayload{}, false
	}
	if len([]rune(contact)) > maxFeedbackContactLength {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "联系方式不能超过 100 字"})
		return feedbackCreatePayload{}, false
	}
	return feedbackCreatePayload{
		Title:     title,
		Content:   content,
		Contact:   contact,
		Anonymous: payload.Anonymous,
		Images:    images,
	}, true
}

func (handlers feedbackHandlers) parseFeedbackMessagePayload(writer http.ResponseWriter, request *http.Request, label string, role feedback.Role) (feedbackMessagePayload, bool) {
	var payload struct {
		Content string          `json:"content"`
		Images  json.RawMessage `json:"images"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return feedbackMessagePayload{}, false
	}
	content := strings.TrimSpace(payload.Content)
	images, hasImages, ok := handlers.normalizeFeedbackMessageImages(writer, request, payload.Images, role)
	if !ok {
		return feedbackMessagePayload{}, false
	}
	if content == "" && !hasImages {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": label + "内容或图片/视频至少填写一项"})
		return feedbackMessagePayload{}, false
	}
	if len([]rune(content)) > maxFeedbackMessageContentLength {
		writeJSON(writer, http.StatusBadRequest, map[string]any{
			"success": false,
			"message": label + "内容不能超过 1000 字",
		})
		return feedbackMessagePayload{}, false
	}
	return feedbackMessagePayload{Content: content, Images: images}, true
}

func (handlers feedbackHandlers) normalizeFeedbackMessageImages(writer http.ResponseWriter, request *http.Request, raw json.RawMessage, role feedback.Role) (json.RawMessage, bool, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false, true
	}
	images, hasImages, err := handlers.mediaStore.StoreImages(request.Context(), raw, role)
	if err == nil {
		return images, hasImages, true
	}
	if errors.Is(err, feedback.ErrMediaUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "反馈附件服务暂时不可用"})
		return nil, true, false
	}
	if errors.Is(err, feedback.ErrInvalidMedia) {
		message := strings.TrimPrefix(err.Error(), "invalid feedback media: ")
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
		return nil, true, false
	}
	handlers.deps.Logger.Error("反馈附件存储失败", "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "附件上传失败，请稍后重试"})
	return nil, true, false
}

func parseBooleanQuery(value string) bool {
	switch value {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
