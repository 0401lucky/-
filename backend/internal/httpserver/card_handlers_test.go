package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCardInventoryRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/cards/inventory", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardInventoryReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/cards/inventory", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardRulesReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/cards/rules", "", false)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardDrawRequiresTrustedOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPost, "/api/cards/draw", strings.NewReader(`{"count":1}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardDrawReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/draw", `{"count":1}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardExchangeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/exchange", `{"cardId":"animal-s1-common-仓鼠"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardExchangeRequiresTrustedOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPost, "/api/cards/exchange", strings.NewReader(`{"cardId":"animal-s1-common-仓鼠"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardExchangeRejectsMissingCardID(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/exchange", `{"cardId":" "}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的卡片 ID") {
		t.Fatalf("expected missing card id response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardExchangeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/exchange", `{"cardId":"animal-s1-common-仓鼠"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardClaimRewardRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/claim-reward", `{"rewardType":"common","albumId":"animal-s1"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardClaimRewardRequiresTrustedOrigin(t *testing.T) {
	handler := New(testDependencies())

	request := httptest.NewRequest(http.MethodPost, "/api/cards/claim-reward", strings.NewReader(`{"rewardType":"common","albumId":"animal-s1"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request rejection, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCardClaimRewardRejectsInvalidPayload(t *testing.T) {
	handler := New(testDependencies())

	badType := performJSONRequest(handler, http.MethodPost, "/api/cards/claim-reward", `{"rewardType":"bad","albumId":"animal-s1"}`, true)
	if badType.Code != http.StatusBadRequest || !strings.Contains(badType.Body.String(), "无效的奖励类型") {
		t.Fatalf("expected invalid reward type response, got status=%d body=%s", badType.Code, badType.Body.String())
	}

	badAlbum := performJSONRequest(handler, http.MethodPost, "/api/cards/claim-reward", `{"rewardType":"common","albumId":"bad-album"}`, true)
	if badAlbum.Code != http.StatusBadRequest || !strings.Contains(badAlbum.Body.String(), "无效的卡册ID") {
		t.Fatalf("expected invalid album response, got status=%d body=%s", badAlbum.Code, badAlbum.Body.String())
	}
}

func TestCardClaimRewardReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/cards/claim-reward", `{"rewardType":"common","albumId":"animal-s1"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "卡牌数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}
