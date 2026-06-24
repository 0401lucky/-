package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestGameSummaryRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	overview := performJSONRequest(handler, http.MethodGet, "/api/games/overview", "", false)
	if overview.Code != http.StatusUnauthorized || !strings.Contains(overview.Body.String(), "未登录") {
		t.Fatalf("unexpected overview unauthenticated response: status=%d body=%s", overview.Code, overview.Body.String())
	}

	profile := performJSONRequest(handler, http.MethodGet, "/api/games/profile", "", false)
	if profile.Code != http.StatusUnauthorized || !strings.Contains(profile.Body.String(), "未登录") {
		t.Fatalf("unexpected profile unauthenticated response: status=%d body=%s", profile.Code, profile.Body.String())
	}
}

func TestGameSummaryRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	overview := performJSONRequest(handler, http.MethodGet, "/api/games/overview", "", true)
	if overview.Code != http.StatusServiceUnavailable || !strings.Contains(overview.Body.String(), "DATABASE_UNAVAILABLE") {
		t.Fatalf("unexpected overview unavailable response: status=%d body=%s", overview.Code, overview.Body.String())
	}

	profile := performJSONRequest(handler, http.MethodGet, "/api/games/profile", "", true)
	if profile.Code != http.StatusServiceUnavailable || !strings.Contains(profile.Body.String(), "DATABASE_UNAVAILABLE") {
		t.Fatalf("unexpected profile unavailable response: status=%d body=%s", profile.Code, profile.Body.String())
	}
}
