package httpserver

import (
	"errors"
	"net/http"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/gamesummary"
)

type gameSummaryHandlers struct {
	deps    Dependencies
	service *gamesummary.Service
}

func newGameSummaryHandlers(deps Dependencies) gameSummaryHandlers {
	return gameSummaryHandlers{
		deps:    deps,
		service: gamesummary.NewService(deps.DB),
	}
}

func (handlers gameSummaryHandlers) getOverview(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	data, err := handlers.service.GetOverview(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询游戏概览失败", err)
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers gameSummaryHandlers) getProfile(writer http.ResponseWriter, request *http.Request) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return
	}

	data, err := handlers.service.GetProfile(request.Context(), *user)
	if err != nil {
		handlers.writeServiceError(writer, "查询游戏个人战绩失败", err)
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers gameSummaryHandlers) requireUser(writer http.ResponseWriter, request *http.Request) (*auth.User, bool) {
	user, ok := auth.UserFromRequest(
		request,
		handlers.deps.Config.SessionSecret,
		handlers.deps.Config.AdminUsernames,
	)
	if !ok {
		writeJSON(writer, http.StatusUnauthorized, map[string]any{
			"success": false,
			"message": "未登录",
		})
		return nil, false
	}
	return user, true
}

func (handlers gameSummaryHandlers) writeServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, gamesummary.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"code":    "DATABASE_UNAVAILABLE",
			"message": "游戏数据服务暂不可用",
		})
		return
	}

	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{
		"success": false,
		"message": "服务器错误",
	})
}
