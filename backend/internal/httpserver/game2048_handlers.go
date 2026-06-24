package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/game2048"
)

type game2048Handlers struct {
	deps    Dependencies
	service *game2048.Service
}

func newGame2048Handlers(deps Dependencies) game2048Handlers {
	return game2048Handlers{
		deps:    deps,
		service: game2048.NewService(deps.DB),
	}
}

func (handlers game2048Handlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询 2048 状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers game2048Handlers) start(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "开始 2048 失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    game2048.BuildSessionView(*result.Session),
	})
}

func (handlers game2048Handlers) checkpoint(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, gameActionRateLimit) {
		return
	}
	payload, ok := parseGame2048SubmitPayload(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Checkpoint(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "同步 2048 进度失败", err)
		return
	}
	if !result.Success || result.Session == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    game2048.BuildSessionView(*result.Session),
	})
}

func (handlers game2048Handlers) submit(writer http.ResponseWriter, request *http.Request) {
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
	payload, ok := parseGame2048SubmitPayload(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Submit(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "2048 结算失败", err)
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

func (handlers game2048Handlers) cancel(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "取消 2048 失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": "游戏已取消"})
}

func parseGame2048SubmitPayload(writer http.ResponseWriter, request *http.Request) (game2048.SubmitInput, bool) {
	var payload game2048.SubmitInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return game2048.SubmitInput{}, false
	}
	if strings.TrimSpace(payload.SessionID) == "" || payload.Moves == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return game2048.SubmitInput{}, false
	}
	return payload, true
}

func (handlers game2048Handlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, game2048.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "2048 数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
