package testutil

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/oidcconfig"

	"github.com/go-jose/go-jose/v4"
)

type OIDCTokenRequest struct {
	Form          url.Values
	Authorization string
}

// OIDCProvider serves real RSA-signed tokens and JWKS for authentication tests.
// Configure hooks before sending requests; the authorization code supplies the nonce by default.
type OIDCProvider struct {
	Server            *httptest.Server
	ClientID          string
	ClientSecret      string
	Subject           string
	MetadataOverrides map[string]any
	Claims            func(code string) map[string]any
	UserInfo          func(accessToken string) map[string]any
	TokenResponse     func(request *http.Request) map[string]any
	TokenRequests     chan OIDCTokenRequest
	key               *rsa.PrivateKey
	signer            jose.Signer
}

func NewOIDCProvider(t *testing.T) *OIDCProvider {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "test-key"))
	if err != nil {
		t.Fatal(err)
	}
	provider := &OIDCProvider{
		ClientID: "welfare-client", ClientSecret: "test-client-secret", Subject: "casdoor-subject",
		MetadataOverrides: map[string]any{}, TokenRequests: make(chan OIDCTokenRequest, 64), key: key, signer: signer,
	}
	provider.Server = httptest.NewServer(http.HandlerFunc(provider.serveHTTP))
	t.Cleanup(provider.Server.Close)
	return provider
}

func (provider *OIDCProvider) Settings() oidcconfig.Settings {
	settings := oidcconfig.Defaults()
	settings.Enabled = true
	settings.IssuerURL = provider.Server.URL
	settings.ClientID = provider.ClientID
	settings.ClientSecret = provider.ClientSecret
	settings.RedirectURL = "http://localhost" + oidcconfig.CallbackPath
	return settings
}

func (provider *OIDCProvider) Sign(claims map[string]any) string {
	raw, err := json.Marshal(claims)
	if err != nil {
		panic(err)
	}
	object, err := provider.signer.Sign(raw)
	if err != nil {
		panic(err)
	}
	token, err := object.CompactSerialize()
	if err != nil {
		panic(err)
	}
	return token
}

func (provider *OIDCProvider) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "application/json")
	var data any
	switch request.URL.Path {
	case "/.well-known/openid-configuration", "/.well-known/welfare/openid-configuration":
		metadata := map[string]any{
			"issuer": provider.Server.URL, "authorization_endpoint": provider.Server.URL + "/authorize",
			"token_endpoint": provider.Server.URL + "/token", "jwks_uri": provider.Server.URL + "/jwks",
			"userinfo_endpoint": provider.Server.URL + "/userinfo", "response_types_supported": []string{"code"},
			"token_endpoint_auth_methods_supported": []string{"client_secret_post", "client_secret_basic"},
			"code_challenge_methods_supported":      []string{"S256"}, "id_token_signing_alg_values_supported": []string{"RS256"},
		}
		for key, value := range provider.MetadataOverrides {
			metadata[key] = value
		}
		data = metadata
	case "/jwks":
		data = jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &provider.key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig"}}}
	case "/token":
		_ = request.ParseForm()
		provider.TokenRequests <- OIDCTokenRequest{Form: request.Form, Authorization: request.Header.Get("Authorization")}
		if provider.TokenResponse != nil {
			data = provider.TokenResponse(request)
			break
		}
		code := request.Form.Get("code")
		claims := map[string]any{
			"iss": provider.Server.URL, "sub": provider.Subject, "aud": provider.ClientID,
			"iat": time.Now().Add(-time.Second).Unix(), "exp": time.Now().Add(5 * time.Minute).Unix(), "nonce": code,
		}
		if provider.Claims != nil {
			for key, value := range provider.Claims(code) {
				claims[key] = value
			}
		}
		data = map[string]any{"access_token": code, "token_type": "Bearer", "expires_in": 300, "id_token": provider.Sign(claims)}
	case "/userinfo":
		if provider.UserInfo != nil {
			data = provider.UserInfo(strings.TrimPrefix(request.Header.Get("Authorization"), "Bearer "))
		} else {
			data = map[string]any{"sub": provider.Subject, "preferred_username": "casdoor-user", "email": "user@example.com"}
		}
	default:
		http.NotFound(writer, request)
		return
	}
	_ = json.NewEncoder(writer).Encode(data)
}
