package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/platform/newapi"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type authHandlers struct {
	deps Dependencies
}

func newAuthHandlers(deps Dependencies) authHandlers {
	return authHandlers{deps: deps}
}

func (handlers authHandlers) me(writer http.ResponseWriter, request *http.Request) {
	user, ok := (economyHandlers{deps: handlers.deps}).requireUser(writer, request)
	if !ok {
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "用户数据库未配置",
		})
		return
	}
	if err := upsertAuthenticatedUser(request.Context(), handlers.deps.DB, *user); err != nil {
		handlers.deps.Logger.Error("同步登录用户失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "同步登录用户失败",
		})
		return
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"user": map[string]any{
			"id":          user.ID,
			"username":    user.Username,
			"displayName": user.DisplayName,
			"isAdmin":     user.IsAdmin,
		},
	})
}

func (handlers authHandlers) login(writer http.ResponseWriter, request *http.Request) {
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if handlers.deps.Redis == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "登录状态存储未配置",
		})
		return
	}
	if strings.TrimSpace(handlers.deps.Config.NewAPIURL) == "" {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "new-api 登录服务未配置",
		})
		return
	}
	if handlers.deps.DB == nil {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "用户数据库未配置",
		})
		return
	}

	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	username := strings.TrimSpace(payload.Username)
	password := strings.TrimSpace(payload.Password)
	normalizedUsername := strings.ToLower(username)
	if username == "" || password == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "用户名和密码不能为空"})
		return
	}

	if locked, remaining, err := getLoginLockStatus(request.Context(), handlers.deps.Redis, normalizedUsername); err != nil {
		handlers.writeAuthDependencyError(writer, "查询登录锁定状态失败", err)
		return
	} else if locked {
		writeJSON(writer, http.StatusTooManyRequests, map[string]any{
			"success":    false,
			"message":    "登录失败次数过多，请 " + strconv.FormatInt(remaining, 10) + " 秒后再试",
			"retryAfter": remaining,
		})
		return
	}

	if handlers.rejectAuthRateLimited(writer, request, clientIP(request), authLoginIPRateLimit) {
		return
	}
	if handlers.rejectAuthRateLimited(writer, request, normalizedUsername, authLoginUserRateLimit) {
		return
	}

	result, err := newapi.Login(request.Context(), handlers.deps.Config.NewAPIURL, username, password, nil)
	if err != nil {
		handlers.deps.Logger.Error("new-api 登录失败", "error", err)
		writeJSON(writer, http.StatusBadGateway, map[string]any{
			"success": false,
			"message": "登录服务暂时不可用",
		})
		return
	}
	if !result.Success || result.User == nil {
		locked, remaining, err := recordLoginFailure(request.Context(), handlers.deps.Redis, normalizedUsername)
		if err != nil {
			handlers.writeAuthDependencyError(writer, "记录登录失败次数失败", err)
			return
		}
		status := http.StatusUnauthorized
		message := result.Message
		if strings.TrimSpace(message) == "" {
			message = "登录失败"
		}
		if locked {
			status = http.StatusTooManyRequests
			message = "登录失败次数过多，请 " + strconv.FormatInt(remaining, 10) + " 秒后再试"
		}
		writeJSON(writer, status, map[string]any{
			"success":    false,
			"message":    message,
			"retryAfter": retryAfterValue(locked, remaining),
		})
		return
	}

	if err := clearLoginFailures(request.Context(), handlers.deps.Redis, normalizedUsername); err != nil {
		handlers.writeAuthDependencyError(writer, "清理登录失败状态失败", err)
		return
	}

	displayName := strings.TrimSpace(result.User.DisplayName)
	if displayName == "" {
		displayName = result.User.Username
	}
	sessionToken, err := auth.CreateSessionToken(auth.SessionData{
		ID:          result.User.ID,
		Username:    result.User.Username,
		DisplayName: displayName,
		Iat:         time.Now().UnixMilli(),
		Exp:         time.Now().Add(auth.SessionTTL).UnixMilli(),
	}, handlers.deps.Config.SessionSecret)
	if err != nil {
		handlers.deps.Logger.Error("创建登录会话失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "创建登录会话失败"})
		return
	}

	if user, ok := auth.ParseSessionToken(sessionToken, handlers.deps.Config.SessionSecret, handlers.deps.Config.AdminUsernames); ok {
		if err := upsertAuthenticatedUser(request.Context(), handlers.deps.DB, *user); err != nil {
			handlers.deps.Logger.Error("同步登录用户失败", "error", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]any{
				"success": false,
				"message": "同步登录用户失败",
			})
			return
		}
	}

	setLoginCookies(writer, request, sessionToken, extractSessionCookie(result.Cookies))
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "登录成功",
		"user": map[string]any{
			"id":          result.User.ID,
			"username":    result.User.Username,
			"displayName": displayName,
		},
	})
}

func (handlers authHandlers) logout(writer http.ResponseWriter, request *http.Request) {
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}

	clearSessionCookies(writer, request)

	token := auth.SessionTokenFromRequest(request)
	if token == "" {
		writeJSON(writer, http.StatusOK, map[string]any{
			"success": true,
			"message": "已退出登录",
		})
		return
	}

	user, ok := auth.ParseSessionToken(
		token,
		handlers.deps.Config.SessionSecret,
		handlers.deps.Config.AdminUsernames,
	)
	if ok {
		if err := revokeSessionToken(request.Context(), handlers.deps.Redis, *user); err != nil {
			handlers.deps.Logger.Error("撤销会话失败", "error", err)
			status := http.StatusInternalServerError
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				status = http.StatusServiceUnavailable
			}
			writeJSON(writer, status, map[string]any{
				"success": false,
				"message": "退出登录失败，请稍后重试",
			})
			return
		}
	}

	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "已退出登录",
	})
}

func (handlers authHandlers) rejectAuthRateLimited(writer http.ResponseWriter, request *http.Request, key string, rule userRateLimitRule) bool {
	result, err := checkAuthRateLimit(request.Context(), handlers.deps.Redis, key, rule)
	if err != nil {
		handlers.writeAuthDependencyError(writer, "登录限流检查失败", err)
		return true
	}
	if result.allowed {
		writer.Header().Set("X-RateLimit-Remaining", strconv.FormatInt(result.remaining, 10))
		writer.Header().Set("X-RateLimit-Reset", strconv.FormatInt(result.resetAt, 10))
		return false
	}
	writer.Header().Set("Retry-After", strconv.FormatInt(result.retryAfter, 10))
	writer.Header().Set("X-RateLimit-Remaining", "0")
	writer.Header().Set("X-RateLimit-Reset", strconv.FormatInt(result.resetAt, 10))
	writeJSON(writer, http.StatusTooManyRequests, map[string]any{
		"success":    false,
		"message":    "请求过于频繁，请稍后再试",
		"retryAfter": result.retryAfter,
	})
	return true
}

func (handlers authHandlers) writeAuthDependencyError(writer http.ResponseWriter, logMessage string, err error) {
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
		"success": false,
		"message": "登录状态暂时不可用，请稍后重试",
	})
}

func retryAfterValue(locked bool, remaining int64) any {
	if !locked {
		return nil
	}
	return remaining
}

func setLoginCookies(writer http.ResponseWriter, request *http.Request, sessionToken string, newAPISession string) {
	secure := request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")
	maxAge := int(auth.SessionTTL.Seconds())
	for _, name := range []string{"app_session", "session"} {
		http.SetCookie(writer, &http.Cookie{
			Name:     name,
			Value:    sessionToken,
			Path:     "/",
			MaxAge:   maxAge,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   secure,
		})
	}
	if newAPISession != "" {
		http.SetCookie(writer, &http.Cookie{
			Name:     "new_api_session",
			Value:    newAPISession,
			Path:     "/",
			MaxAge:   maxAge,
			HttpOnly: true,
			SameSite: http.SameSiteLaxMode,
			Secure:   secure,
		})
		return
	}
	http.SetCookie(writer, &http.Cookie{
		Name:     "new_api_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func extractSessionCookie(rawCookies string) string {
	for _, part := range strings.Split(rawCookies, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "session=") {
			return strings.TrimPrefix(part, "session=")
		}
	}
	return ""
}

func upsertAuthenticatedUser(ctx context.Context, db *pgxpool.Pool, user auth.User) error {
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID, user.Username, displayName,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards, updated_at)
		 VALUES ($1, 0, 0, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
