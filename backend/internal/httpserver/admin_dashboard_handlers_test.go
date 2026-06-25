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

func TestAdminAlertsRoutesRequireAdminAndDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticatedList := performJSONRequest(handler, http.MethodGet, "/api/admin/alerts", "", false)
	if unauthenticatedList.Code != http.StatusUnauthorized || !strings.Contains(unauthenticatedList.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated alerts list response, got status=%d body=%s", unauthenticatedList.Code, unauthenticatedList.Body.String())
	}

	nonAdminResolve := httptest.NewRequest(http.MethodPost, "/api/admin/alerts/alert-1/resolve", nil)
	nonAdminResolve.Header.Set("Origin", "http://example.com")
	nonAdminResolve.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdminResponse := performRequest(handler, nonAdminResolve)
	if nonAdminResponse.Code != http.StatusForbidden || !strings.Contains(nonAdminResponse.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden resolve response, got status=%d body=%s", nonAdminResponse.Code, nonAdminResponse.Body.String())
	}

	adminList := httptest.NewRequest(http.MethodGet, "/api/admin/alerts", nil)
	adminList.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	adminListResponse := performRequest(handler, adminList)
	if adminListResponse.Code != http.StatusServiceUnavailable || !strings.Contains(adminListResponse.Body.String(), "告警数据库未配置") {
		t.Fatalf("expected unavailable alerts list response, got status=%d body=%s", adminListResponse.Code, adminListResponse.Body.String())
	}
}

func TestAdminAlertResolveRejectsCrossSiteOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodPost, "/api/admin/alerts/alert-1/resolve", nil)
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site resolve rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}
