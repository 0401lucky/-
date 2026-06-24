//go:build integration

package httpserver

import (
	"bytes"
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
	"redemption/backend/internal/profile"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestProfileSettingsHTTPReturnsCustomProfile(t *testing.T) {
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

	userID := int64(52001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestProfileUser(t, ctx, db, userID)
	defer cleanupHTTPTestProfileUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_http_user', 'Profile HTTP User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms)
		 VALUES ($1, 'HTTP昵称', 'https://example.com/http-avatar.png', '456@qq.com', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed profile failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, reason)
		 VALUES ($1, 'beginner', 'auto', $2, 'seed')`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed grant failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
		 VALUES ($1, 'beginner', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed equipped failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/profile/settings", bytes.NewBufferString(""))
	request.Host = "example.com"
	request.AddCookie(testSessionCookieFor(userID, "profile_http_"+strconv.FormatInt(userID, 10), "Profile HTTP User"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                 `json:"success"`
		Data    profile.SettingsData `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.DisplayName == nil || *payload.Data.DisplayName != "HTTP昵称" {
		t.Fatalf("unexpected profile payload: %+v", payload)
	}
	if payload.Data.EquippedAchievement == nil || payload.Data.EquippedAchievement.ID != "beginner" {
		t.Fatalf("unexpected equipped achievement: %+v", payload.Data.EquippedAchievement)
	}
}

func TestProfileSettingsHTTPUpdatesCustomProfile(t *testing.T) {
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

	userID := int64(52501 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestProfileUser(t, ctx, db, userID)
	defer cleanupHTTPTestProfileUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_put_user', 'Profile PUT User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms)
		 VALUES ($1, 'Old', 'https://example.com/old.png', '123456@qq.com', 1000)`,
		userID,
	); err != nil {
		t.Fatalf("seed profile failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPut, "/api/profile/settings", bytes.NewBufferString(`{"displayName":"  HTTP New  ","qqEmail":null}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "profile_put_"+strconv.FormatInt(userID, 10), "Profile PUT User"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                 `json:"success"`
		Data    profile.SettingsData `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.DisplayName == nil || *payload.Data.DisplayName != "HTTP New" {
		t.Fatalf("unexpected update payload: %+v", payload)
	}
	if payload.Data.AvatarURL == nil || *payload.Data.AvatarURL != "https://example.com/old.png" {
		t.Fatalf("avatar should be preserved: %+v", payload)
	}
	if payload.Data.QQEmail != nil {
		t.Fatalf("qq email should be cleared: %+v", payload)
	}
}

func TestProfileAchievementEquipHTTPUpdatesEquippedAchievement(t *testing.T) {
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

	userID := int64(52601 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestProfileUser(t, ctx, db, userID)
	defer cleanupHTTPTestProfileUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_equip_http', 'Profile Equip HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, reason)
		 VALUES ($1, 'beginner', 'auto', $2, 'seed')`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed achievement failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPut, "/api/profile/achievements/equip", bytes.NewBufferString(`{"achievementId":"beginner"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "profile_equip_"+strconv.FormatInt(userID, 10), "Profile Equip HTTP"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                           `json:"success"`
		Data    profile.EquipAchievementResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.EquippedID == nil || *payload.Data.EquippedID != "beginner" || payload.Data.Equipped == nil {
		t.Fatalf("unexpected equip payload: %+v", payload)
	}
}

func TestProfileOverviewHTTPReturnsMigratedSummary(t *testing.T) {
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

	userID := int64(52801 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestProfileUser(t, ctx, db, userID)
	defer cleanupHTTPTestProfileUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_overview_http', 'Profile Overview HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms)
		 VALUES ($1, 'HTTP主页', 'https://example.com/overview-http.png', '888@qq.com', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed profile failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance)
		 VALUES ($1, 6000)`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, card_draws)
		 VALUES ($1, 2)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, score, points_earned, payload, created_at)
		 VALUES ($1, $2, 'overview-http-session', 'lottery', 0, 0, '{}'::jsonb, now())`,
		"overview-http-game-"+strconv.FormatInt(userID, 10),
		userID,
	); err != nil {
		t.Fatalf("seed game record failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, created_at_ms, read_at_ms)
		 VALUES ($1, $2, 'system', 'HTTP未读', '内容', $3, NULL)`,
		"overview-http-notify-"+strconv.FormatInt(userID, 10),
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed notification failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/profile/overview", bytes.NewBufferString(""))
	request.Host = "example.com"
	request.AddCookie(testSessionCookieFor(userID, "profile_overview_http", "Profile Overview HTTP"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                 `json:"success"`
		Data    profile.OverviewData `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.User.ID != userID || payload.Data.User.CustomDisplayName == nil || *payload.Data.User.CustomDisplayName != "HTTP主页" {
		t.Fatalf("unexpected overview user payload: %+v", payload)
	}
	if payload.Data.Points.Balance != 6000 || payload.Data.Cards.DrawsAvailable != 2 || payload.Data.Notifications.UnreadCount != 1 {
		t.Fatalf("unexpected overview summary: %+v", payload.Data)
	}
	if len(payload.Data.Achievements.Items) == 0 || !profileOverviewAchievementUnlocked(payload.Data.Achievements.Items, "lottery_player") {
		t.Fatalf("overview achievements should include unlocked lottery_player: %+v", payload.Data.Achievements)
	}
}

func profileOverviewAchievementUnlocked(items []profile.AchievementItem, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return item.Unlocked
		}
	}
	return false
}

func cleanupHTTPTestProfileUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM notifications WHERE user_id = $1`,
		`DELETE FROM eco_prize_inventory WHERE user_id = $1`,
		`DELETE FROM eco_states WHERE user_id = $1`,
		`DELETE FROM game_records WHERE user_id = $1`,
		`DELETE FROM user_assets WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM user_profiles WHERE user_id = $1`,
		`DELETE FROM user_forced_achievements WHERE user_id = $1`,
		`DELETE FROM user_equipped_achievements WHERE user_id = $1`,
		`DELETE FROM user_achievement_grants WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup profile http user %d failed: %v", userID, err)
		}
	}
}
