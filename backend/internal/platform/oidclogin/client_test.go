package oidclogin

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/testutil"
)

func TestAuthorizationCodeLoginUsesPKCEAndClientAuthentication(t *testing.T) {
	provider := testutil.NewOIDCProvider(t)
	for _, method := range []string{"client_secret_post", "client_secret_basic"} {
		t.Run(method, func(t *testing.T) {
			settings := provider.Settings()
			settings.TokenAuthMethod = method
			settings.DiscoveryURL = provider.Server.URL + "/.well-known/welfare/openid-configuration"
			client, err := Discover(context.Background(), settings)
			if err != nil {
				t.Fatal(err)
			}
			verifier := strings.Repeat("v", 43)
			authorization, _ := url.Parse(client.AuthorizationURL("flow-state", "flow-nonce", verifier))
			query := authorization.Query()
			hash := sha256.Sum256([]byte(verifier))
			if query.Get("state") != "flow-state" || query.Get("nonce") != "flow-nonce" || query.Get("response_type") != "code" || query.Get("code_challenge_method") != "S256" || query.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(hash[:]) || query.Get("redirect_uri") != settings.RedirectURL {
				t.Fatalf("unsafe authorization parameters: %v", query)
			}
			identity, err := client.Exchange(context.Background(), "flow-nonce", "flow-nonce", verifier)
			if err != nil || identity.Subject != provider.Subject || identity.BindingSubject != provider.Subject || identity.Username != "casdoor-user" {
				t.Fatalf("signed login failed: identity=%+v err=%v", identity, err)
			}
			request := <-provider.TokenRequests
			if request.Form.Get("code_verifier") != verifier || request.Form.Get("redirect_uri") != settings.RedirectURL {
				t.Fatalf("missing PKCE verifier or callback: %v", request.Form)
			}
			if method == "client_secret_post" && (request.Form.Get("client_secret") != provider.ClientSecret || request.Authorization != "") {
				t.Fatal("client_secret_post must authenticate in the token body")
			}
			if method == "client_secret_basic" && (!strings.HasPrefix(request.Authorization, "Basic ") || request.Form.Get("client_secret") != "") {
				t.Fatal("client_secret_basic must authenticate in the Authorization header")
			}
		})
	}
}

func TestExchangeRejectsInvalidTokensAndProfiles(t *testing.T) {
	provider := testutil.NewOIDCProvider(t)
	provider.Claims = func(code string) map[string]any {
		switch code {
		case "issuer":
			return map[string]any{"iss": "https://other.example.com"}
		case "audience":
			return map[string]any{"aud": "other-client"}
		case "expired":
			return map[string]any{"exp": time.Now().Add(-time.Minute).Unix()}
		case "nonce":
			return map[string]any{"nonce": "wrong-nonce"}
		case "future-issuance":
			return map[string]any{"iat": time.Now().Add(5 * time.Minute).Unix()}
		case "authorized-party":
			return map[string]any{"azp": "other-client"}
		case "multiple-audiences":
			return map[string]any{"aud": []string{provider.ClientID, "other-client"}}
		case "forbidden":
			return map[string]any{"isForbidden": true}
		case "deleted":
			return map[string]any{"isDeleted": true}
		case "access-token-hash":
			return map[string]any{"at_hash": "incorrect-hash"}
		}
		return nil
	}
	provider.UserInfo = func(code string) map[string]any {
		profile := map[string]any{"sub": provider.Subject, "preferred_username": "casdoor-user"}
		if code == "userinfo-subject" {
			profile["sub"] = "other-subject"
		}
		if code == "userinfo-forbidden" {
			profile["isForbidden"] = true
		}
		return profile
	}
	client, err := Discover(context.Background(), provider.Settings())
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"issuer", "audience", "expired", "nonce", "future-issuance", "authorized-party", "multiple-audiences", "forbidden", "deleted", "access-token-hash", "userinfo-subject", "userinfo-forbidden"} {
		t.Run(code, func(t *testing.T) {
			if _, err := client.Exchange(context.Background(), code, code, strings.Repeat("v", 43)); err == nil {
				t.Fatal("unsafe token/profile must not authenticate")
			}
		})
	}
}

func TestExchangeRejectsBadSignatureAndMissingIDToken(t *testing.T) {
	provider := testutil.NewOIDCProvider(t)
	other := testutil.NewOIDCProvider(t)
	provider.TokenResponse = func(request *http.Request) map[string]any {
		data := map[string]any{"access_token": "access-token", "token_type": "Bearer"}
		if request.Form.Get("code") == "bad-signature" {
			data["id_token"] = other.Sign(map[string]any{"iss": provider.Server.URL, "sub": provider.Subject, "aud": provider.ClientID,
				"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(), "nonce": "bad-signature"})
		}
		return data
	}
	client, err := Discover(context.Background(), provider.Settings())
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []string{"bad-signature", "missing-token"} {
		if _, err := client.Exchange(context.Background(), code, code, strings.Repeat("v", 43)); err == nil {
			t.Fatalf("%s must be rejected", code)
		}
	}
}

func TestDiscoveryRejectsUnsafeMetadata(t *testing.T) {
	for _, test := range []struct {
		key   string
		value any
	}{
		{"issuer", "https://other.example.com"},
		{"token_endpoint", "http://insecure.example.com/token"},
		{"id_token_signing_alg_values_supported", []string{"HS256", "none"}},
		{"code_challenge_methods_supported", []string{"plain"}},
		{"response_types_supported", []string{"token"}},
		{"token_endpoint_auth_methods_supported", []string{"none"}},
	} {
		t.Run(test.key, func(t *testing.T) {
			provider := testutil.NewOIDCProvider(t)
			provider.MetadataOverrides[test.key] = test.value
			if _, err := Discover(context.Background(), provider.Settings()); err == nil {
				t.Fatal("unsafe discovery metadata must be rejected")
			}
		})
	}
}

func TestIdentityClaimsPreserveProviderKeys(t *testing.T) {
	provider := testutil.NewOIDCProvider(t)
	provider.UserInfo = func(string) map[string]any {
		return map[string]any{"sub": provider.Subject, "account": map[string]any{"id": json.Number("9007199254740993")}, "preferred_username": " user "}
	}
	settings := provider.Settings()
	settings.SubjectClaim = "account.id"
	client, err := Discover(context.Background(), settings)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := client.Exchange(context.Background(), "nonce", "nonce", strings.Repeat("v", 43))
	if err != nil || identity.BindingSubject != "9007199254740993" || identity.Username != "user" {
		t.Fatalf("provider key lost precision: %+v %v", identity, err)
	}
	if value := ClaimString(map[string]any{"sub": " Case Sensitive "}, "sub"); value != " Case Sensitive " {
		t.Fatalf("provider subject must remain exact: %q", value)
	}
}

func TestHTTPClientDoesNotForwardSecretsThroughRedirects(t *testing.T) {
	var leaked atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked.Add(1) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	request, _ := http.NewRequest(http.MethodPost, source.URL, strings.NewReader("client_secret=test-secret"))
	request.Header.Set("Authorization", "Bearer test-access-token")
	response, err := HTTPClient().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusTemporaryRedirect || leaked.Load() != 0 {
		t.Fatal("OAuth secrets must not follow endpoint redirects")
	}
}
