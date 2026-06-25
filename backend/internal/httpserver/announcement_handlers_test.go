package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAnnouncementListRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/announcements?page=1&limit=5", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated announcement list response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAnnouncementListReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/announcements?page=1&limit=5", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "公告数据库未配置") {
		t.Fatalf("expected unavailable announcement list response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminAnnouncementRoutesRequireAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/announcements", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin announcements response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/announcements", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin announcements response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminAnnouncementRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "list", method: http.MethodGet, path: "/api/admin/announcements?status=published&limit=10"},
		{name: "create", method: http.MethodPost, path: "/api/admin/announcements", body: `{"title":"公告","content":"内容","status":"draft"}`},
		{name: "update", method: http.MethodPatch, path: "/api/admin/announcements/ann_test", body: `{"title":"公告更新"}`},
		{name: "archive", method: http.MethodDelete, path: "/api/admin/announcements/ann_test"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(testCase.body))
			if testCase.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			request.Host = "example.com"
			request.Header.Set("Origin", "http://example.com")
			request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))

			response := performRequest(handler, request)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "公告数据库未配置") {
				t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminAnnouncementWriteRoutesRejectCrossSiteOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodPost, "/api/admin/announcements", strings.NewReader(`{"title":"公告","content":"内容"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site announcement create to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}
