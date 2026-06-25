//go:build integration

package httpserver

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"

	"github.com/redis/go-redis/v9"
)

func TestLogoutRevokesSessionInRedis(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL 未设置，跳过 Redis 集成测试")
	}

	options, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	client := redis.NewClient(options)
	defer client.Close()

	ctx := context.Background()
	jti := "auth-logout-integration-" + time.Now().Format("20060102150405.000000000")
	_ = client.Del(ctx, sessionBlacklistKeyPrefix+jti).Err()
	defer func() {
		_ = client.Del(ctx, sessionBlacklistKeyPrefix+jti).Err()
	}()

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Redis:  client,
	})

	cookie := testSessionCookieForWithJTI(99001, "logout_user", "Logout User", jti)
	logoutRequest := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	logoutRequest.Host = "example.com"
	logoutRequest.Header.Set("Origin", "http://example.com")
	logoutRequest.AddCookie(cookie)
	logoutResponse := performRequest(handler, logoutRequest)
	if logoutResponse.Code != http.StatusOK || !strings.Contains(logoutResponse.Body.String(), "已退出登录") {
		t.Fatalf("expected logout success, got status=%d body=%s", logoutResponse.Code, logoutResponse.Body.String())
	}

	exists, err := client.Exists(ctx, sessionBlacklistKeyPrefix+jti).Result()
	if err != nil {
		t.Fatalf("check blacklist key failed: %v", err)
	}
	if exists != 1 {
		t.Fatalf("expected blacklist key to exist")
	}

	meRequest := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	meRequest.AddCookie(cookie)
	meResponse := performRequest(handler, meRequest)
	if meResponse.Code != http.StatusUnauthorized || !strings.Contains(meResponse.Body.String(), "登录已失效") {
		t.Fatalf("expected revoked session to be rejected, got status=%d body=%s", meResponse.Code, meResponse.Body.String())
	}
}
