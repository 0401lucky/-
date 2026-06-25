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
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func TestAuthLoginCreatesSessionAndSyncsUser(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	redisURL := os.Getenv("TEST_REDIS_URL")
	if databaseURL == "" || redisURL == "" {
		t.Skip("TEST_DATABASE_URL 或 TEST_REDIS_URL 未设置，跳过登录集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	userID := int64(99101 + time.Now().UnixNano()%1_000_000_000)
	username := "auth_login_" + strconv.FormatInt(userID, 10)
	cleanupLoginIntegrationState(t, ctx, db, redisClient, userID, username)
	defer cleanupLoginIntegrationState(t, ctx, db, redisClient, userID, username)

	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/user/login" || request.Method != http.MethodPost {
			http.NotFound(writer, request)
			return
		}
		var payload struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode fake new-api login body failed: %v", err)
		}
		writer.Header().Set("Content-Type", "application/json")
		if payload.Username == username && payload.Password == "correct-password" {
			http.SetCookie(writer, &http.Cookie{Name: "session", Value: "new-api-session-value", Path: "/"})
			_, _ = writer.Write([]byte(`{"success":true,"message":"ok","data":{"id":` + strconv.FormatInt(userID, 10) + `,"username":"` + username + `","display_name":"Auth Login User","role":1,"status":1,"email":"","quota":0,"used_quota":0}}`))
			return
		}
		_, _ = writer.Write([]byte(`{"success":false,"message":"密码错误"}`))
	}))
	defer newAPIServer.Close()

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
			NewAPIURL:      newAPIServer.URL,
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
		Redis:  redisClient,
	})

	bad := loginRequest(handler, username, "bad-password")
	if bad.Code != http.StatusUnauthorized || !strings.Contains(bad.Body.String(), "密码错误") {
		t.Fatalf("expected bad login 401, got status=%d body=%s", bad.Code, bad.Body.String())
	}

	response := loginRequest(handler, username, "correct-password")
	if response.Code != http.StatusOK {
		t.Fatalf("expected login 200, got status=%d body=%s", response.Code, response.Body.String())
	}
	if !hasCookie(response, "app_session") || !hasCookie(response, "session") || !hasCookie(response, "new_api_session") {
		t.Fatalf("expected login cookies to be set, got %#v", response.Result().Cookies())
	}

	var storedUsername string
	var storedDisplayName string
	var balance int64
	var assets int64
	if err := db.QueryRow(ctx,
		`SELECT u.username, u.display_name, p.balance, COUNT(a.user_id)
		   FROM users u
		   JOIN point_accounts p ON p.user_id = u.id
		   LEFT JOIN user_assets a ON a.user_id = u.id
		  WHERE u.id = $1
		  GROUP BY u.username, u.display_name, p.balance`,
		userID,
	).Scan(&storedUsername, &storedDisplayName, &balance, &assets); err != nil {
		t.Fatalf("query synced login user failed: %v", err)
	}
	if storedUsername != username || storedDisplayName != "Auth Login User" || balance != 0 || assets != 1 {
		t.Fatalf("unexpected synced login user: username=%s display=%s balance=%d assets=%d", storedUsername, storedDisplayName, balance, assets)
	}

	lockExists, err := redisClient.Exists(ctx, loginLockKeyPrefix+username).Result()
	if err != nil {
		t.Fatalf("check login lock failed: %v", err)
	}
	failExists, err := redisClient.Exists(ctx, loginFailKeyPrefix+username).Result()
	if err != nil {
		t.Fatalf("check login fail failed: %v", err)
	}
	if lockExists != 0 || failExists != 0 {
		t.Fatalf("expected successful login to clear failure state, lock=%d fail=%d", lockExists, failExists)
	}
}

func loginRequest(handler http.Handler, username string, password string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"username":"`+username+`","password":"`+password+`"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	return performRequest(handler, request)
}

func hasCookie(response *httptest.ResponseRecorder, name string) bool {
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == name && cookie.Value != "" {
			return true
		}
	}
	return false
}

func cleanupLoginIntegrationState(t *testing.T, ctx context.Context, db *pgxpool.Pool, redisClient *redis.Client, userID int64, username string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	_ = redisClient.Del(ctx, loginFailKeyPrefix+username, loginLockKeyPrefix+username, authLoginIPRateLimit.prefix+":192.0.2.1", authLoginUserRateLimit.prefix+":"+username).Err()
}
