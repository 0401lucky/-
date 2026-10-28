//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/oidcconfig"
	"redemption/backend/internal/testutil"

	"github.com/redis/go-redis/v9"
)

func TestOIDCLoginFlowWithLiveStorage(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" || os.Getenv("TEST_REDIS_URL") == "" {
		t.Skip("TEST_DATABASE_URL 或 TEST_REDIS_URL 未设置，跳过 OIDC 集成测试")
	}
	ctx := context.Background()
	db, closeDB := openAdminConfigHTTPDatabase(t, ctx)
	defer closeDB()
	redisOptions, err := redis.ParseURL(os.Getenv("TEST_REDIS_URL"))
	if err != nil {
		t.Fatal(err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()
	provider := testutil.NewOIDCProvider(t)
	provider.UserInfo = func(string) map[string]any {
		return map[string]any{"sub": provider.Subject, "preferred_username": "casdoor-user", "email": "identity@example.com"}
	}
	var bound, active atomic.Bool
	bound.Store(true)
	active.Store(true)
	var searchCount atomic.Int64
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		var data any
		switch request.URL.Path {
		case "/api/user/search":
			searchCount.Add(1)
			items := []map[string]any{}
			if request.URL.Query().Get("keyword") == "newapi-user" {
				items = append(items, map[string]any{"id": 77, "username": "newapi-user", "email": "newapi@example.com"})
			}
			data = map[string]any{"items": items, "total": len(items)}
		case "/api/user/77":
			status := 1
			if !active.Load() {
				status = 2
			}
			subject := provider.Subject
			if !bound.Load() {
				subject = "other-subject"
			}
			data = map[string]any{"id": 77, "username": "newapi-user", "display_name": "OIDC User", "status": status, "oidc_id": subject, "DeletedAt": nil}
		default:
			http.NotFound(writer, request)
			return
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"success": true, "data": data})
	}))
	defer newAPIServer.Close()
	deps := adminConfigHTTPDependencies(db)
	deps.Redis = redisClient
	deps.Config.NewAPIURL = newAPIServer.URL
	deps.Config.NewAPIAdminAccessToken = "test-admin-token"
	deps.Config.NewAPIAdminUserID = "1"
	handler := New(deps)

	if err := upsertAuthenticatedUser(ctx, db, auth.User{ID: 77, Username: "newapi-user", DisplayName: "Before OIDC"}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE point_accounts SET balance = 321 WHERE user_id = 77`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `UPDATE user_assets SET extra_spins = 2, card_draws = 3, makeup_cards = 4 WHERE user_id = 77`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM oidc_identities WHERE issuer = $1`, provider.Server.URL)
		_, _ = db.Exec(ctx, `DELETE FROM oidc_config WHERE id = 'default'`)
	}()

	settings := provider.Settings()
	secret := provider.ClientSecret
	save := func(withSecret bool) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(settings)
		var payload map[string]any
		_ = json.Unmarshal(raw, &payload)
		if withSecret {
			payload["clientSecret"] = secret
		}
		body, _ := json.Marshal(payload)
		request := httptest.NewRequest(http.MethodPut, "/api/admin/auth/oidc", strings.NewReader(string(body)))
		request.Host = "localhost"
		request.Header.Set("Origin", "http://localhost")
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
		return performRequest(handler, request)
	}
	if response := save(true); response.Code != http.StatusOK || strings.Contains(response.Body.String(), secret) {
		t.Fatalf("admin save failed or revealed a secret: %d %s", response.Code, response.Body.String())
	}
	var encrypted string
	if err := db.QueryRow(ctx, `SELECT encrypted_client_secret FROM oidc_config WHERE id = 'default'`).Scan(&encrypted); err != nil || encrypted == secret || !strings.HasPrefix(encrypted, "v1:") {
		t.Fatalf("client secret was not encrypted: %v", err)
	}
	public := performJSONRequest(handler, http.MethodGet, "/api/auth/oidc/config", "", false)
	if public.Code != http.StatusOK || !strings.Contains(public.Body.String(), `"enabled":true`) || strings.Contains(public.Body.String(), "clientId") || strings.Contains(public.Body.String(), secret) {
		t.Fatalf("unexpected public configuration: %d %s", public.Code, public.Body.String())
	}

	start := func() (url.Values, *http.Cookie) {
		t.Helper()
		response := performJSONRequest(handler, http.MethodGet, "/api/auth/oidc/login?redirect=%2Fpoints%3Ftab%3Dhistory", "", false)
		location, err := url.Parse(response.Header().Get("Location"))
		if err != nil || response.Code != http.StatusFound || location.Path != "/authorize" {
			t.Fatalf("login start failed: %d %s", response.Code, response.Header().Get("Location"))
		}
		var browser *http.Cookie
		for _, cookie := range response.Result().Cookies() {
			if cookie.Name == oidcStateCookie && cookie.Value != "" {
				browser = cookie
			}
		}
		if browser == nil {
			t.Fatal("login must bind state to a browser cookie")
		}
		return location.Query(), browser
	}
	callback := func(query url.Values, browser *http.Cookie) *httptest.ResponseRecorder {
		parameters := url.Values{"state": {query.Get("state")}, "code": {query.Get("nonce")}}
		request := httptest.NewRequest(http.MethodGet, oidcconfig.CallbackPath+"?"+parameters.Encode(), nil)
		request.AddCookie(browser)
		return performRequest(handler, request)
	}
	assertNoSession := func(response *httptest.ResponseRecorder) {
		t.Helper()
		for _, cookie := range response.Result().Cookies() {
			if cookie.Name == "app_session" && cookie.Value != "" {
				t.Fatal("failed or pending authentication issued a session")
			}
		}
	}

	query, browser := start()
	forged := callback(query, &http.Cookie{Name: oidcStateCookie, Value: strings.Repeat("x", 43)})
	if !strings.Contains(forged.Header().Get("Location"), "invalid_state") {
		t.Fatal("state must be bound to the initiating browser")
	}
	assertNoSession(forged)
	if exists := redisClient.Exists(ctx, "auth:oidc:state:"+oidcHash(query.Get("state"))).Val(); exists != 1 {
		t.Fatal("a forged callback must not consume the legitimate browser's state")
	}
	pendingResponse := callback(query, browser)
	if !strings.Contains(pendingResponse.Header().Get("Location"), "oidc_pending=1") {
		t.Fatalf("different usernames should prompt for the bound account: %s", pendingResponse.Header().Get("Location"))
	}
	assertNoSession(pendingResponse)
	var pendingCookie *http.Cookie
	for _, cookie := range pendingResponse.Result().Cookies() {
		if cookie.Name == oidcPendingCookie && cookie.Value != "" {
			pendingCookie = cookie
		}
	}
	if pendingCookie == nil {
		t.Fatal("pending authentication must use an HttpOnly browser cookie")
	}
	complete := func(username, origin string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"username": username})
		request := httptest.NewRequest(http.MethodPost, "/api/auth/oidc/complete", strings.NewReader(string(body)))
		request.Host = "localhost"
		request.Header.Set("Origin", origin)
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(pendingCookie)
		return performRequest(handler, request)
	}
	if response := complete("newapi-user", "https://evil.example.com"); response.Code != http.StatusForbidden {
		t.Fatal("cross-site account confirmation must be rejected")
	}
	if response := complete("unbound-user", "http://localhost"); response.Code != http.StatusUnauthorized {
		t.Fatalf("an unbound username must not authorize login: %d", response.Code)
	}
	response := complete("newapi-user", "http://localhost")
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"redirect":"/points?tab=history"`) {
		t.Fatalf("bound account confirmation failed: %d %s", response.Code, response.Body.String())
	}
	var session *auth.User
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == "app_session" {
			session, _ = auth.ParseSessionToken(cookie.Value, testSessionSecret, nil)
		}
		if cookie.Name == "new_api_session" && cookie.Value != "" {
			t.Fatal("OIDC must not reuse another account's new-api session cookie")
		}
	}
	if session == nil || session.ID != 77 || session.Username != "newapi-user" {
		t.Fatalf("OIDC login did not retain the new-api user ID: %+v", session)
	}
	var balance, spins, draws, makeup, identityUser int64
	if err := db.QueryRow(ctx, `SELECT p.balance, a.extra_spins, a.card_draws, a.makeup_cards FROM point_accounts p JOIN user_assets a ON a.user_id = p.user_id WHERE p.user_id = 77`).Scan(&balance, &spins, &draws, &makeup); err != nil {
		t.Fatal(err)
	}
	if balance != 321 || spins != 2 || draws != 3 || makeup != 4 {
		t.Fatalf("OIDC login reset existing assets: %d %d %d %d", balance, spins, draws, makeup)
	}
	if err := db.QueryRow(ctx, `SELECT user_id FROM oidc_identities WHERE issuer = $1 AND subject = $2`, provider.Server.URL, provider.Subject).Scan(&identityUser); err != nil || identityUser != 77 {
		t.Fatalf("stable identity binding was not saved: %d %v", identityUser, err)
	}
	if replay := complete("newapi-user", "http://localhost"); replay.Code != http.StatusUnauthorized {
		t.Fatal("pending authentication must be consumed exactly once")
	}
	if replay := callback(query, browser); !strings.Contains(replay.Header().Get("Location"), "invalid_state") {
		t.Fatal("a callback must be consumed exactly once")
	}

	searchesBefore := searchCount.Load()
	query, browser = start()
	if direct := callback(query, browser); direct.Header().Get("Location") != "/points?tab=history" {
		t.Fatalf("a saved identity should log in without a username prompt: %s", direct.Header().Get("Location"))
	}
	if searchCount.Load() != searchesBefore {
		t.Fatal("subsequent login must use the stable account binding")
	}
	active.Store(false)
	query, browser = start()
	disabled := callback(query, browser)
	assertNoSession(disabled)
	if !strings.Contains(disabled.Header().Get("Location"), "account_disabled") {
		t.Fatal("disabled new-api accounts must be rejected")
	}
	active.Store(true)
	bound.Store(false)
	query, browser = start()
	assertNoSession(callback(query, browser))
	bound.Store(true)

	query, browser = start()
	settings.DisplayName = "Updated SSO"
	if saved := save(false); saved.Code != http.StatusOK {
		t.Fatalf("saving without a secret must retain it: %d %s", saved.Code, saved.Body.String())
	}
	changed := callback(query, browser)
	assertNoSession(changed)
	if !strings.Contains(changed.Header().Get("Location"), "config_changed") {
		t.Fatal("configuration changes must invalidate outstanding login flows")
	}

	query, browser = start()
	var results [2]*httptest.ResponseRecorder
	var group sync.WaitGroup
	for index := range results {
		group.Add(1)
		go func(index int) { defer group.Done(); results[index] = callback(query, browser) }(index)
	}
	group.Wait()
	successes := 0
	for _, result := range results {
		if result.Header().Get("Location") == "/points?tab=history" {
			successes++
		} else {
			assertNoSession(result)
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent callbacks must produce one login: %d", successes)
	}

	settings.Enabled = false
	if saved := save(false); saved.Code != http.StatusOK {
		t.Fatal("OIDC could not be disabled")
	}
	public = performJSONRequest(handler, http.MethodGet, "/api/auth/oidc/config", "", false)
	if !strings.Contains(public.Body.String(), `"enabled":false`) {
		t.Fatal("saved settings must take effect immediately")
	}
}
