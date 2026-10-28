package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOIDCRoutesFailClosedWithoutDependencies(t *testing.T) {
	handler := New(testDependencies())
	public := performJSONRequest(handler, http.MethodGet, "/api/auth/oidc/config", "", false)
	if public.Code != http.StatusServiceUnavailable || public.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing OIDC storage must not enable login: %d %s", public.Code, public.Body.String())
	}
	admin := performJSONRequest(handler, http.MethodGet, "/api/admin/auth/oidc", "", false)
	if admin.Code != http.StatusUnauthorized {
		t.Fatalf("OIDC configuration requires an administrator: %d", admin.Code)
	}
	for _, path := range []string{"/api/auth/oidc/login", "/api/auth/oidc/callback"} {
		response := performJSONRequest(handler, http.MethodGet, path, "", false)
		if response.Code != http.StatusFound || !strings.Contains(response.Header().Get("Location"), "oidc_error=unavailable") {
			t.Fatalf("missing dependencies must redirect safely: %s %d", path, response.Code)
		}
		for _, cookie := range response.Result().Cookies() {
			if cookie.Name == "app_session" && cookie.Value != "" {
				t.Fatal("a failed OIDC login must not issue a session")
			}
		}
	}
}

func TestOIDCUnsafeRequestsRejectCrossSiteOrigins(t *testing.T) {
	handler := New(testDependencies())
	for _, test := range []struct{ method, path string }{{http.MethodPut, "/api/admin/auth/oidc"}, {http.MethodPost, "/api/auth/oidc/complete"}} {
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(`{}`))
		request.Host = "example.com"
		request.Header.Set("Origin", "https://evil.example.com")
		response := performRequest(handler, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("cross-site OIDC request accepted: %s %d", test.path, response.Code)
		}
	}
}

func TestOIDCRedirectsStayWithinTheSite(t *testing.T) {
	for _, candidate := range []string{"https://evil.example.com", "//evil.example.com", "/%2f%2fevil.example.com", "/\\evil.example.com", "/\nLocation:evil", "/api/auth/oidc/login", "/login", "/bad%escape"} {
		if got := safeOIDCRedirect(candidate); got != "/" {
			t.Fatalf("unsafe redirect accepted: %q -> %q", candidate, got)
		}
	}
	if got := safeOIDCRedirect("/points?tab=history#latest"); got != "/points?tab=history#latest" {
		t.Fatalf("valid internal destination changed: %q", got)
	}
}

func TestOIDCFlowValuesAndCookies(t *testing.T) {
	first, err := randomOIDCValue()
	if err != nil || len(first) != 43 {
		t.Fatalf("unexpected state: %q %v", first, err)
	}
	second, _ := randomOIDCValue()
	if first == second || oidcHash(first) == first {
		t.Fatal("flow values must be random and hashed in storage")
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.com/api/auth/oidc/login", nil)
	writer := httptest.NewRecorder()
	setOIDCCookie(writer, request, oidcStateCookie, first, 600)
	cookie := writer.Result().Cookies()[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != oidcCookiePath || cookie.MaxAge != 600 {
		t.Fatalf("unsafe OIDC flow cookie: %+v", cookie)
	}
}
