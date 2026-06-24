package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestWhackMoleRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/whack-mole/start", `{"difficulty":"normal"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestWhackMoleRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/whack-mole/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "打地鼠数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/whack-mole/start", `{"difficulty":"normal"}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "打地鼠数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}
}

func TestWhackMoleSubmitValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/whack-mole/submit", `{"sessionId":""}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数错误") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}
