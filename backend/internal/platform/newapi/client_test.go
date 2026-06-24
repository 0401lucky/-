package newapi

import (
	"context"
	"encoding/json"
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
	if request.Header.Get("Authorization") != "token-abc" {
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
