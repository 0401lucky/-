package oidclogin

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"redemption/backend/internal/oidcconfig"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type Client struct {
	provider *oidc.Provider
	oauth    oauth2.Config
	http     *http.Client
	settings oidcconfig.Settings
	userinfo bool
}

type Identity struct {
	Subject        string `json:"subject"`
	BindingSubject string `json:"bindingSubject"`
	Username       string `json:"username"`
	Email          string `json:"email"`
}

// Both OAuth secrets and access tokens must stay on their configured endpoints.
func HTTPClient() *http.Client {
	return &http.Client{
		Timeout:       10 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
		Transport:     limitedTransport{base: http.DefaultTransport},
	}
}

func Discover(ctx context.Context, settings oidcconfig.Settings) (*Client, error) {
	httpClient := HTTPClient()
	ctx = oidc.ClientContext(ctx, httpClient)
	discoveryURL := settings.DiscoveryURL
	if discoveryURL == "" {
		discoveryURL = strings.TrimSuffix(settings.IssuerURL, "/") + "/.well-known/openid-configuration"
	}
	if err := oidcconfig.ValidateURL(discoveryURL); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, errors.New("OIDC discovery request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, errors.New("OIDC discovery returned an unsuccessful response")
	}
	var metadata struct {
		oidc.ProviderConfig
		ResponseTypes []string `json:"response_types_supported"`
		AuthMethods   []string `json:"token_endpoint_auth_methods_supported"`
		PKCEMethods   []string `json:"code_challenge_methods_supported"`
	}
	if err := json.NewDecoder(response.Body).Decode(&metadata); err != nil {
		return nil, errors.New("invalid OIDC discovery document")
	}
	if metadata.IssuerURL != settings.IssuerURL {
		return nil, errors.New("OIDC discovery issuer does not match the configured issuer")
	}
	for _, endpoint := range []string{metadata.AuthURL, metadata.TokenURL, metadata.JWKSURL} {
		if oidcconfig.ValidateURL(endpoint) != nil {
			return nil, errors.New("OIDC discovery contains an invalid or insecure endpoint")
		}
	}
	if metadata.UserInfoURL != "" && oidcconfig.ValidateURL(metadata.UserInfoURL) != nil {
		return nil, errors.New("invalid OIDC UserInfo endpoint")
	}
	if len(metadata.ResponseTypes) > 0 && !includes(metadata.ResponseTypes, "code") {
		return nil, errors.New("OIDC provider does not support authorization code login")
	}
	if len(metadata.PKCEMethods) > 0 && !includes(metadata.PKCEMethods, "S256") {
		return nil, errors.New("OIDC provider does not support PKCE S256")
	}
	if len(metadata.AuthMethods) > 0 && !includes(metadata.AuthMethods, settings.TokenAuthMethod) {
		return nil, errors.New("OIDC provider does not support the configured client authentication method")
	}
	// Never accept symmetric JWT algorithms or unsigned ID tokens from discovery.
	var algorithms []string
	for _, algorithm := range metadata.Algorithms {
		if includes([]string{"RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "EdDSA"}, algorithm) {
			algorithms = append(algorithms, algorithm)
		}
	}
	if len(metadata.Algorithms) == 0 {
		algorithms = []string{"RS256"}
	}
	if len(algorithms) == 0 {
		return nil, errors.New("OIDC provider does not advertise a supported signing algorithm")
	}
	metadata.Algorithms = algorithms
	provider := metadata.ProviderConfig.NewProvider(ctx)
	endpoint := provider.Endpoint()
	endpoint.AuthStyle = oauth2.AuthStyleInParams
	if settings.TokenAuthMethod == "client_secret_basic" {
		endpoint.AuthStyle = oauth2.AuthStyleInHeader
	}
	return &Client{
		provider: provider, http: httpClient, settings: settings, userinfo: metadata.UserInfoURL != "",
		oauth: oauth2.Config{ClientID: settings.ClientID, ClientSecret: settings.ClientSecret,
			RedirectURL: settings.RedirectURL, Scopes: strings.Fields(settings.Scopes), Endpoint: endpoint},
	}, nil
}

func (client *Client) AuthorizationURL(state, nonce, verifier string) string {
	return client.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("response_mode", "query"))
}

func (client *Client) Exchange(ctx context.Context, code, nonce, verifier string) (Identity, error) {
	ctx = oidc.ClientContext(ctx, client.http)
	token, err := client.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return Identity{}, errors.New("OIDC token exchange failed")
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return Identity{}, errors.New("OIDC provider did not return an ID token")
	}
	idToken, err := client.provider.Verifier(&oidc.Config{ClientID: client.settings.ClientID}).Verify(ctx, raw)
	if err != nil {
		return Identity{}, errors.New("OIDC ID token verification failed")
	}
	if nonce == "" || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		return Identity{}, errors.New("OIDC nonce verification failed")
	}
	if idToken.Subject == "" || len(idToken.Subject) > 512 || idToken.IssuedAt.IsZero() || idToken.IssuedAt.After(time.Now().Add(time.Minute)) {
		return Identity{}, errors.New("invalid OIDC subject or issuance time")
	}
	if idToken.AccessTokenHash != "" {
		if err := idToken.VerifyAccessToken(token.AccessToken); err != nil {
			return Identity{}, errors.New("OIDC access token hash verification failed")
		}
	}
	claims, err := readClaims(idToken.Claims)
	if err != nil {
		return Identity{}, errors.New("invalid OIDC claims")
	}
	authorizedParty, _ := claims["azp"].(string)
	if (authorizedParty != "" && authorizedParty != client.settings.ClientID) || (len(idToken.Audience) > 1 && authorizedParty != client.settings.ClientID) {
		return Identity{}, errors.New("OIDC authorized party verification failed")
	}
	if claims["isForbidden"] == true || claims["isDeleted"] == true {
		return Identity{}, errors.New("OIDC user is forbidden")
	}
	if client.userinfo {
		userinfo, err := client.provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
		if err != nil {
			return Identity{}, errors.New("OIDC UserInfo request failed")
		}
		if userinfo.Subject != idToken.Subject {
			return Identity{}, errors.New("OIDC UserInfo subject does not match the ID token")
		}
		profile, err := readClaims(userinfo.Claims)
		if err != nil {
			return Identity{}, errors.New("invalid OIDC UserInfo claims")
		}
		if profile["isForbidden"] == true || profile["isDeleted"] == true {
			return Identity{}, errors.New("OIDC user is forbidden")
		}
		for key, value := range profile {
			claims[key] = value
		}
	}
	identity := Identity{
		Subject: idToken.Subject, BindingSubject: ClaimString(claims, client.settings.SubjectClaim),
		Username: strings.TrimSpace(ClaimString(claims, client.settings.UsernameClaim)), Email: strings.TrimSpace(ClaimString(claims, "email")),
	}
	if identity.BindingSubject == "" || len(identity.BindingSubject) > 512 || len(identity.Username) > 256 || len(identity.Email) > 320 {
		return Identity{}, errors.New("OIDC account mapping claims are missing or invalid")
	}
	return identity, nil
}

func readClaims(read func(any) error) (map[string]any, error) {
	var raw json.RawMessage
	if err := read(&raw); err != nil {
		return nil, err
	}
	var claims map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	err := decoder.Decode(&claims)
	return claims, err
}

func ClaimString(claims map[string]any, path string) string {
	var current any = claims
	for _, part := range strings.Split(path, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return ""
		}
		current = object[part]
	}
	// Preserve case, whitespace and numeric precision in provider identity keys.
	switch value := current.(type) {
	case string:
		return value
	case json.Number:
		return value.String()
	default:
		return ""
	}
}

func includes(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

type limitedTransport struct{ base http.RoundTripper }
type limitedBody struct {
	io.Reader
	io.Closer
}

func (transport limitedTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := transport.base.RoundTrip(request)
	if err != nil {
		return nil, err
	}
	response.Body = limitedBody{Reader: io.LimitReader(response.Body, 1<<20), Closer: response.Body}
	return response, nil
}
