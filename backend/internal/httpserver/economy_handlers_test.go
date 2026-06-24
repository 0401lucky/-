package httpserver

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/config"
)

const testSessionSecret = "0123456789abcdef0123456789abcdef"

func TestWalletRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/store/withdraw", `{"points":100}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestWalletRoutesValidatePayload(t *testing.T) {
	handler := New(testDependencies())

	withdraw := performJSONRequest(handler, http.MethodPost, "/api/store/withdraw", `{"points":1.5}`, true)
	if withdraw.Code != http.StatusBadRequest || !strings.Contains(withdraw.Body.String(), "积分数量必须为正整数") {
		t.Fatalf("unexpected withdraw validation response: status=%d body=%s", withdraw.Code, withdraw.Body.String())
	}

	topup := performJSONRequest(handler, http.MethodPost, "/api/store/topup", `{"dollars":0}`, true)
	if topup.Code != http.StatusBadRequest || !strings.Contains(topup.Body.String(), "充值金额必须为正数") {
		t.Fatalf("unexpected topup validation response: status=%d body=%s", topup.Code, topup.Body.String())
	}
}

func TestWalletRoutesReturnUnavailableWhenNewAPIIsNotConfigured(t *testing.T) {
	handler := New(testDependencies())

	topup := performJSONRequest(handler, http.MethodPost, "/api/store/topup", `{"dollars":1}`, true)
	if topup.Code != http.StatusServiceUnavailable || !strings.Contains(topup.Body.String(), "NEW_API_NOT_CONFIGURED") {
		t.Fatalf("unexpected topup unavailable response: status=%d body=%s", topup.Code, topup.Body.String())
	}

	balance := performJSONRequest(handler, http.MethodGet, "/api/store/topup", "", true)
	if balance.Code != http.StatusServiceUnavailable || !strings.Contains(balance.Body.String(), "NEW_API_NOT_CONFIGURED") {
		t.Fatalf("unexpected balance unavailable response: status=%d body=%s", balance.Code, balance.Body.String())
	}
}

func TestStoreUnsafeRoutesRejectCrossSiteOrigin(t *testing.T) {
	handler := New(testDependencies())
	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{name: "exchange", method: http.MethodPost, path: "/api/store/exchange", body: `{"itemId":"card-draw-1"}`},
		{name: "topup", method: http.MethodPost, path: "/api/store/topup", body: `{"dollars":1}`},
		{name: "withdraw", method: http.MethodPost, path: "/api/store/withdraw", body: `{"points":100}`},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			request := httptest.NewRequest(testCase.method, testCase.path, strings.NewReader(testCase.body))
			request.Host = "example.com"
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("Origin", "https://evil.example")
			request.AddCookie(testSessionCookie())

			response := performRequest(handler, request)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
				t.Fatalf("expected cross-site request to be rejected, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestStoreExchangeRateLimit(t *testing.T) {
	handler := New(testDependencies())

	for index := 0; index < 20; index++ {
		response := performJSONRequest(handler, http.MethodPost, "/api/store/topup", `{"dollars":0}`, true)
		if response.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d should not be rate limited: body=%s", index+1, response.Body.String())
		}
	}

	response := performJSONRequest(handler, http.MethodPost, "/api/store/topup", `{"dollars":0}`, true)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), "请求过于频繁") {
		t.Fatalf("expected 429 after rate limit, got status=%d body=%s", response.Code, response.Body.String())
	}
	if response.Header().Get("Retry-After") == "" {
		t.Fatalf("rate limited response should include Retry-After header")
	}
}

func testDependencies() Dependencies {
	resetInMemoryRateLimitsForTest()
	return Dependencies{
		Config: config.Config{
			SessionSecret: testSessionSecret,
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func performJSONRequest(handler http.Handler, method string, path string, body string, withSession bool) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Host = "example.com"
		request.Header.Set("Origin", "http://example.com")
	}
	if withSession {
		request.AddCookie(testSessionCookie())
	}

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func performRequest(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func testSessionCookie() *http.Cookie {
	return testSessionCookieFor(1001, "tester", "Tester")
}

func testSessionCookieFor(userID int64, username string, displayName string) *http.Cookie {
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(auth.SessionData{
		ID:          userID,
		Username:    username,
		DisplayName: displayName,
		Iat:         now,
		Exp:         now + int64(time.Hour/time.Millisecond),
		JTI:         "test-session",
	})
	payload := base64.StdEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, []byte(testSessionSecret))
	_, _ = mac.Write([]byte(payload))
	signature := hex.EncodeToString(mac.Sum(nil))
	return &http.Cookie{Name: "app_session", Value: payload + "." + signature}
}
