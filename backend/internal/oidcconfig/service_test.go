package oidcconfig

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func validSettings() Settings {
	settings := Defaults()
	settings.Enabled = true
	settings.IssuerURL = "https://casdoor.example.com"
	settings.ClientID = "welfare-client"
	settings.RedirectURL = "https://welfare.example.com" + CallbackPath
	return settings
}

func TestValidateOIDCSettings(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*Settings)
		secret bool
		valid  bool
	}{
		{"complete", func(*Settings) {}, true, true},
		{"missing secret", func(*Settings) {}, false, false},
		{"disabled draft", func(s *Settings) { s.Enabled = false; s.IssuerURL = ""; s.ClientID = ""; s.RedirectURL = "" }, false, true},
		{"insecure issuer", func(s *Settings) { s.IssuerURL = "http://casdoor.example.com" }, true, false},
		{"local development", func(s *Settings) {
			s.IssuerURL = "http://127.0.0.1:9000"
			s.RedirectURL = "http://localhost:8080" + CallbackPath
		}, true, true},
		{"issuer query", func(s *Settings) { s.IssuerURL += "?app=welfare" }, true, false},
		{"wrong callback", func(s *Settings) { s.RedirectURL = "https://welfare.example.com/login" }, true, false},
		{"callback query", func(s *Settings) { s.RedirectURL += "?next=evil" }, true, false},
		{"url credentials", func(s *Settings) { s.IssuerURL = "https://user:password@casdoor.example.com" }, true, false},
		{"no openid scope", func(s *Settings) { s.Scopes = "profile email" }, true, false},
		{"built-in subject", func(s *Settings) { s.SubjectClaim = "email" }, true, false},
		{"custom provider", func(s *Settings) { s.NewAPIProvider = "custom"; s.NewAPIProviderID = 4; s.SubjectClaim = "profile.id" }, true, true},
		{"custom missing id", func(s *Settings) { s.NewAPIProvider = "custom" }, true, false},
		{"claim expression", func(s *Settings) { s.UsernameClaim = "profile[0]" }, true, false},
		{"unsupported auth", func(s *Settings) { s.TokenAuthMethod = "none" }, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings := validSettings()
			test.change(&settings)
			_, err := Validate(settings, test.secret)
			if (err == nil) != test.valid || (err != nil && !errors.Is(err, ErrInvalid)) {
				t.Fatalf("unexpected validation: valid=%v err=%v", test.valid, err)
			}
		})
	}
}

func TestClientSecretEncryptionAndRedaction(t *testing.T) {
	service := NewService(nil, "test-session-secret")
	first, err := service.encrypt("oidc-client-secret")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.encrypt("oidc-client-secret")
	if err != nil || first == second || strings.Contains(first, "oidc-client-secret") {
		t.Fatalf("secrets must use randomized authenticated encryption: %v", err)
	}
	if plain, err := service.decrypt(first); err != nil || plain != "oidc-client-secret" {
		t.Fatalf("secret round trip failed: %v", err)
	}
	if _, err := NewService(nil, "different-session-secret").decrypt(first); err == nil {
		t.Fatal("a different key must not decrypt the secret")
	}
	raw, _ := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(first, "v1:"))
	raw[len(raw)-1] ^= 1
	if _, err := service.decrypt("v1:" + base64.RawURLEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("tampered ciphertext must be rejected")
	}
	settings := validSettings()
	settings.ClientSecret = "oidc-client-secret"
	settings.Revision = "private-revision"
	encoded, _ := json.Marshal(settings)
	if strings.Contains(string(encoded), "oidc-client-secret") || strings.Contains(string(encoded), "private-revision") {
		t.Fatal("configuration responses must not reveal secrets or flow revisions")
	}
	if _, err := service.Get(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("missing database must fail closed: %v", err)
	}
}
