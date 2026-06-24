package httpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestAdminCardReadHandlersRequireAdmin(t *testing.T) {
	handlers := newAdminCardHandlers(testDependenciesWithAdmin())

	unauthenticated := httptest.NewRecorder()
	handlers.users(unauthenticated, httptest.NewRequest(http.MethodGet, "/api/admin/cards/users", nil))
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin card users response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/cards/users", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := httptest.NewRecorder()
	handlers.users(nonAdmin, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin card users response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminCardReadHandlersReturnUnavailableWithoutDatabase(t *testing.T) {
	handlers := newAdminCardHandlers(testDependenciesWithAdmin())

	cases := []struct {
		name   string
		method string
		path   string
		body   string
		invoke func(http.ResponseWriter, *http.Request)
	}{
		{name: "users", method: http.MethodGet, path: "/api/admin/cards/users", invoke: handlers.users},
		{name: "albums", method: http.MethodGet, path: "/api/admin/cards/albums", invoke: handlers.albums},
		{name: "rules", method: http.MethodGet, path: "/api/admin/cards/rules", invoke: handlers.rules},
		{name: "update reward", method: http.MethodPost, path: "/api/admin/cards/albums", body: `{"albumId":"animal-s1","reward":123}`, invoke: handlers.updateReward},
		{name: "update rules", method: http.MethodPatch, path: "/api/admin/cards/rules", body: `{"cardDrawPrice":800}`, invoke: handlers.updateRules},
		{name: "reset", method: http.MethodPost, path: "/api/admin/cards/reset", body: `{"userId":1001}`, invoke: handlers.reset},
		{name: "user detail", method: http.MethodGet, path: "/api/admin/cards/user/1001", invoke: func(writer http.ResponseWriter, request *http.Request) {
			handlers.userDetail(writer, adminCardRequestWithUserID(request, "1001"))
		}},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(testCase.body))
			if testCase.body != "" {
				request.Header.Set("Content-Type", "application/json")
			}
			if testCase.method == http.MethodPost || testCase.method == http.MethodPatch {
				request.Host = "example.com"
				request.Header.Set("Origin", "http://example.com")
			}
			request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
			response := httptest.NewRecorder()
			testCase.invoke(response, request)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
				t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminCardUserDetailValidatesUserID(t *testing.T) {
	handlers := newAdminCardHandlers(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodGet, "/api/admin/cards/user/bad", nil)
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handlers.userDetail(response, adminCardRequestWithUserID(request, "bad"))
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "User ID invalid") {
		t.Fatalf("expected invalid user id response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminCardWriteHandlersValidatePayloadAndOrigin(t *testing.T) {
	handlers := newAdminCardHandlers(testDependenciesWithAdmin())

	crossSite := httptest.NewRequest(http.MethodPost, "/api/admin/cards/reset", strings.NewReader(`{"userId":1001}`))
	crossSite.Host = "example.com"
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	crossSiteResponse := httptest.NewRecorder()
	handlers.reset(crossSiteResponse, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden || !strings.Contains(crossSiteResponse.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site reset to be rejected, got status=%d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	badReset := httptest.NewRequest(http.MethodPost, "/api/admin/cards/reset", strings.NewReader(`{"userId":0}`))
	badReset.Host = "example.com"
	badReset.Header.Set("Origin", "http://example.com")
	badReset.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	badResetResponse := httptest.NewRecorder()
	handlers.reset(badResetResponse, badReset)
	if badResetResponse.Code != http.StatusBadRequest || !strings.Contains(badResetResponse.Body.String(), "用户ID无效") {
		t.Fatalf("expected invalid reset payload, got status=%d body=%s", badResetResponse.Code, badResetResponse.Body.String())
	}

	badReward := httptest.NewRequest(http.MethodPost, "/api/admin/cards/albums", strings.NewReader(`{"albumId":"animal-s1","reward":1.5}`))
	badReward.Host = "example.com"
	badReward.Header.Set("Origin", "http://example.com")
	badReward.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	badRewardResponse := httptest.NewRecorder()
	handlers.updateReward(badRewardResponse, badReward)
	if badRewardResponse.Code != http.StatusBadRequest || !strings.Contains(badRewardResponse.Body.String(), "奖励值无效") {
		t.Fatalf("expected invalid reward payload, got status=%d body=%s", badRewardResponse.Code, badRewardResponse.Body.String())
	}
}

func testDependenciesWithAdmin() Dependencies {
	deps := testDependencies()
	deps.Config.AdminUsernames = map[string]struct{}{"admin": {}}
	return deps
}

func adminCardRequestWithUserID(request *http.Request, userID string) *http.Request {
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("userId", userID)
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}
