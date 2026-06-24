package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"redemption/backend/internal/minesweeper"
)

type minesweeperHandlers struct {
	deps    Dependencies
	service *minesweeper.Service
}

func newMinesweeperHandlers(deps Dependencies) minesweeperHandlers {
	return minesweeperHandlers{
		deps:    deps,
		service: minesweeper.NewService(deps.DB),
	}
}

func (handlers minesweeperHandlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询扫雷状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers minesweeperHandlers) start(writer http.ResponseWriter, request *http.Request) {
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
		Restart    bool                   `json:"restart"`
		Difficulty minesweeper.Difficulty `json:"difficulty"`
	}
	if request.Body != nil {
		_ = json.NewDecoder(request.Body).Decode(&payload)
	}
	if !minesweeper.IsDifficulty(payload.Difficulty) {
		payload.Difficulty = minesweeper.DifficultyEasy
	}
	result, err := handlers.service.Start(request.Context(), *user, minesweeper.StartInput{
		Restart:    payload.Restart,
		Difficulty: payload.Difficulty,
	})
	if err != nil {
		handlers.writeServiceError(writer, "开始扫雷失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    minesweeper.BuildSessionView(*result.Session, time.Now().UnixMilli()),
	})
}

func (handlers minesweeperHandlers) step(writer http.ResponseWriter, request *http.Request) {
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

	input, ok := decodeMinesweeperStepInput(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Step(request.Context(), *user, input)
	if err != nil {
		handlers.writeServiceError(writer, "推进扫雷会话失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"session":  result.Session,
			"outcome":  result.Outcome,
			"outcomes": result.Outcomes,
			"skipped":  result.Skipped,
		},
	})
}

func (handlers minesweeperHandlers) submit(writer http.ResponseWriter, request *http.Request) {
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

	var payload minesweeper.SubmitInput
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	if strings.TrimSpace(payload.SessionID) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return
	}
	result, err := handlers.service.Submit(request.Context(), *user, payload)
	if err != nil {
		handlers.writeServiceError(writer, "扫雷结算失败", err)
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

func (handlers minesweeperHandlers) cancel(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "取消扫雷失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": "游戏已取消"})
}

func (handlers minesweeperHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, minesweeper.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "扫雷数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}

func decodeMinesweeperStepInput(writer http.ResponseWriter, request *http.Request) (minesweeper.StepInput, bool) {
	var raw struct {
		SessionID string            `json:"sessionId"`
		Action    *json.RawMessage  `json:"action"`
		Actions   []json.RawMessage `json:"actions"`
	}
	if err := json.NewDecoder(request.Body).Decode(&raw); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return minesweeper.StepInput{}, false
	}
	if strings.TrimSpace(raw.SessionID) == "" || (raw.Action == nil && len(raw.Actions) == 0) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return minesweeper.StepInput{}, false
	}
	input := minesweeper.StepInput{SessionID: raw.SessionID}
	if len(raw.Actions) > 0 {
		actions := make([]minesweeper.Action, 0, len(raw.Actions))
		for _, item := range raw.Actions {
			action, ok := decodeMinesweeperAction(item)
			if !ok {
				writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的扫雷操作"})
				return minesweeper.StepInput{}, false
			}
			actions = append(actions, action)
		}
		input.Actions = actions
		return input, true
	}
	action, ok := decodeMinesweeperAction(*raw.Action)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的扫雷操作"})
		return minesweeper.StepInput{}, false
	}
	input.Action = &action
	return input, true
}

func decodeMinesweeperAction(raw json.RawMessage) (minesweeper.Action, bool) {
	var payload struct {
		Type     minesweeper.ActionType `json:"type"`
		Position *struct {
			Row int `json:"row"`
			Col int `json:"col"`
		} `json:"position"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return minesweeper.Action{}, false
	}
	if payload.Type != minesweeper.ActionReveal && payload.Type != minesweeper.ActionFlag && payload.Type != minesweeper.ActionChord {
		return minesweeper.Action{}, false
	}
	if payload.Position == nil {
		return minesweeper.Action{}, false
	}
	return minesweeper.Action{
		Type:     payload.Type,
		Position: minesweeper.Position{Row: payload.Position.Row, Col: payload.Position.Col},
	}, true
}
