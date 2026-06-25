package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthMeRequiresLoginAndDatabase(t *testing.T) {
	handler := New(testDependencies())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/auth/me", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated auth me response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	authenticated := performJSONRequest(handler, http.MethodGet, "/api/auth/me", "", true)
	if authenticated.Code != http.StatusServiceUnavailable || !strings.Contains(authenticated.Body.String(), "用户数据库未配置") {
		t.Fatalf("expected unavailable auth me response, got status=%d body=%s", authenticated.Code, authenticated.Body.String())
	}
}

func TestLoginRequiresRedisAndNewAPI(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/auth/login", `{"username":"alice","password":"secret"}`, false)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "登录状态存储未配置") {
		t.Fatalf("expected redis unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLoginRejectsCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"alice","password":"secret"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.Header.Set("Content-Type", "application/json")
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site login to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLogoutWithoutSessionClearsCookies(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/auth/logout", "", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "已退出登录") {
		t.Fatalf("expected logout success, got status=%d body=%s", response.Code, response.Body.String())
	}
	if len(response.Result().Cookies()) < 3 {
		t.Fatalf("expected logout response to clear session cookies, got %d cookies", len(response.Result().Cookies()))
	}
}

func TestLogoutRejectsCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site logout to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}
