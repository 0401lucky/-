package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"

	"redemption/backend/internal/match3"
)

type match3Handlers struct {
	deps    Dependencies
	service *match3.Service
}

func newMatch3Handlers(deps Dependencies) match3Handlers {
	return match3Handlers{
		deps:    deps,
		service: match3.NewService(deps.DB),
	}
}

func (handlers match3Handlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询消消乐状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers match3Handlers) start(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameStartRateLimit) {
		return
	}

	result, err := handlers.service.Start(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "开始消消乐失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    match3.BuildSessionView(*result.Session),
	})
}

func (handlers match3Handlers) submit(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameSubmitRateLimit) {
		return
	}

	var payload match3.SubmitInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if payload.SessionID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的会话ID"})
		return
	}
	if payload.Moves == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的操作序列"})
		return
	}
	result, err := handlers.service.Submit(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "消消乐结算失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"record":       result.Record,
			"pointsEarned": result.PointsEarned,
		},
	})
}

func (handlers match3Handlers) cancel(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}

	result, err := handlers.service.Cancel(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "取消消消乐失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": "游戏已取消"})
}

func (handlers match3Handlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, match3.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "消消乐数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
