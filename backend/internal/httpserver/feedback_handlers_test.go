package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFeedbackListRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/feedback?scope=wall", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFeedbackListReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/feedback?scope=wall&page=1&limit=5", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "反馈数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFeedbackListValidatesStatus(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/feedback?scope=wall&status=unknown", "", true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的反馈状态") {
		t.Fatalf("expected invalid status response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFeedbackDetailReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/feedback/fb-1", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "反馈数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminFeedbackRequiresAdmin(t *testing.T) {
	deps := testDependencies()
	deps.Config.AdminUsernames = map[string]struct{}{"admin": {}}
	handler := New(deps)

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/feedback", "", false)
	if unauthenticated.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated 401, got %d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdmin := performJSONRequest(handler, http.MethodGet, "/api/admin/feedback", "", true)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected non-admin 403, got %d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminFeedbackReturnsUnavailableWithoutDatabase(t *testing.T) {
	deps := testDependencies()
	deps.Config.AdminUsernames = map[string]struct{}{"admin": {}}
	handler := New(deps)

	request := httptest.NewRequest(http.MethodGet, "/api/admin/feedback?page=1&limit=5", nil)
	request.AddCookie(testSessionCookieFor(1002, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "反馈数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminFeedbackValidatesStatus(t *testing.T) {
	deps := testDependencies()
	deps.Config.AdminUsernames = map[string]struct{}{"admin": {}}
	handler := New(deps)

	request := httptest.NewRequest(http.MethodGet, "/api/admin/feedback?status=bad", nil)
	request.AddCookie(testSessionCookieFor(1002, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的反馈状态") {
		t.Fatalf("expected invalid status response, got status=%d body=%s", response.Code, response.Body.String())
	}
}
