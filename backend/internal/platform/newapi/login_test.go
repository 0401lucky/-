package newapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestLoginForwardsTurnstileTokenAndKeepsCredentialsOnlyInBody(t *testing.T) {
	const turnstileToken = "turnstile-token"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", request.Method)
		}
		if request.URL.Path != "/api/user/login" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		if got := request.URL.Query().Get("turnstile"); got != turnstileToken {
			t.Fatalf("unexpected turnstile token: %q", got)
		}

		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode login body failed: %v", err)
		}
		wantBody := map[string]string{
			"username": "lucky",
			"password": "password",
		}
		if !reflect.DeepEqual(body, wantBody) {
			t.Fatalf("unexpected login body: got %#v want %#v", body, wantBody)
		}

		http.SetCookie(writer, &http.Cookie{Name: "session", Value: "session-123"})
		writeLoginEnvelope(t, writer, true, "", map[string]any{
			"id":       7,
			"username": "lucky",
			"role":     100,
			"status":   1,
		})
	}))
	defer server.Close()

	result, err := Login(context.Background(), server.URL, " lucky ", " password ", turnstileToken, http.DefaultClient)
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if !result.Success || result.User == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.User.ID != 7 || result.User.Username != "lucky" || result.User.DisplayName != "lucky" {
		t.Fatalf("unexpected user: %+v", result.User)
	}
	if result.Cookies != "session=session-123" {
		t.Fatalf("unexpected cookies: %q", result.Cookies)
	}
}

func TestLoginPreservesSpecialCharactersInTurnstileToken(t *testing.T) {
	const turnstileToken = "0.AB+c/def==&next?value=x y%z"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := request.URL.Query().Get("turnstile"); got != turnstileToken {
			t.Fatalf("turnstile token changed after URL encoding: got %q want %q", got, turnstileToken)
		}
		writeLoginEnvelope(t, writer, true, "", map[string]any{
			"id":       7,
			"username": "lucky",
		})
	}))
	defer server.Close()

	result, err := Login(context.Background(), server.URL, "lucky", "password", turnstileToken, http.DefaultClient)
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestLoginOmitsTurnstileQueryWhenTokenIsEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.RawQuery != "" {
			t.Fatalf("expected empty query, got %q", request.URL.RawQuery)
		}
		writeLoginEnvelope(t, writer, true, "", map[string]any{
			"id":       7,
			"username": "lucky",
		})
	}))
	defer server.Close()

	result, err := Login(context.Background(), server.URL, "lucky", "password", "", http.DefaultClient)
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if !result.Success {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestLoginTransportErrorDoesNotExposeTurnstileToken(t *testing.T) {
	const turnstileToken = "sensitive-turnstile-token"
	httpClient := &http.Client{
		Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			return nil, errors.New("transport failed for " + request.URL.String())
		}),
	}

	_, err := Login(
		context.Background(),
		"https://new-api.example.com",
		"lucky",
		"password",
		turnstileToken,
		httpClient,
	)
	if err == nil {
		t.Fatal("expected transport error")
	}
	if strings.Contains(err.Error(), turnstileToken) || strings.Contains(err.Error(), "turnstile=") {
		t.Fatalf("transport error leaked Turnstile token: %q", err)
	}
	if err.Error() != "new-api login request failed" {
		t.Fatalf("unexpected sanitized transport error: %q", err)
	}
}

func TestLoginParsesUserNestedInDataForNewAuthAPI(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/user/login" {
			t.Fatalf("unexpected path: %s", request.URL.Path)
		}
		writeLoginEnvelope(t, writer, true, "", map[string]any{
			"access_token":      "at-123",
			"token_type":        "Bearer",
			"access_expires_at": 1790000000,
			"session": map[string]any{
				"sid":     "sid-abc",
				"current": true,
			},
			"user": map[string]any{
				"id":           7,
				"username":     "lucky",
				"display_name": "Lucky",
				"role":         100,
				"status":       1,
				"email":        "lucky@example.com",
				"quota":        1000000,
				"used_quota":   500,
			},
		})
	}))
	defer server.Close()

	result, err := Login(context.Background(), server.URL, "lucky", "password", "", http.DefaultClient)
	if err != nil {
		t.Fatalf("Login returned error: %v", err)
	}
	if !result.Success || result.User == nil {
		t.Fatalf("unexpected result: %+v", result)
	}
	if result.User.ID != 7 || result.User.Username != "lucky" || result.User.Role != 100 || result.User.Quota != 1000000 {
		t.Fatalf("unexpected user: %+v", result.User)
	}
}
