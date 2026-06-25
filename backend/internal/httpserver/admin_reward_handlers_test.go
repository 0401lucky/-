package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminRewardsRequiresAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/rewards", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin rewards response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/rewards", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin rewards response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminRewardsRejectCrossSiteCreate(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodPost, "/api/admin/rewards", strings.NewReader(`{"type":"points","amount":1,"targetMode":"all","title":"t","message":"m"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site admin rewards response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRewardsReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	list := httptest.NewRequest(http.MethodGet, "/api/admin/rewards", nil)
	list.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	listResponse := performRequest(handler, list)
	if listResponse.Code != http.StatusServiceUnavailable || !strings.Contains(listResponse.Body.String(), "奖励数据库未配置") {
		t.Fatalf("expected unavailable list response, got status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	detail := httptest.NewRequest(http.MethodGet, "/api/admin/rewards/missing-batch", nil)
	detail.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := performRequest(handler, detail)
	if detailResponse.Code != http.StatusServiceUnavailable || !strings.Contains(detailResponse.Body.String(), "奖励数据库未配置") {
		t.Fatalf("expected unavailable detail response, got status=%d body=%s", detailResponse.Code, detailResponse.Body.String())
	}

	create := httptest.NewRequest(http.MethodPost, "/api/admin/rewards", strings.NewReader(`{"type":"points","amount":1,"targetMode":"all","title":"t","message":"m"}`))
	create.Host = "example.com"
	create.Header.Set("Origin", "http://example.com")
	create.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	createResponse := performRequest(handler, create)
	if createResponse.Code != http.StatusServiceUnavailable || !strings.Contains(createResponse.Body.String(), "奖励数据库未配置") {
		t.Fatalf("expected unavailable create response, got status=%d body=%s", createResponse.Code, createResponse.Body.String())
	}
}
