package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestRogueliteRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/games/roguelite/start", `{}`, false)
	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestRogueliteStepValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	missingAction := performJSONRequest(handler, http.MethodPost, "/api/games/roguelite/step", `{"sessionId":"s1"}`, true)
	if missingAction.Code != http.StatusBadRequest || !strings.Contains(missingAction.Body.String(), "参数错误") {
		t.Fatalf("unexpected missing action response: status=%d body=%s", missingAction.Code, missingAction.Body.String())
	}

	badAction := performJSONRequest(handler, http.MethodPost, "/api/games/roguelite/step", `{"sessionId":"s1","action":{"type":"bad"}}`, true)
	if badAction.Code != http.StatusBadRequest || !strings.Contains(badAction.Body.String(), "无效的行动参数") {
		t.Fatalf("unexpected bad action response: status=%d body=%s", badAction.Code, badAction.Body.String())
	}

	missingChestOpen := performJSONRequest(handler, http.MethodPost, "/api/games/roguelite/step", `{"sessionId":"s1","action":{"type":"chest"}}`, true)
	if missingChestOpen.Code != http.StatusBadRequest || !strings.Contains(missingChestOpen.Body.String(), "无效的行动参数") {
		t.Fatalf("unexpected chest action response: status=%d body=%s", missingChestOpen.Code, missingChestOpen.Body.String())
	}
}

func TestRogueliteRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/games/roguelite/status", "", true)
	if status.Code != http.StatusServiceUnavailable || !strings.Contains(status.Body.String(), "星尘迷阵数据库未配置") {
		t.Fatalf("unexpected status unavailable response: status=%d body=%s", status.Code, status.Body.String())
	}

	start := performJSONRequest(handler, http.MethodPost, "/api/games/roguelite/start", `{}`, true)
	if start.Code != http.StatusServiceUnavailable || !strings.Contains(start.Body.String(), "星尘迷阵数据库未配置") {
		t.Fatalf("unexpected start unavailable response: status=%d body=%s", start.Code, start.Body.String())
	}
}
