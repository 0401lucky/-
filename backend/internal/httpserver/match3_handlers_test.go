package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestMatch3RoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/match3/start", `{}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestMatch3RoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/match3/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "消消乐数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/match3/start", `{}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "消消乐数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}
}

func TestMatch3SubmitValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/match3/submit", `{"sessionId":"","moves":[]}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的会话ID") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}
