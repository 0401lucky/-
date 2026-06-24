package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestNotificationUnreadCountRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/notifications/unread-count", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationListRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/notifications?page=1&limit=5", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationUnreadCountReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/notifications/unread-count", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "通知数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationListReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/notifications?page=1&limit=5", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "通知数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationMarkReadValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/read", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "请提供需要标记的通知 ID") {
		t.Fatalf("expected validation response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationMarkReadReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/read", `{"ids":["n-1"]}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "通知数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationDeleteValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/delete", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "请提供需要删除的通知 ID") {
		t.Fatalf("expected validation response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationDeleteReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/delete", `{"ids":["n-1"]}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "通知数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationClaimValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/claim", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "缺少通知 ID") {
		t.Fatalf("expected validation response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationClaimReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/notifications/claim", `{"notificationId":"n-1"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "奖励数据库未配置") {
		t.Fatalf("expected database unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestNotificationUnreadCountRateLimit(t *testing.T) {
	handler := New(testDependencies())

	for index := 0; index < 60; index++ {
		response := performJSONRequest(handler, http.MethodGet, "/api/notifications/unread-count", "", true)
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d should not be rate limited: body=%s", index+1, response.Body.String())
		}
	}

	response := performJSONRequest(handler, http.MethodGet, "/api/notifications/unread-count", "", true)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "请求过于频繁") {
		t.Fatalf("expected 429 after rate limit, got status=%d body=%s", response.Code, response.Body.String())
	}
}
