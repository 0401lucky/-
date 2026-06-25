package httpserver

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminConfigRoutesRequireAdminAndValidatePayload(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/config", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected admin config get to require login, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdmin := performJSONRequest(handler, http.MethodPut, "/api/admin/config", `{"dailyPointsLimit":5000}`, true)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin config put to require admin, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}

	invalid := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", `{"dailyPointsLimit":99}`, testSessionCookieFor(1, "admin", "Admin"))
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "每日积分上限必须在 100 - 100000 之间") {
		t.Fatalf("expected invalid limit response, got status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestAdminConfigRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())
	get := performJSONRequestWithCookie(handler, http.MethodGet, "/api/admin/config", "", testSessionCookieFor(1, "admin", "Admin"))
	if get.Code != http.StatusServiceUnavailable || !strings.Contains(get.Body.String(), "系统配置数据库未配置") {
		t.Fatalf("expected no-db get response, got status=%d body=%s", get.Code, get.Body.String())
	}

	put := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", `{"dailyPointsLimit":6000}`, testSessionCookieFor(1, "admin", "Admin"))
	if put.Code != http.StatusServiceUnavailable || !strings.Contains(put.Body.String(), "系统配置数据库未配置") {
		t.Fatalf("expected no-db put response, got status=%d body=%s", put.Code, put.Body.String())
	}
}

func performJSONRequestWithCookie(handler http.Handler, method string, path string, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Host = "example.com"
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(cookie)
	return performRequest(handler, request)
}
