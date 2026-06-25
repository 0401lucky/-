package httpserver

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"redemption/backend/internal/config"
)

func TestLotteryHandlersRequireAuthAndDatabase(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	anonymous := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/lottery", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous lottery 401, got %d body=%s", anonymous.Code, anonymous.Body.String())
	}

	request := httptest.NewRequest(http.MethodGet, "/api/lottery", nil)
	request.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "抽奖数据库未配置") {
		t.Fatalf("expected no-db lottery 503, got %d body=%s", response.Code, response.Body.String())
	}
}

func TestLotterySpinHandlerRequiresTrustedOriginAuthAndDatabase(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	crossSite := httptest.NewRequest(http.MethodPost, "/api/lottery/spin", nil)
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden {
		t.Fatalf("expected cross-site lottery spin 403, got %d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	anonymous := httptest.NewRequest(http.MethodPost, "/api/lottery/spin", nil)
	anonymous.Header.Set("Origin", "http://example.com")
	anonymousResponse := performRequest(handler, anonymous)
	if anonymousResponse.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous lottery spin 401, got %d body=%s", anonymousResponse.Code, anonymousResponse.Body.String())
	}

	request := httptest.NewRequest(http.MethodPost, "/api/lottery/spin", nil)
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "抽奖数据库未配置") {
		t.Fatalf("expected no-db lottery spin 503, got %d body=%s", response.Code, response.Body.String())
	}
}

func TestLotteryAdminHandlerRequiresAdmin(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	request := httptest.NewRequest(http.MethodGet, "/api/admin/lottery", nil)
	request.AddCookie(testSessionCookieFor(992, "lottery_user", "Lottery User"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected non-admin lottery 403, got %d body=%s", response.Code, response.Body.String())
	}
}

func TestLotteryAdminConfigPatchRequiresTrustedAdminAndDatabase(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	crossSite := httptest.NewRequest(http.MethodPatch, "/api/admin/lottery/config", strings.NewReader(`{}`))
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden {
		t.Fatalf("expected cross-site admin lottery config 403, got %d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	nonAdmin := httptest.NewRequest(http.MethodPatch, "/api/admin/lottery/config", strings.NewReader(`{}`))
	nonAdmin.Header.Set("Origin", "http://example.com")
	nonAdmin.AddCookie(testSessionCookieFor(992, "lottery_user", "Lottery User"))
	nonAdminResponse := performRequest(handler, nonAdmin)
	if nonAdminResponse.Code != http.StatusForbidden {
		t.Fatalf("expected non-admin lottery config 403, got %d body=%s", nonAdminResponse.Code, nonAdminResponse.Body.String())
	}

	request := httptest.NewRequest(http.MethodPatch, "/api/admin/lottery/config", strings.NewReader(`{}`))
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "抽奖数据库未配置") {
		t.Fatalf("expected no-db admin lottery config 503, got %d body=%s", response.Code, response.Body.String())
	}
}

func TestLotteryLegacyAdminToolsAreTombstoned(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	nonAdmin := httptest.NewRequest(http.MethodGet, "/api/admin/lottery/debug", nil)
	nonAdmin.AddCookie(testSessionCookieFor(992, "lottery_user", "Lottery User"))
	nonAdminResponse := performRequest(handler, nonAdmin)
	if nonAdminResponse.Code != http.StatusForbidden {
		t.Fatalf("expected non-admin legacy lottery tool 403, got %d body=%s", nonAdminResponse.Code, nonAdminResponse.Body.String())
	}

	crossSite := httptest.NewRequest(http.MethodPost, "/api/admin/lottery/recalculate", nil)
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden {
		t.Fatalf("expected cross-site legacy lottery tool 403, got %d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/admin/lottery/debug", nil),
		httptest.NewRequest(http.MethodPost, "/api/admin/lottery/recalculate", nil),
		httptest.NewRequest(http.MethodPost, "/api/admin/lottery/reset", nil),
		httptest.NewRequest(http.MethodGet, "/api/admin/lottery/tiers/pts_100/codes", nil),
		httptest.NewRequest(http.MethodPost, "/api/admin/lottery/tiers/pts_100/codes", nil),
		httptest.NewRequest(http.MethodDelete, "/api/admin/lottery/tiers/pts_100/codes", nil),
		httptest.NewRequest(http.MethodGet, "/api/admin/lottery/tiers/pts_100/detail", nil),
	} {
		request.Header.Set("Origin", "http://example.com")
		request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
		response := performRequest(handler, request)
		if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), "旧彩票兑换码工具已停用") {
			t.Fatalf("expected legacy lottery tool 410 for %s %s, got %d body=%s", request.Method, request.URL.Path, response.Code, response.Body.String())
		}
	}
}

func TestNumberBombHandlersRequireAuthOriginAndDatabase(t *testing.T) {
	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	state := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/lottery/number-bomb", nil))
	if state.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous number bomb state 401, got %d body=%s", state.Code, state.Body.String())
	}

	crossSite := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/bet", strings.NewReader(`{"selectedNumber":1,"multiplier":1}`))
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden {
		t.Fatalf("expected cross-site number bomb bet 403, got %d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	badPayload := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/bet", strings.NewReader(`{}`))
	badPayload.Header.Set("Origin", "http://example.com")
	badPayload.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	badPayloadResponse := performRequest(handler, badPayload)
	if badPayloadResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected bad number bomb payload without db 503, got %d body=%s", badPayloadResponse.Code, badPayloadResponse.Body.String())
	}

	bet := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/bet", strings.NewReader(`{"selectedNumber":1,"multiplier":1}`))
	bet.Header.Set("Origin", "http://example.com")
	bet.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	betResponse := performRequest(handler, bet)
	if betResponse.Code != http.StatusServiceUnavailable || !strings.Contains(betResponse.Body.String(), "抽奖数据库未配置") {
		t.Fatalf("expected no-db number bomb bet 503, got %d body=%s", betResponse.Code, betResponse.Body.String())
	}

	cancel := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/cancel", nil)
	cancel.Header.Set("Origin", "http://example.com")
	cancel.AddCookie(testSessionCookieFor(991, "lottery_unit", "Lottery Unit"))
	cancelResponse := performRequest(handler, cancel)
	if cancelResponse.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected no-db number bomb cancel 503, got %d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}

	admin := httptest.NewRequest(http.MethodGet, "/api/admin/lottery/number-bomb", nil)
	admin.AddCookie(testSessionCookieFor(992, "lottery_user", "Lottery User"))
	adminResponse := performRequest(handler, admin)
	if adminResponse.Code != http.StatusForbidden {
		t.Fatalf("expected non-admin number bomb admin 403, got %d body=%s", adminResponse.Code, adminResponse.Body.String())
	}
}
