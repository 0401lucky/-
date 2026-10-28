package httpserver

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/oidcconfig"
	"redemption/backend/internal/platform/newapi"
	"redemption/backend/internal/platform/oidclogin"

	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
)

const (
	oidcFlowTTL       = 10 * time.Minute
	oidcCookiePath    = "/api/auth/oidc"
	oidcStateCookie   = "oidc_state"
	oidcPendingCookie = "oidc_pending"
)

var (
	oidcStartRateLimit    = userRateLimitRule{prefix: "ratelimit:auth:oidc:start", windowSeconds: 60, maxRequests: 10}
	oidcCallbackRateLimit = userRateLimitRule{prefix: "ratelimit:auth:oidc:callback", windowSeconds: 60, maxRequests: 20}
	oidcCompleteRateLimit = userRateLimitRule{prefix: "ratelimit:auth:oidc:complete", windowSeconds: 60, maxRequests: 5}
)

type oidcHandlers struct {
	deps     Dependencies
	settings *oidcconfig.Service
}

type oidcFlow struct {
	Revision    string `json:"revision"`
	BrowserHash string `json:"browserHash"`
	Nonce       string `json:"nonce"`
	Verifier    string `json:"verifier"`
	Redirect    string `json:"redirect"`
}

type oidcPending struct {
	Revision string             `json:"revision"`
	Issuer   string             `json:"issuer"`
	Identity oidclogin.Identity `json:"identity"`
	Redirect string             `json:"redirect"`
}

func newOIDCHandlers(deps Dependencies) oidcHandlers {
	return oidcHandlers{deps: deps, settings: oidcconfig.NewService(deps.DB, deps.Config.SessionSecret)}
}

func (handlers oidcHandlers) newAPIClient() (*newapi.Client, error) {
	return newapi.New(newapi.Options{
		BaseURL:          handlers.deps.Config.NewAPIURL,
		AdminAccessToken: handlers.deps.Config.NewAPIAdminAccessToken, AdminUserID: handlers.deps.Config.NewAPIAdminUserID,
		AdminUsername: handlers.deps.Config.NewAPIAdminUsername, AdminPassword: handlers.deps.Config.NewAPIAdminPassword,
		HTTPClient: oidclogin.HTTPClient(),
	})
}

func oidcResponseHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Pragma", "no-cache")
	writer.Header().Set("Referrer-Policy", "no-referrer")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
}

func (handlers oidcHandlers) publicConfig(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	settings, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	_, clientErr := handlers.newAPIClient()
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": map[string]any{
		"enabled":     settings.Enabled && clientErr == nil && handlers.deps.Redis != nil,
		"displayName": settings.DisplayName,
	}})
}

func (handlers oidcHandlers) adminConfig(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	if _, ok := (economyHandlers{deps: handlers.deps}).requireAdmin(writer, request); !ok {
		return
	}
	settings, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	_, clientErr := handlers.newAPIClient()
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "config": settings, "newApiReady": clientErr == nil})
}

func (handlers oidcHandlers) saveConfig(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	admin, ok := shared.requireAdmin(writer, request)
	if !ok {
		return
	}
	var payload struct {
		oidcconfig.Settings
		Secret *string `json:"clientSecret"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "OIDC 配置格式无效"})
		return
	}
	previous, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	hasSecret := previous.ClientSecretConfigured || (payload.Secret != nil && *payload.Secret != "")
	settings, err := oidcconfig.Validate(payload.Settings, hasSecret)
	if err != nil {
		handlers.configError(writer, err)
		return
	}
	if settings.Enabled {
		if _, err := handlers.newAPIClient(); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请先配置福利站的 new-api 管理端连接，以核对用户的 OIDC 绑定"})
			return
		}
		if handlers.deps.Redis == nil {
			handlers.unavailable(writer)
			return
		}
		if _, err := oidclogin.Discover(request.Context(), settings); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "OIDC 发现文档校验失败，请检查 Issuer、发现文档地址及客户端认证方式"})
			return
		}
	}
	settings, err = handlers.settings.Save(request.Context(), settings, payload.Secret, admin.Username)
	if errors.Is(err, oidcconfig.ErrInvalid) {
		handlers.configError(writer, err)
		return
	}
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "config": settings, "message": "OIDC 配置已保存并生效"})
}

func (handlers oidcHandlers) login(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	settings, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", "/")
		return
	}
	redirect := safeOIDCRedirect(request.URL.Query().Get("redirect"))
	if !settings.Enabled {
		handlers.redirectError(writer, request, "disabled", redirect)
		return
	}
	if handlers.deps.Redis == nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	if (authHandlers{deps: handlers.deps}).rejectAuthRateLimited(writer, request, clientIP(request), oidcStartRateLimit) {
		return
	}
	settings, err = handlers.settings.WithSecret(request.Context(), settings)
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	client, err := oidclogin.Discover(request.Context(), settings)
	if err != nil {
		handlers.redirectError(writer, request, "provider_error", redirect)
		return
	}
	state, err := randomOIDCValue()
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	browser, err := randomOIDCValue()
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	nonce, err := randomOIDCValue()
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	flow := oidcFlow{Revision: settings.Revision, BrowserHash: oidcHash(browser), Nonce: nonce,
		Verifier: oauth2.GenerateVerifier(), Redirect: redirect}
	raw, _ := json.Marshal(flow)
	if err := handlers.deps.Redis.Set(request.Context(), "auth:oidc:state:"+oidcHash(state), raw, oidcFlowTTL).Err(); err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	clearOIDCFlowCookies(writer, request)
	setOIDCCookie(writer, request, oidcStateCookie, browser, int(oidcFlowTTL.Seconds()))
	http.Redirect(writer, request, client.AuthorizationURL(state, nonce, flow.Verifier), http.StatusFound)
}

func (handlers oidcHandlers) callback(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	if handlers.deps.Redis == nil {
		handlers.redirectError(writer, request, "unavailable", "/")
		return
	}
	if (authHandlers{deps: handlers.deps}).rejectAuthRateLimited(writer, request, clientIP(request), oidcCallbackRateLimit) {
		return
	}
	state := request.URL.Query().Get("state")
	browser, cookieErr := request.Cookie(oidcStateCookie)
	if cookieErr != nil || len(state) != 43 || len(browser.Value) != 43 {
		handlers.redirectError(writer, request, "invalid_state", "/")
		return
	}
	key := "auth:oidc:state:" + oidcHash(state)
	raw, err := handlers.deps.Redis.Get(request.Context(), key).Bytes()
	var flow oidcFlow
	if err != nil || json.Unmarshal(raw, &flow) != nil || subtle.ConstantTimeCompare([]byte(flow.BrowserHash), []byte(oidcHash(browser.Value))) != 1 {
		handlers.redirectError(writer, request, "invalid_state", "/")
		return
	}
	// GETDEL makes a callback single-use even when two replicas receive it simultaneously.
	consumed, err := handlers.deps.Redis.GetDel(request.Context(), key).Bytes()
	if err != nil || subtle.ConstantTimeCompare(consumed, raw) != 1 {
		handlers.redirectError(writer, request, "invalid_state", flow.Redirect)
		return
	}
	setOIDCCookie(writer, request, oidcStateCookie, "", -1)
	settings, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", flow.Redirect)
		return
	}
	if !settings.Enabled || settings.Revision != flow.Revision {
		handlers.redirectError(writer, request, "config_changed", flow.Redirect)
		return
	}
	if issuer := request.URL.Query().Get("iss"); issuer != "" && issuer != settings.IssuerURL {
		handlers.redirectError(writer, request, "verification_failed", flow.Redirect)
		return
	}
	if request.URL.Query().Get("error") != "" {
		handlers.redirectError(writer, request, "cancelled", flow.Redirect)
		return
	}
	code := request.URL.Query().Get("code")
	if code == "" || len(code) > 4096 {
		handlers.redirectError(writer, request, "verification_failed", flow.Redirect)
		return
	}
	settings, err = handlers.settings.WithSecret(request.Context(), settings)
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", flow.Redirect)
		return
	}
	client, err := oidclogin.Discover(request.Context(), settings)
	if err != nil {
		handlers.redirectError(writer, request, "provider_error", flow.Redirect)
		return
	}
	identity, err := client.Exchange(request.Context(), code, flow.Nonce, flow.Verifier)
	if err != nil {
		handlers.redirectError(writer, request, "verification_failed", flow.Redirect)
		return
	}
	user, err := handlers.resolveUser(request.Context(), settings, identity, "")
	if errors.Is(err, newapi.ErrOIDCNotBound) {
		handlers.beginPending(writer, request, settings, identity, flow.Redirect)
		return
	}
	if err != nil {
		handlers.redirectError(writer, request, oidcAccountError(err), flow.Redirect)
		return
	}
	if err := handlers.finishLogin(writer, request, settings, identity, user); err != nil {
		handlers.redirectError(writer, request, "unavailable", flow.Redirect)
		return
	}
	http.Redirect(writer, request, safeOIDCRedirect(flow.Redirect), http.StatusFound)
}

func (handlers oidcHandlers) beginPending(writer http.ResponseWriter, request *http.Request, settings oidcconfig.Settings, identity oidclogin.Identity, redirect string) {
	value, err := randomOIDCValue()
	if err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	pending := oidcPending{Revision: settings.Revision, Issuer: settings.IssuerURL, Identity: identity, Redirect: redirect}
	raw, _ := json.Marshal(pending)
	if err := handlers.deps.Redis.Set(request.Context(), "auth:oidc:pending:"+oidcHash(value), raw, oidcFlowTTL).Err(); err != nil {
		handlers.redirectError(writer, request, "unavailable", redirect)
		return
	}
	setOIDCCookie(writer, request, oidcPendingCookie, value, int(oidcFlowTTL.Seconds()))
	query := url.Values{"oidc_pending": {"1"}, "redirect": {safeOIDCRedirect(redirect)}}
	http.Redirect(writer, request, "/login?"+query.Encode(), http.StatusFound)
}

// Users with different Casdoor/new-api names can identify their account without sharing a password.
// The supplied name is accepted only if new-api already binds it to the verified OIDC identity.
func (handlers oidcHandlers) complete(writer http.ResponseWriter, request *http.Request) {
	oidcResponseHeaders(writer)
	if (economyHandlers{deps: handlers.deps}).rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if handlers.deps.Redis == nil {
		handlers.unavailable(writer)
		return
	}
	if (authHandlers{deps: handlers.deps}).rejectAuthRateLimited(writer, request, clientIP(request), oidcCompleteRateLimit) {
		return
	}
	cookie, err := request.Cookie(oidcPendingCookie)
	if err != nil || len(cookie.Value) != 43 {
		handlers.expiredPending(writer)
		return
	}
	key := "auth:oidc:pending:" + oidcHash(cookie.Value)
	raw, err := handlers.deps.Redis.Get(request.Context(), key).Bytes()
	var pending oidcPending
	if err != nil || json.Unmarshal(raw, &pending) != nil {
		handlers.expiredPending(writer)
		return
	}
	settings, err := handlers.settings.Get(request.Context())
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	if !settings.Enabled || settings.Revision != pending.Revision || settings.IssuerURL != pending.Issuer {
		handlers.expiredPending(writer)
		return
	}
	var payload struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1024)).Decode(&payload); err != nil || strings.TrimSpace(payload.Username) == "" || len(payload.Username) > 256 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请填写已绑定当前 Casdoor 身份的 new-api 用户名"})
		return
	}
	user, err := handlers.resolveUser(request.Context(), settings, pending.Identity, strings.TrimSpace(payload.Username))
	if errors.Is(err, newapi.ErrOIDCNotBound) || errors.Is(err, newapi.ErrOIDCUserDisabled) || errors.Is(err, newapi.ErrOIDCAmbiguous) {
		writeJSON(writer, http.StatusUnauthorized, map[string]any{"success": false, "message": "未找到可登录的绑定账号，请先在 new-api 绑定当前身份并确认账号已启用"})
		return
	}
	if err != nil {
		handlers.unavailable(writer)
		return
	}
	consumed, err := handlers.deps.Redis.GetDel(request.Context(), key).Bytes()
	if err != nil || subtle.ConstantTimeCompare(consumed, raw) != 1 {
		handlers.expiredPending(writer)
		return
	}
	if err := handlers.finishLogin(writer, request, settings, pending.Identity, user); err != nil {
		handlers.unavailable(writer)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "redirect": safeOIDCRedirect(pending.Redirect)})
}

func (handlers oidcHandlers) resolveUser(ctx context.Context, settings oidcconfig.Settings, identity oidclogin.Identity, username string) (*newapi.User, error) {
	if handlers.deps.DB == nil {
		return nil, oidcconfig.ErrUnavailable
	}
	var userID int64
	err := handlers.deps.DB.QueryRow(ctx, `SELECT user_id FROM oidc_identities WHERE issuer = $1 AND subject = $2`, settings.IssuerURL, identity.Subject).Scan(&userID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	client, err := handlers.newAPIClient()
	if err != nil {
		return nil, err
	}
	email := identity.Email
	if username == "" {
		username = identity.Username
	} else {
		email = ""
	}
	return client.ResolveOIDCAccount(ctx, newapi.OIDCAccountQuery{
		Provider: settings.NewAPIProvider, ProviderID: settings.NewAPIProviderID, Subject: identity.BindingSubject,
		Username: username, Email: email, KnownUserID: userID,
	})
}

func (handlers oidcHandlers) finishLogin(writer http.ResponseWriter, request *http.Request, settings oidcconfig.Settings, identity oidclogin.Identity, user *newapi.User) error {
	token, err := auth.CreateSessionToken(auth.SessionData{
		ID: user.ID, Username: user.Username, DisplayName: user.DisplayName,
		Iat: time.Now().UnixMilli(), Exp: time.Now().Add(auth.SessionTTL).UnixMilli(),
	}, handlers.deps.Config.SessionSecret)
	if err != nil {
		return err
	}
	tx, err := handlers.deps.DB.Begin(request.Context())
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(request.Context()) }()
	// Serialize with configuration saves so disabling/changing OIDC also stops in-flight logins.
	if _, err := tx.Exec(request.Context(), `SELECT pg_advisory_xact_lock(73380241)`); err != nil {
		return err
	}
	var currentRevision string
	if err := tx.QueryRow(request.Context(), `SELECT revision FROM oidc_config WHERE id = 'default'`).Scan(&currentRevision); err != nil {
		return err
	}
	if currentRevision != settings.Revision {
		return errors.New("OIDC configuration changed during login")
	}
	if err := upsertAuthenticatedUserTx(request.Context(), tx, auth.User{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName}); err != nil {
		return err
	}
	result, err := tx.Exec(request.Context(),
		`INSERT INTO oidc_identities (issuer, subject, user_id) VALUES ($1, $2, $3)
		 ON CONFLICT (issuer, subject) DO UPDATE SET updated_at = now()
		 WHERE oidc_identities.user_id = excluded.user_id`,
		settings.IssuerURL, identity.Subject, user.ID,
	)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("OIDC identity is already linked to another account")
	}
	if err := tx.Commit(request.Context()); err != nil {
		return err
	}
	setLoginCookies(writer, request, token, "")
	clearOIDCFlowCookies(writer, request)
	return nil
}

func (handlers oidcHandlers) configError(writer http.ResponseWriter, err error) {
	message := strings.TrimPrefix(err.Error(), oidcconfig.ErrInvalid.Error()+": ")
	writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": message})
}

func (handlers oidcHandlers) unavailable(writer http.ResponseWriter) {
	writeJSON(writer, http.StatusServiceUnavailable, map[string]any{"success": false, "message": "OIDC 登录服务暂时不可用，请稍后重试"})
}

func (handlers oidcHandlers) expiredPending(writer http.ResponseWriter) {
	writeJSON(writer, http.StatusUnauthorized, map[string]any{"success": false, "code": "OIDC_EXPIRED", "message": "身份验证已过期，请重新通过身份服务登录"})
}

func (handlers oidcHandlers) redirectError(writer http.ResponseWriter, request *http.Request, code, redirect string) {
	query := url.Values{"oidc_error": {code}, "redirect": {safeOIDCRedirect(redirect)}}
	http.Redirect(writer, request, "/login?"+query.Encode(), http.StatusFound)
}

func oidcAccountError(err error) string {
	if errors.Is(err, newapi.ErrOIDCUserDisabled) {
		return "account_disabled"
	}
	if errors.Is(err, newapi.ErrOIDCAmbiguous) {
		return "account_ambiguous"
	}
	return "unavailable"
}

func safeOIDCRedirect(candidate string) string {
	value := strings.TrimSpace(candidate)
	decoded, err := url.PathUnescape(value)
	if err != nil || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || !strings.HasPrefix(decoded, "/") || strings.HasPrefix(decoded, "//") || strings.ContainsAny(value+decoded, "\\\r\n\t") {
		return "/"
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || strings.HasPrefix(parsed.Path, "/api/auth/") || parsed.Path == "/login" {
		return "/"
	}
	return value
}

func randomOIDCValue() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func oidcHash(value string) string {
	hash := sha256.Sum256([]byte(value))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

func setOIDCCookie(writer http.ResponseWriter, request *http.Request, name, value string, maxAge int) {
	http.SetCookie(writer, &http.Cookie{Name: name, Value: value, Path: oidcCookiePath, MaxAge: maxAge,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
		Secure: request.TLS != nil || strings.EqualFold(request.Header.Get("X-Forwarded-Proto"), "https")})
}

func clearOIDCFlowCookies(writer http.ResponseWriter, request *http.Request) {
	setOIDCCookie(writer, request, oidcStateCookie, "", -1)
	setOIDCCookie(writer, request, oidcPendingCookie, "", -1)
}
