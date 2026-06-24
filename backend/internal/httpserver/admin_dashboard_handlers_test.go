package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminDashboardRequiresAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/dashboard", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin dashboard response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/dashboard", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin dashboard response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminDashboardReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodGet, "/api/admin/dashboard", nil)
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "仪表盘数据库未配置") {
		t.Fatalf("expected unavailable dashboard response, got status=%d body=%s", response.Code, response.Body.String())
	}
}
