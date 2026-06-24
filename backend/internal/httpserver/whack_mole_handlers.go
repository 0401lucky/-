package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"redemption/backend/internal/whackmole"
)

type whackMoleHandlers struct {
	deps    Dependencies
	service *whackmole.Service
}

func newWhackMoleHandlers(deps Dependencies) whackMoleHandlers {
	return whackMoleHandlers{
		deps:    deps,
		service: whackmole.NewService(deps.DB),
	}
}

func (handlers whackMoleHandlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询打地鼠状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers whackMoleHandlers) sync(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Sync(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "同步打地鼠会话失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers whackMoleHandlers) start(writer http.ResponseWriter, request *http.Request) {
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

	var payload struct {
		Restart    bool                 `json:"restart"`
		Difficulty whackmole.Difficulty `json:"difficulty"`
	}
	if request.Body != nil {
		_ = json.NewDecoder(request.Body).Decode(&payload)
	}
	result, err := handlers.service.Start(request.Context(), *user, whackmole.StartInput{
		Restart:    payload.Restart,
		Difficulty: payload.Difficulty,
	})
	if err != nil {
		handlers.writeServiceError(writer, "开始打地鼠失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    whackmole.BuildSessionView(*result.Session, time.Now()),
	})
}

func (handlers whackMoleHandlers) submit(writer http.ResponseWriter, request *http.Request) {
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

	var payload whackmole.SubmitInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if payload.SessionID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	result, err := handlers.service.Submit(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "打地鼠结算失败", err)
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

func (handlers whackMoleHandlers) cancel(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "取消打地鼠失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": "游戏已取消"})
}

func (handlers whackMoleHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, whackmole.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "打地鼠数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
