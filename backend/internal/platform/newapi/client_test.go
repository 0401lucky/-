package newapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCreditQuotaUsesAdminHeadersAndManageAPI(t *testing.T) {
	var manageCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assertAuthHeaders(t, request)
		switch request.URL.Path {
		case "/api/user/123":
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 1000000, "used_quota": 0})
		case "/api/user/manage":
			manageCalled = true
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode manage payload failed: %v", err)
			}
			if payload["mode"] != "add" || int64(payload["value"].(float64)) != 1000000 {
				t.Fatalf("unexpected manage payload: %+v", payload)
			}
			writeEnvelope(t, writer, true, "updated", nil)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	result, err := client.CreditQuota(context.Background(), 123, 2)
	if err != nil {
		t.Fatalf("CreditQuota returned error: %v", err)
	}
	if !manageCalled {
		t.Fatalf("manage API should be called")
	}
	if !result.Success || result.NewQuota != 2000000 || result.NewBalanceDollars != 4 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestDeductQuotaRejectsInsufficientBalanceWithoutManageCall(t *testing.T) {
	var manageCalled bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assertAuthHeaders(t, request)
		switch request.URL.Path {
		case "/api/user/123":
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 100000, "used_quota": 0})
		case "/api/user/manage":
			manageCalled = true
			writeEnvelope(t, writer, true, "updated", nil)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	result, err := client.DeductQuota(context.Background(), 123, 1)
	if err != nil {
		t.Fatalf("DeductQuota returned error: %v", err)
	}
	if manageCalled {
		t.Fatalf("manage API should not be called when balance is insufficient")
	}
	if result.Success || result.NewQuota != 100000 || result.NewBalanceDollars != 0.2 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCreditQuotaVerifiesWhenManageFails(t *testing.T) {
	userReads := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assertAuthHeaders(t, request)
		switch request.URL.Path {
		case "/api/user/123":
			userReads++
			quota := int64(1000000)
			if userReads > 1 {
				quota = 1500000
			}
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": quota, "used_quota": 0})
		case "/api/user/manage":
			writeEnvelope(t, writer, false, "temporary failure", nil)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	result, err := client.CreditQuota(context.Background(), 123, 1)
	if err != nil {
		t.Fatalf("CreditQuota returned error: %v", err)
	}
	if !result.Success || result.NewQuota != 1500000 || result.Message != "充值已确认成功" {
		t.Fatalf("unexpected verified result: %+v", result)
	}
}

func TestDeductQuotaUsesSubtractMode(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		assertAuthHeaders(t, request)
		switch request.URL.Path {
		case "/api/user/123":
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 1500000, "used_quota": 0})
		case "/api/user/manage":
			var payload map[string]any
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				t.Fatalf("decode manage payload failed: %v", err)
			}
			if payload["mode"] != "subtract" || int64(payload["value"].(float64)) != 500000 {
				t.Fatalf("unexpected manage payload: %+v", payload)
			}
			writeEnvelope(t, writer, true, "updated", nil)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	result, err := client.DeductQuota(context.Background(), 123, 1)
	if err != nil {
		t.Fatalf("DeductQuota returned error: %v", err)
	}
	if !result.Success || result.NewQuota != 1000000 || result.NewBalanceDollars != 2 {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestQuotaConversions(t *testing.T) {
	if DollarsToQuota(1.25) != 625000 {
		t.Fatalf("unexpected quota conversion")
	}
	if QuotaToDollars(625000) != 1.25 {
		t.Fatalf("unexpected dollars conversion")
	}
	if QuotaToWholeDollars(625000) != 1 {
		t.Fatalf("unexpected whole dollars conversion")
	}
}

func TestNewRejectsNonNumericAdminUserID(t *testing.T) {
	_, err := New(Options{
		BaseURL:          "https://newapi.example.com",
		AdminAccessToken: "token-abc",
		AdminUserID:      "lucky",
		HTTPClient:       http.DefaultClient,
	})
	if err == nil {
		t.Fatalf("expected non-numeric admin user ID to be rejected")
	}
	if err.Error() != "NEW_API_ADMIN_USER_ID must be a numeric new-api user ID" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestNewNormalizesCopiedAuthorizationHeader(t *testing.T) {
	client, err := New(Options{
		BaseURL:          "https://newapi.example.com",
		AdminAccessToken: "Authorization: Bearer token-abc",
		AdminUserID:      "900",
		HTTPClient:       http.DefaultClient,
	})
	if err != nil {
		t.Fatalf("new client failed: %v", err)
	}
	request := httptest.NewRequest(http.MethodGet, "https://example.com", nil)
	client.setAuthHeaders(request)
	if request.Header.Get("Authorization") != "Bearer token-abc" {
		t.Fatalf("unexpected Authorization header: %q", request.Header.Get("Authorization"))
	}
}

func TestFetchUserWrapsAdminAuthFailure(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		if request.Header.Get("New-Api-User") != "900" {
			t.Fatalf("missing New-Api-User header")
		}
		writeEnvelope(t, writer, false, "Unauthorized, invalid access token", nil)
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	_, err := client.GetQuotaBalance(context.Background(), 123)
	if !errors.Is(err, ErrAdminAuthFailed) {
		t.Fatalf("expected ErrAdminAuthFailed, got %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected bearer and legacy attempts, got %d", attempts)
	}
}

func TestGetQuotaBalanceRetriesLegacyBareToken(t *testing.T) {
	var attempts int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attempts++
		if attempts == 1 {
			if request.Header.Get("Authorization") != "Bearer token-abc" {
				t.Fatalf("first attempt should use Bearer token, got %q", request.Header.Get("Authorization"))
			}
			writeEnvelope(t, writer, false, "Unauthorized, invalid access token", nil)
			return
		}
		if request.Header.Get("Authorization") != "token-abc" {
			t.Fatalf("retry should use legacy bare token, got %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("New-Api-User") != "900" {
			t.Fatalf("missing New-Api-User header")
		}
		writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 1000000, "used_quota": 0})
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	balance, err := client.GetQuotaBalance(context.Background(), 123)
	if err != nil {
		t.Fatalf("GetQuotaBalance returned error: %v", err)
	}
	if attempts != 2 || balance.BalanceDollars != 2 {
		t.Fatalf("unexpected attempts=%d balance=%+v", attempts, balance)
	}
}

func TestManageQuotaRetriesLegacyBareToken(t *testing.T) {
	manageAttempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/user/123":
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 1000000, "used_quota": 0})
		case "/api/user/manage":
			manageAttempts++
			if manageAttempts == 1 {
				if request.Header.Get("Authorization") != "Bearer token-abc" {
					t.Fatalf("first manage attempt should use Bearer token, got %q", request.Header.Get("Authorization"))
				}
				writeEnvelope(t, writer, false, "Unauthorized, invalid access token", nil)
				return
			}
			if request.Header.Get("Authorization") != "token-abc" {
				t.Fatalf("manage retry should use legacy bare token, got %q", request.Header.Get("Authorization"))
			}
			writeEnvelope(t, writer, true, "updated", nil)
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client := newTestClient(t, server.URL)
	result, err := client.CreditQuota(context.Background(), 123, 1)
	if err != nil {
		t.Fatalf("CreditQuota returned error: %v", err)
	}
	if manageAttempts != 2 || !result.Success {
		t.Fatalf("unexpected manageAttempts=%d result=%+v", manageAttempts, result)
	}
}

func TestGetQuotaBalanceFallsBackToAdminPasswordSession(t *testing.T) {
	loginCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/user/login":
			loginCalled = true
			if request.Method != http.MethodPost {
				t.Fatalf("unexpected login method: %s", request.Method)
			}
			http.SetCookie(writer, &http.Cookie{Name: "session", Value: "admin-session", Path: "/"})
			writeLoginEnvelope(t, writer, true, "ok", map[string]any{
				"id":           900,
				"username":     "admin",
				"display_name": "Admin",
				"role":         100,
				"status":       1,
			})
		case "/api/user/123":
			if request.Header.Get("Cookie") != "session=admin-session" {
				t.Fatalf("expected admin session cookie, got %q", request.Header.Get("Cookie"))
			}
			if request.Header.Get("Authorization") != "" {
				t.Fatalf("session fallback should not send Authorization, got %q", request.Header.Get("Authorization"))
			}
			if request.Header.Get("New-Api-User") != "900" {
				t.Fatalf("expected logged-in admin user id header, got %q", request.Header.Get("New-Api-User"))
			}
			writeEnvelope(t, writer, true, "ok", map[string]any{"quota": 2000000, "used_quota": 0})
		default:
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	client, err := New(Options{
		BaseURL:       server.URL,
		AdminUsername: "admin",
		AdminPassword: "password",
		HTTPClient:    http.DefaultClient,
	})
	if err != nil {
		t.Fatalf("new client failed: %v", err)
	}
	balance, err := client.GetQuotaBalance(context.Background(), 123)
	if err != nil {
		t.Fatalf("GetQuotaBalance returned error: %v", err)
	}
	if !loginCalled || balance.BalanceDollars != 4 {
		t.Fatalf("unexpected loginCalled=%v balance=%+v", loginCalled, balance)
	}
}

func newTestClient(t *testing.T, baseURL string) *Client {
	t.Helper()
	client, err := New(Options{
		BaseURL:          baseURL,
		AdminAccessToken: "token-abc",
		AdminUserID:      "900",
		HTTPClient:       http.DefaultClient,
	})
	if err != nil {
		t.Fatalf("new client failed: %v", err)
	}
	return client
}

func assertAuthHeaders(t *testing.T, request *http.Request) {
	t.Helper()
	if request.Header.Get("Authorization") != "Bearer token-abc" {
		t.Fatalf("missing Authorization header")
	}
	if request.Header.Get("New-Api-User") != "900" {
		t.Fatalf("missing New-Api-User header")
	}
}

func writeEnvelope(t *testing.T, writer http.ResponseWriter, success bool, message string, data map[string]any) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(apiEnvelope{
		Success: success,
		Message: message,
		Data:    data,
	}); err != nil {
		t.Fatalf("write response failed: %v", err)
	}
}

func writeLoginEnvelope(t *testing.T, writer http.ResponseWriter, success bool, message string, data map[string]any) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(writer).Encode(loginEnvelope{
		Success: success,
		Message: message,
		Data:    mustRawJSON(t, data),
	}); err != nil {
		t.Fatalf("write response failed: %v", err)
	}
}

func mustRawJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal raw json failed: %v", err)
	}
	return raw
}
