package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEcoCollectRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/collect", `{"drags":1}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestEcoCollectRejectsCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/collect", strings.NewReader(`{"drags":1}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookie())

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site request to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoCollectValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/collect", `{"drags":0}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的回收次数") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}

	fraction := performJSONRequest(handler, http.MethodPost, "/api/games/eco/collect", `{"drags":0.5}`, true)
	if fraction.Code != http.StatusBadRequest || !strings.Contains(fraction.Body.String(), "无效的回收次数") {
		t.Fatalf("unexpected fractional response: status=%d body=%s", fraction.Code, fraction.Body.String())
	}

	malformed := performJSONRequest(handler, http.MethodPost, "/api/games/eco/collect", `{`, true)
	if malformed.Code != http.StatusBadRequest || !strings.Contains(malformed.Body.String(), "请求体格式无效") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", malformed.Code, malformed.Body.String())
	}
}

func TestEcoCollectReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/collect", `{"drags":1}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoStatusRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/games/eco/status", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoStatusReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/games/eco/status", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoRankingRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/rankings/eco?period=daily&limit=10", "", false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoRankingReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/rankings/eco?period=daily&limit=10", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保排行榜服务暂时不可用") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestAdminEcoRequiresAdmin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/eco", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated admin eco response, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/eco", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(1001, "tester", "Tester"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected forbidden admin eco response, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}
}

func TestAdminEcoReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	getRequest := httptest.NewRequest(http.MethodGet, "/api/admin/eco", nil)
	getRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	getResponse := performRequest(handler, getRequest)
	if getResponse.Code != http.StatusServiceUnavailable || !strings.Contains(getResponse.Body.String(), "环保管理数据库未配置") {
		t.Fatalf("expected unavailable admin eco get response, got status=%d body=%s", getResponse.Code, getResponse.Body.String())
	}

	patchRequest := httptest.NewRequest(http.MethodPatch, "/api/admin/eco", strings.NewReader(`{"prizeRates":{"coin":0.01}}`))
	patchRequest.Host = "example.com"
	patchRequest.Header.Set("Content-Type", "application/json")
	patchRequest.Header.Set("Origin", "http://example.com")
	patchRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	patchResponse := performRequest(handler, patchRequest)
	if patchResponse.Code != http.StatusServiceUnavailable || !strings.Contains(patchResponse.Body.String(), "环保管理数据库未配置") {
		t.Fatalf("expected unavailable admin eco patch response, got status=%d body=%s", patchResponse.Code, patchResponse.Body.String())
	}
}

func TestAdminEcoPatchValidatesTrustedOrigin(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	request := httptest.NewRequest(http.MethodPatch, "/api/admin/eco", strings.NewReader(`{"prizeRates":{"coin":0.01}}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "https://evil.example")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))

	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site admin eco patch to be rejected, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoBuyRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/buy", `{"type":"upgrade","key":"spawn"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoBuyValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/buy", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingKey := performJSONRequest(handler, http.MethodPost, "/api/games/eco/buy", `{"type":"upgrade"}`, true)
	if missingKey.Code != http.StatusBadRequest || !strings.Contains(missingKey.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing key response: status=%d body=%s", missingKey.Code, missingKey.Body.String())
	}
}

func TestEcoBuyItemReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/buy", `{"type":"item","key":"clear_truck"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoBuyReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/buy", `{"type":"upgrade","key":"spawn"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoClaimPrizeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/claim-prize", `{"prizeId":"p1"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoClaimPrizeValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/claim-prize", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingPrize := performJSONRequest(handler, http.MethodPost, "/api/games/eco/claim-prize", `{"makePublic":true}`, true)
	if missingPrize.Code != http.StatusBadRequest || !strings.Contains(missingPrize.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing prize response: status=%d body=%s", missingPrize.Code, missingPrize.Body.String())
	}
}

func TestEcoClaimPrizeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/claim-prize", `{"prizeId":"p1"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoStealPrizeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/steal", `{"entryId":"pub1","message":"test"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoStealPrizeValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/steal", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingMessage := performJSONRequest(handler, http.MethodPost, "/api/games/eco/steal", `{"entryId":"pub1"}`, true)
	if missingMessage.Code != http.StatusBadRequest || !strings.Contains(missingMessage.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing message response: status=%d body=%s", missingMessage.Code, missingMessage.Body.String())
	}
}

func TestEcoStealPrizeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/steal", `{"entryId":"pub1","message":"test"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoSellPrizeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/sell", `{"key":"diamond","quantity":1}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoSellPrizeValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/sell", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingKey := performJSONRequest(handler, http.MethodPost, "/api/games/eco/sell", `{"quantity":1}`, true)
	if missingKey.Code != http.StatusBadRequest || !strings.Contains(missingKey.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing key response: status=%d body=%s", missingKey.Code, missingKey.Body.String())
	}

	invalidQuantity := performJSONRequest(handler, http.MethodPost, "/api/games/eco/sell", `{"key":"diamond","quantity":0.5}`, true)
	if invalidQuantity.Code != http.StatusBadRequest || !strings.Contains(invalidQuantity.Body.String(), "出售数量无效") {
		t.Fatalf("unexpected invalid quantity response: status=%d body=%s", invalidQuantity.Code, invalidQuantity.Body.String())
	}
}

func TestEcoSellPrizeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/sell", `{"key":"diamond","quantity":1}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoMerchantSellPrizeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/merchant-sell", `{"key":"diamond"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoMerchantSellPrizeValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/merchant-sell", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingKey := performJSONRequest(handler, http.MethodPost, "/api/games/eco/merchant-sell", `{}`, true)
	if missingKey.Code != http.StatusBadRequest || !strings.Contains(missingKey.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing key response: status=%d body=%s", missingKey.Code, missingKey.Body.String())
	}
}

func TestEcoMerchantSellPrizeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/merchant-sell", `{"key":"diamond"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoBlackMarketSellPrizeRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/black-market-sell", `{"key":"diamond"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestEcoBlackMarketSellPrizeValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/black-market-sell", `{`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected malformed response: status=%d body=%s", response.Code, response.Body.String())
	}

	missingKey := performJSONRequest(handler, http.MethodPost, "/api/games/eco/black-market-sell", `{}`, true)
	if missingKey.Code != http.StatusBadRequest || !strings.Contains(missingKey.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing key response: status=%d body=%s", missingKey.Code, missingKey.Body.String())
	}
}

func TestEcoBlackMarketSellPrizeReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/eco/black-market-sell", `{"key":"diamond"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "环保行动数据库未配置") {
		t.Fatalf("expected unavailable response, got status=%d body=%s", response.Code, response.Body.String())
	}
}
