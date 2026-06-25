package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRankingRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())
	paths := []string{
		"/api/rankings/points",
		"/api/rankings/games",
		"/api/rankings/checkin-streak",
		"/api/rankings/history",
	}
	for _, path := range paths {
		response := performJSONRequest(handler, http.MethodGet, path, "", false)
		if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
			t.Fatalf("expected %s to require login, got status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
}

func TestRankingRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())
	cases := map[string]string{
		"/api/rankings/points":         "积分排行榜服务暂时不可用",
		"/api/rankings/games":          "游戏排行榜服务暂时不可用",
		"/api/rankings/checkin-streak": "签到排行榜服务暂时不可用",
		"/api/rankings/history":        "排行榜历史服务暂时不可用",
	}
	for path, message := range cases {
		response := performJSONRequest(handler, http.MethodGet, path, "", true)
		if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), message) {
			t.Fatalf("expected %s unavailable response, got status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
}

func TestAdminRankingSettleRequiresAdminAndTrustedOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodPost, "/api/admin/rankings/settle", `{}`, false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated settle to require login, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdmin := performJSONRequest(handler, http.MethodPost, "/api/admin/rankings/settle", `{}`, true)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected non-admin settle to be forbidden, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}

	request := httptest.NewRequest(http.MethodPost, "/api/admin/rankings/settle", strings.NewReader(`{}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site settle to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminRankingSettleReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())
	request := httptest.NewRequest(http.MethodPost, "/api/admin/rankings/settle", strings.NewReader(`{"period":"weekly"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))

	response := performRequest(handler, request)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "排行榜结算服务暂时不可用") {
		t.Fatalf("expected unavailable settle response, got status=%d body=%s", response.Code, response.Body.String())
	}
}
