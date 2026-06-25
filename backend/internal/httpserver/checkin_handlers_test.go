package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCheckinHandlersRequireAuthentication(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/checkin", "", false)
	if status.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated status 401, got %d", status.Code)
	}

	checkin := performJSONRequest(handler, http.MethodPost, "/api/checkin", `{}`, false)
	if checkin.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated checkin 401, got %d", checkin.Code)
	}

	makeup := performJSONRequest(handler, http.MethodPost, "/api/checkin/makeup", `{"date":"2026-06-24"}`, false)
	if makeup.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated makeup 401, got %d", makeup.Code)
	}
}

func TestCheckinHandlersValidateUnsafeRequests(t *testing.T) {
	handler := New(testDependencies())

	crossSite := httptest.NewRequest(http.MethodPost, "/api/checkin", strings.NewReader(`{}`))
	crossSite.Host = "example.com"
	crossSite.Header.Set("Origin", "https://evil.example")
	crossSite.AddCookie(testSessionCookie())
	response := performRequest(handler, crossSite)
	if response.Code != http.StatusForbidden {
		t.Fatalf("expected cross-site checkin 403, got %d", response.Code)
	}

}

func TestCheckinHandlersReportMissingDatabase(t *testing.T) {
	handler := New(testDependencies())

	status := performJSONRequest(handler, http.MethodGet, "/api/checkin", "", true)
	if status.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected missing db status 503, got %d", status.Code)
	}

	checkin := performJSONRequest(handler, http.MethodPost, "/api/checkin", `{}`, true)
	if checkin.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected missing db checkin 503, got %d", checkin.Code)
	}
}
