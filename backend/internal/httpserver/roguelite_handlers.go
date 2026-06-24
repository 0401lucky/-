package httpserver

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"redemption/backend/internal/roguelite"
)

type rogueliteHandlers struct {
	deps    Dependencies
	service *roguelite.Service
}

func newRogueliteHandlers(deps Dependencies) rogueliteHandlers {
	return rogueliteHandlers{
		deps:    deps,
		service: roguelite.NewService(deps.DB),
	}
}

func (handlers rogueliteHandlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	data, err := handlers.service.Status(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询星尘迷阵状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": data})
}

func (handlers rogueliteHandlers) start(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "开始星尘迷阵失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    roguelite.BuildSessionView(*result.Session),
	})
}

func (handlers rogueliteHandlers) step(writer http.ResponseWriter, request *http.Request) {
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
	input, ok := decodeRogueliteStepInput(writer, request)
	if !ok {
		return
	}
	result, err := handlers.service.Step(request.Context(), *user, input)
	if err != nil {
		handlers.writeServiceError(writer, "推进星尘迷阵会话失败", err)
		return
	}
	if !result.Success {
		payload := map[string]any{"success": false, "message": result.Message}
		if result.Session != nil {
			payload["data"] = map[string]any{"session": result.Session}
		}
		writeJSON(writer, http.StatusBadRequest, payload)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"session": result.Session,
			"outcome": result.Outcome,
		},
	})
}

func (handlers rogueliteHandlers) submit(writer http.ResponseWriter, request *http.Request) {
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
	var payload roguelite.SubmitInput
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
		handlers.writeServiceError(writer, "星尘迷阵结算失败", err)
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

func (handlers rogueliteHandlers) cancel(writer http.ResponseWriter, request *http.Request) {
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
		handlers.writeServiceError(writer, "取消星尘迷阵失败", err)
		return
	}
	if !result.Success {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Message})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "message": "游戏已取消"})
}

func (handlers rogueliteHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, roguelite.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "星尘迷阵数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}

func decodeRogueliteStepInput(writer http.ResponseWriter, request *http.Request) (roguelite.StepInput, bool) {
	var raw struct {
		SessionID string           `json:"sessionId"`
		Action    *json.RawMessage `json:"action"`
	}
	if err := json.NewDecoder(request.Body).Decode(&raw); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return roguelite.StepInput{}, false
	}
	if strings.TrimSpace(raw.SessionID) == "" || raw.Action == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数错误"})
		return roguelite.StepInput{}, false
	}
	action, ok := decodeRogueliteAction(*raw.Action)
	if !ok {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "无效的行动参数"})
		return roguelite.StepInput{}, false
	}
	return roguelite.StepInput{SessionID: raw.SessionID, Action: action}, true
}

func decodeRogueliteAction(raw json.RawMessage) (roguelite.Action, bool) {
	var payload struct {
		Type string `json:"type"`
		To   *struct {
			Row int `json:"row"`
			Col int `json:"col"`
		} `json:"to"`
		Style    string `json:"style"`
		OptionID string `json:"optionId"`
		ItemID   string `json:"itemId"`
		Open     *bool  `json:"open"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return roguelite.Action{}, false
	}
	switch payload.Type {
	case "move":
		if payload.To == nil {
			return roguelite.Action{}, false
		}
		to := roguelite.Position{Row: payload.To.Row, Col: payload.To.Col}
		if !roguelite.IsValidWorldPosition(to) {
			return roguelite.Action{}, false
		}
		return roguelite.Action{Type: "move", To: to}, true
	case "combat":
		if payload.Style != "attack" && payload.Style != "guard" && payload.Style != "skill" {
			return roguelite.Action{}, false
		}
		return roguelite.Action{Type: "combat", Style: payload.Style}, true
	case "event":
		if strings.TrimSpace(payload.OptionID) == "" {
			return roguelite.Action{}, false
		}
		return roguelite.Action{Type: "event", OptionID: payload.OptionID}, true
	case "shop":
		if strings.TrimSpace(payload.ItemID) == "" {
			return roguelite.Action{}, false
		}
		return roguelite.Action{Type: "shop", ItemID: payload.ItemID}, true
	case "chest":
		if payload.Open == nil {
			return roguelite.Action{}, false
		}
		return roguelite.Action{Type: "chest", Open: *payload.Open}, true
	case "escape":
		return roguelite.Action{Type: "escape"}, true
	default:
		return roguelite.Action{}, false
	}
}
