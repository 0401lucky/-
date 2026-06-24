package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestLinkgameRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/linkgame/start", `{"difficulty":"easy"}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLinkgameStartValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/linkgame/start", `{"difficulty":"bad"}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "无效的难度选择") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLinkgameRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/linkgame/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "连连看数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/linkgame/start", `{"difficulty":"easy"}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "连连看数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}
}
