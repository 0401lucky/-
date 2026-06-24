package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProfileSettingsRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/profile/settings", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileSettingsReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/profile/settings", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "个人资料数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileOverviewRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/profile/overview", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileOverviewReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/profile/overview", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "个人资料数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileSettingsRateLimit(t *testing.T) {
	handler := New(testDependencies())

	for index := 0; index < 30; index++ {
		response := performJSONRequest(handler, http.MethodGet, "/api/profile/settings", "", true)
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d should not be rate limited: body=%s", index+1, response.Body.String())
		}
	}
	response := performJSONRequest(handler, http.MethodGet, "/api/profile/settings", "", true)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "请求过于频繁") {
		t.Fatalf("expected 429 after rate limit, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileSettingsPutRequiresTrustedOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPut, "/api/profile/settings", strings.NewReader(`{"displayName":"Alice"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileSettingsPutValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	malformed := performJSONRequest(handler, http.MethodPut, "/api/profile/settings", `{`, true)
	if malformed.Code != http.StatusBadRequest || !strings.Contains(malformed.Body.String(), "请求体格式无效") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", malformed.Code, malformed.Body.String())
	}

	empty := performJSONRequest(handler, http.MethodPut, "/api/profile/settings", `{"unknown":"x"}`, true)
	if empty.Code != http.StatusBadRequest || !strings.Contains(empty.Body.String(), "未提供任何可更新字段") {
		t.Fatalf("unexpected empty patch response: status=%d body=%s", empty.Code, empty.Body.String())
	}

	invalidAvatar := performJSONRequest(handler, http.MethodPut, "/api/profile/settings", `{"avatarUrl":"ftp://example.com/a.png"}`, true)
	if invalidAvatar.Code != http.StatusBadRequest || !strings.Contains(invalidAvatar.Body.String(), "图床链接必须是 http 或 https") {
		t.Fatalf("unexpected invalid avatar response: status=%d body=%s", invalidAvatar.Code, invalidAvatar.Body.String())
	}
}

func TestProfileSettingsPutReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPut, "/api/profile/settings", `{"displayName":"Alice"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "个人资料数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileAchievementEquipRequiresTrustedOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPut, "/api/profile/achievements/equip", strings.NewReader(`{"achievementId":"beginner"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestProfileAchievementEquipValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	malformed := performJSONRequest(handler, http.MethodPut, "/api/profile/achievements/equip", `{`, true)
	if malformed.Code != http.StatusBadRequest || !strings.Contains(malformed.Body.String(), "请求体格式无效") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", malformed.Code, malformed.Body.String())
	}

	unknown := performJSONRequest(handler, http.MethodPut, "/api/profile/achievements/equip", `{"achievementId":"unknown"}`, true)
	if unknown.Code != http.StatusBadRequest || !strings.Contains(unknown.Body.String(), "未知成就") {
		t.Fatalf("unexpected unknown achievement response: status=%d body=%s", unknown.Code, unknown.Body.String())
	}

	nonString := performJSONRequest(handler, http.MethodPut, "/api/profile/achievements/equip", `{"achievementId":123}`, true)
	if nonString.Code != http.StatusBadRequest || !strings.Contains(nonString.Body.String(), "未知成就") {
		t.Fatalf("unexpected non-string achievement response: status=%d body=%s", nonString.Code, nonString.Body.String())
	}
}

func TestProfileAchievementEquipReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPut, "/api/profile/achievements/equip", `{"achievementId":"beginner"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "个人资料数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}
