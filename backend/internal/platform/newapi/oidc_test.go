package newapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestResolveOIDCAccountRequiresExactActiveBinding(t *testing.T) {
	for _, test := range []struct {
		name       string
		provider   string
		bound      bool
		status     int
		deletedKey string
		known      bool
		legacy     bool
		want       error
	}{
		{name: "built-in", provider: "oidc", bound: true, status: 1},
		{name: "same name without binding", provider: "oidc", status: 1, want: ErrOIDCNotBound},
		{name: "custom OAuth", provider: "custom", bound: true, status: 1},
		{name: "wrong custom binding", provider: "custom", status: 1, want: ErrOIDCNotBound},
		{name: "disabled", provider: "oidc", bound: true, status: 2, want: ErrOIDCUserDisabled},
		{name: "deleted snake case", provider: "oidc", bound: true, status: 1, deletedKey: "deleted_at", want: ErrOIDCUserDisabled},
		{name: "deleted GORM field", provider: "oidc", bound: true, status: 1, deletedKey: "DeletedAt", want: ErrOIDCUserDisabled},
		{name: "known account after rename", provider: "oidc", bound: true, status: 1, known: true},
		{name: "known binding revoked", provider: "oidc", status: 1, known: true, want: ErrOIDCNotBound},
		{name: "legacy array search", provider: "oidc", bound: true, status: 1, legacy: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var searches atomic.Int64
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Header.Get("Authorization") != "Bearer test-admin-token" || request.Header.Get("New-Api-User") != "1" {
					t.Error("account lookup must use server-side administrator authentication")
				}
				writer.Header().Set("Content-Type", "application/json")
				var data any
				switch request.URL.Path {
				case "/api/user/search":
					searches.Add(1)
					items := []User{{ID: 77, Username: "newapi-user", Email: "user@example.com"}, {ID: 88, Username: "newapi-user-lookalike"}}
					if test.legacy {
						data = items
					} else {
						data = map[string]any{"items": items, "total": 2}
					}
				case "/api/user/77":
					data = map[string]any{"id": 77, "username": "newapi-user", "display_name": "New API User", "status": test.status, "oidc_id": "other-subject", "DeletedAt": nil}
					if test.bound {
						data.(map[string]any)["oidc_id"] = "casdoor-subject"
					}
					if test.deletedKey != "" {
						data.(map[string]any)[test.deletedKey] = "2026-10-28T00:00:00Z"
					}
				case "/api/user/77/oauth/bindings":
					subject := "other-subject"
					if test.bound {
						subject = "casdoor-subject"
					}
					data = []map[string]any{{"provider_id": 4, "provider_user_id": subject}, {"provider_id": 9, "provider_user_id": "casdoor-subject"}}
				default:
					t.Errorf("unexpected or overly broad lookup: %s", request.URL.Path)
					http.NotFound(writer, request)
					return
				}
				_ = json.NewEncoder(writer).Encode(map[string]any{"success": true, "data": data})
			}))
			defer server.Close()
			client, err := New(Options{BaseURL: server.URL, AdminAccessToken: "test-admin-token", AdminUserID: "1"})
			if err != nil {
				t.Fatal(err)
			}
			query := OIDCAccountQuery{Provider: test.provider, ProviderID: 4, Subject: "casdoor-subject", Username: "newapi-user", Email: "user@example.com"}
			if test.known {
				query.KnownUserID = 77
				query.Username = "old-name"
			}
			user, err := client.ResolveOIDCAccount(context.Background(), query)
			if !errors.Is(err, test.want) {
				t.Fatalf("unexpected binding result: user=%+v err=%v want=%v", user, err, test.want)
			}
			if test.want == nil && (user == nil || user.ID != 77 || user.Username != "newapi-user") {
				t.Fatalf("login must retain the existing new-api account: %+v", user)
			}
			if test.known && searches.Load() != 0 {
				t.Fatal("a stable identity binding must not depend on the current username")
			}
		})
	}
}

func TestResolveOIDCAccountRejectsAmbiguousBindings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		var data any
		if request.URL.Path == "/api/user/search" {
			data = map[string]any{"items": []User{{ID: 77, Email: "shared@example.com"}, {ID: 88, Email: "shared@example.com"}}, "total": 2}
		} else {
			id := 77
			if strings.HasSuffix(request.URL.Path, "/88") {
				id = 88
			}
			data = map[string]any{"id": id, "username": "user", "status": 1, "oidc_id": "casdoor-subject"}
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"success": true, "data": data})
	}))
	defer server.Close()
	client, _ := New(Options{BaseURL: server.URL, AdminAccessToken: "test-admin-token", AdminUserID: "1"})
	_, err := client.ResolveOIDCAccount(context.Background(), OIDCAccountQuery{Provider: "oidc", Subject: "casdoor-subject", Email: "shared@example.com"})
	if !errors.Is(err, ErrOIDCAmbiguous) {
		t.Fatalf("multiple bound accounts must not be guessed: %v", err)
	}
}
