package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminPointsRequiresAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/points?userId=1001", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin points response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/points?userId=1001", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin points response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminPointsGetValidatesUserID(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	missing := httptest.NewRequest(http.MethodGet, "/api/admin/points", nil)
	missing.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	missingResponse := performRequest(handler, missing)
	if missingResponse.Code != http.StatusBadRequest || !strings.Contains(missingResponse.Body.String(), "缺少 userId 参数") {
		t.Fatalf("expected missing userId response, got status=%d body=%s", missingResponse.Code, missingResponse.Body.String())
	}

	invalid := httptest.NewRequest(http.MethodGet, "/api/admin/points?userId=0", nil)
	invalid.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	invalidResponse := performRequest(handler, invalid)
	if invalidResponse.Code != http.StatusBadRequest || !strings.Contains(invalidResponse.Body.String(), "userId 必须是正整数") {
		t.Fatalf("expected invalid userId response, got status=%d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}
}

func TestAdminPointsPostValidatesPayloadAndOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	crossSite := httptest.NewRequest(http.MethodPost, "/api/admin/points", strings.NewReader(`{"userId":1001,"amount":1,"description":"test"}`))
	crossSite.Host = "example.com"
	crossSite.Header.Set("Content-Type", "application/json")
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden || !strings.Contains(crossSiteResponse.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site admin points response, got status=%d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	cases := []struct {
		name    string
		body    string
		message string
	}{
		{name: "bad user", body: `{"userId":"bad","amount":1,"description":"test"}`, message: "userId 必须是正整数"},
		{name: "zero amount", body: `{"userId":1001,"amount":0,"description":"test"}`, message: "amount 必须是非零整数"},
		{name: "fraction amount", body: `{"userId":1001,"amount":1.5,"description":"test"}`, message: "amount 必须是非零整数"},
		{name: "too large", body: `{"userId":1001,"amount":1000001,"description":"test"}`, message: "单次调整不能超过 1,000,000 积分"},
		{name: "missing desc", body: `{"userId":1001,"amount":1,"description":" "}`, message: "请提供调整原因"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/api/admin/points", strings.NewReader(testCase.body))
			request.Host = "example.com"
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "http://example.com")
			request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
			response := performRequest(handler, request)
			if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), testCase.message) {
				t.Fatalf("expected validation %q, got status=%d body=%s", testCase.message, response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminPointsReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	getRequest := httptest.NewRequest(http.MethodGet, "/api/admin/points?userId=1001", nil)
	getRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	getResponse := performRequest(handler, getRequest)
	if getResponse.Code != http.StatusServiceUnavailable || !strings.Contains(getResponse.Body.String(), "积分管理数据库未配置") {
		t.Fatalf("expected unavailable admin points get response, got status=%d body=%s", getResponse.Code, getResponse.Body.String())
	}

	postRequest := httptest.NewRequest(http.MethodPost, "/api/admin/points", strings.NewReader(`{"userId":1001,"amount":1,"description":"test"}`))
	postRequest.Host = "example.com"
	postRequest.Header.Set("Content-Type", "application/json")
	postRequest.Header.Set("Origin", "http://example.com")
	postRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	postResponse := performRequest(handler, postRequest)
	if postResponse.Code != http.StatusServiceUnavailable || !strings.Contains(postResponse.Body.String(), "积分管理数据库未配置") {
		t.Fatalf("expected unavailable admin points post response, got status=%d body=%s", postResponse.Code, postResponse.Body.String())
	}
}
