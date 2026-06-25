package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminUsersRequiresAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/users", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin users response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin users response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminUsersValidatePath(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	invalidDetail := httptest.NewRequest(http.MethodGet, "/api/admin/users/bad", nil)
	invalidDetail.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	invalidDetailResponse := performRequest(handler, invalidDetail)
	if invalidDetailResponse.Code != http.StatusBadRequest || !strings.Contains(invalidDetailResponse.Body.String(), "无效的用户ID") {
		t.Fatalf("expected invalid admin user detail response, got status=%d body=%s", invalidDetailResponse.Code, invalidDetailResponse.Body.String())
	}
}

func TestAdminUsersRejectCrossSiteAchievementUpdate(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodPost, "/api/admin/users/1001/achievements", strings.NewReader(`{"achievementId":"contributor","action":"grant"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site admin user achievement response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminUsersReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	list := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	list.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	listResponse := performRequest(handler, list)
	if listResponse.Code != http.StatusServiceUnavailable || !strings.Contains(listResponse.Body.String(), "用户管理数据库未配置") {
		t.Fatalf("expected unavailable list response, got status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}

	detail := httptest.NewRequest(http.MethodGet, "/api/admin/users/1001", nil)
	detail.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := performRequest(handler, detail)
	if detailResponse.Code != http.StatusServiceUnavailable || !strings.Contains(detailResponse.Body.String(), "用户管理数据库未配置") {
		t.Fatalf("expected unavailable detail response, got status=%d body=%s", detailResponse.Code, detailResponse.Body.String())
	}

	achievement := httptest.NewRequest(http.MethodPost, "/api/admin/users/1001/achievements", strings.NewReader(`{"achievementId":"contributor","action":"grant"}`))
	achievement.Host = "example.com"
	achievement.Header.Set("Origin", "http://example.com")
	achievement.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	achievementResponse := performRequest(handler, achievement)
	if achievementResponse.Code != http.StatusServiceUnavailable || !strings.Contains(achievementResponse.Body.String(), "用户管理数据库未配置") {
		t.Fatalf("expected unavailable achievement response, got status=%d body=%s", achievementResponse.Code, achievementResponse.Body.String())
	}
}

func TestAdminLegacyToolsAreDisabled(t *testing.T) {
	handler := New(testDependenciesWithAdmin())
	paths := []string{
		"/api/admin/sync-users",
		"/api/admin/fix-codes-count",
		"/api/admin/migrate-native-hot-data",
		"/api/admin/migrate-new-user-eligibility",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			unauthenticated := httptest.NewRequest(http.MethodPost, path, nil)
			unauthenticated.Header.Set("Origin", "http://example.com")
			unauthenticatedResponse := performRequest(handler, unauthenticated)
			if unauthenticatedResponse.Code != http.StatusUnauthorized || !strings.Contains(unauthenticatedResponse.Body.String(), "未登录") {
				t.Fatalf("expected unauthenticated legacy tool response, got status=%d body=%s", unauthenticatedResponse.Code, unauthenticatedResponse.Body.String())
			}

			crossSite := httptest.NewRequest(http.MethodPost, path, nil)
			crossSite.Header.Set("Origin", "https://evil.example")
			crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
			crossSiteResponse := performRequest(handler, crossSite)
			if crossSiteResponse.Code != http.StatusForbidden || !strings.Contains(crossSiteResponse.Body.String(), "请求来源不合法") {
				t.Fatalf("expected cross-site legacy tool response, got status=%d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
			}

			request := httptest.NewRequest(http.MethodPost, path, nil)
			request.Host = "example.com"
			request.Header.Set("Origin", "http://example.com")
			request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
			response := performRequest(handler, request)
			if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), "ADMIN_LEGACY_TOOL_DISABLED") {
				t.Fatalf("expected disabled legacy tool response, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminStoreResetIsDisabled(t *testing.T) {
	handler := New(testDependenciesWithAdmin())
	path := "/api/admin/store/reset"

	unauthenticated := httptest.NewRequest(http.MethodPost, path, nil)
	unauthenticated.Header.Set("Origin", "http://example.com")
	unauthenticatedResponse := performRequest(handler, unauthenticated)
	if unauthenticatedResponse.Code != http.StatusUnauthorized || !strings.Contains(unauthenticatedResponse.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated store reset response, got status=%d body=%s", unauthenticatedResponse.Code, unauthenticatedResponse.Body.String())
	}

	crossSite := httptest.NewRequest(http.MethodPost, path, nil)
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	crossSiteResponse := performRequest(handler, crossSite)
	if crossSiteResponse.Code != http.StatusForbidden || !strings.Contains(crossSiteResponse.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site store reset response, got status=%d body=%s", crossSiteResponse.Code, crossSiteResponse.Body.String())
	}

	request := httptest.NewRequest(http.MethodPost, path, nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), "ADMIN_STORE_RESET_DISABLED") {
		t.Fatalf("expected disabled store reset response, got status=%d body=%s", response.Code, response.Body.String())
	}
}
