//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestAuthMeSyncsAuthenticatedUserToPostgres(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(98001 + time.Now().UnixNano()%1_000_000_000)
	_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	username := "auth_sync_" + strconv.FormatInt(userID, 10)
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.AddCookie(testSessionCookieFor(userID, username, "Auth Sync User"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected auth me 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		User    struct {
			ID          int64  `json:"id"`
			Username    string `json:"username"`
			DisplayName string `json:"displayName"`
			IsAdmin     bool   `json:"isAdmin"`
		} `json:"user"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode auth me response failed: %v", err)
	}
	if !payload.Success || payload.User.ID != userID || payload.User.Username != username || payload.User.DisplayName != "Auth Sync User" || payload.User.IsAdmin {
		t.Fatalf("unexpected auth me payload: %+v", payload)
	}

	var storedUsername string
	var balance int64
	var assets int64
	if err := db.QueryRow(ctx,
		`SELECT u.username, p.balance, COUNT(a.user_id)
		   FROM users u
		   JOIN point_accounts p ON p.user_id = u.id
		   LEFT JOIN user_assets a ON a.user_id = u.id
		  WHERE u.id = $1
		  GROUP BY u.username, p.balance`,
		userID,
	).Scan(&storedUsername, &balance, &assets); err != nil {
		t.Fatalf("query synced user failed: %v", err)
	}
	if storedUsername != username || balance != 0 || assets != 1 {
		t.Fatalf("unexpected synced user state: username=%s balance=%d assets=%d", storedUsername, balance, assets)
	}
}
