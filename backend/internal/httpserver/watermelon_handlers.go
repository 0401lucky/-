package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"redemption/backend/internal/gamewatermelon"
)

type watermelonHandlers struct {
	deps    Dependencies
	service *gamewatermelon.Service
}

func newWatermelonHandlers(deps Dependencies) watermelonHandlers {
	return watermelonHandlers{deps, gamewatermelon.NewService(deps.DB)}
}

func (h watermelonHandlers) handle(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		shared := economyHandlers{deps: h.deps}
		if r.Method != http.MethodGet && shared.rejectUntrustedUnsafeRequest(w, r) {
			return
		}
		user, ok := shared.requireUser(w, r)
		if !ok {
			return
		}
		if action == "start" && shared.rejectRateLimited(w, r, *user, gameStartRateLimit) {
			return
		}
		if action == "checkpoint" && shared.rejectRateLimited(w, r, *user, gameActionRateLimit) {
			return
		}
		if action == "submit" && shared.rejectRateLimited(w, r, *user, gameSubmitRateLimit) {
			return
		}
		var data any
		var err error
		switch action {
		case "status":
			data, err = h.service.Status(r.Context(), *user)
		case "start":
			data, err = h.service.Start(r.Context(), *user)
		default:
			var input gamewatermelon.SubmitInput
			r.Body = http.MaxBytesReader(w, r.Body, gamewatermelon.MaxRequestBytes)
			decoder := json.NewDecoder(r.Body)
			decoder.DisallowUnknownFields()
			if decodeErr := decoder.Decode(&input); decodeErr != nil {
				writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
				return
			}
			if decoder.Decode(&struct{}{}) != io.EOF || input.SessionID == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
				return
			}
			switch action {
			case "checkpoint":
				data, err = h.service.Checkpoint(r.Context(), *user, input)
			case "submit":
				data, err = h.service.Submit(r.Context(), *user, input)
			case "cancel":
				err = h.service.Cancel(r.Context(), *user, input.SessionID)
			}
		}
		if err != nil {
			code, message := http.StatusInternalServerError, "服务器错误，请稍后重试"
			if errors.Is(err, gamewatermelon.ErrUnavailable) {
				code, message = http.StatusServiceUnavailable, "游戏服务暂不可用，仍可自由练习"
			} else if gamewatermelon.IsClientError(err) {
				code, message = http.StatusBadRequest, err.Error()
			} else {
				h.deps.Logger.Error("软软西瓜请求失败", "action", action, "error", err)
			}
			writeJSON(w, code, map[string]any{"success": false, "message": message})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "data": data})
	}
}
