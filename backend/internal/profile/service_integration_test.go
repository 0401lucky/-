//go:build integration

package profile

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGetSettingsReadsCustomProfileAndForcedAchievement(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(51001 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_user', 'Profile User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms)
		 VALUES ($1, '自定义昵称', 'https://example.com/avatar.png', '123@qq.com', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed profile failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason)
		 VALUES ($1, 'beginner', 'auto', $2, NULL, 'seed'),
		        ($1, 'thief', 'auto', $2, $3, 'forced')`,
		userID,
		nowMs,
		nowMs+60_000,
	); err != nil {
		t.Fatalf("seed grants failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms)
		 VALUES ($1, 'beginner', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed equipped failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms)
		 VALUES ($1, 'thief', $2, $3)`,
		userID,
		nowMs+60_000,
		nowMs,
	); err != nil {
		t.Fatalf("seed forced failed: %v", err)
	}

	data, err := NewService(db).GetSettings(ctx, userID, nowMs)
	if err != nil {
		t.Fatalf("get settings failed: %v", err)
	}
	if data.DisplayName == nil || *data.DisplayName != "自定义昵称" {
		t.Fatalf("unexpected display name: %#v", data.DisplayName)
	}
	if data.AvatarURL == nil || *data.AvatarURL != "https://example.com/avatar.png" {
		t.Fatalf("unexpected avatar: %#v", data.AvatarURL)
	}
	if data.QQEmail == nil || *data.QQEmail != "123@qq.com" {
		t.Fatalf("unexpected qq email: %#v", data.QQEmail)
	}
	if data.UpdatedAt == nil || *data.UpdatedAt != nowMs {
		t.Fatalf("unexpected updatedAt: %#v", data.UpdatedAt)
	}
	if data.EquippedAchievement == nil || data.EquippedAchievement.ID != "thief" || data.EquippedAchievement.ExpiresAt == nil {
		t.Fatalf("forced achievement should win: %#v", data.EquippedAchievement)
	}

	afterForcedExpired, err := NewService(db).GetSettings(ctx, userID, nowMs+120_000)
	if err != nil {
		t.Fatalf("get settings after forced expired failed: %v", err)
	}
	if afterForcedExpired.EquippedAchievement == nil || afterForcedExpired.EquippedAchievement.ID != "beginner" {
		t.Fatalf("equipped achievement should be used after forced expiry: %#v", afterForcedExpired.EquippedAchievement)
	}
}

func TestUpdateSettingsPatchesAndClearsCustomProfile(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(51501 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_update_user', 'Profile Update User', now(), now())`,
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

	newName := "New"
	patch := SettingsPatch{
		DisplayName: NullableStringPatch{Set: true, Value: &newName},
		QQEmail:     NullableStringPatch{Set: true},
	}
	data, err := NewService(db).UpdateSettings(ctx, userID, patch, 1700000000123)
	if err != nil {
		t.Fatalf("update settings failed: %v", err)
	}
	if data.DisplayName == nil || *data.DisplayName != "New" {
		t.Fatalf("unexpected display name: %#v", data.DisplayName)
	}
	if data.AvatarURL == nil || *data.AvatarURL != "https://example.com/old.png" {
		t.Fatalf("avatar should be preserved: %#v", data.AvatarURL)
	}
	if data.QQEmail != nil {
		t.Fatalf("qq email should be cleared: %#v", data.QQEmail)
	}
	if data.UpdatedAt == nil || *data.UpdatedAt != 1700000000123 {
		t.Fatalf("unexpected updatedAt: %#v", data.UpdatedAt)
	}

	var displayName string
	var avatarURL string
	var qqEmail sql.NullString
	var updatedAtMs int64
	if err := db.QueryRow(ctx,
		`SELECT display_name, avatar_url, qq_email, updated_at_ms
		   FROM user_profiles
		  WHERE user_id = $1`,
		userID,
	).Scan(&displayName, &avatarURL, &qqEmail, &updatedAtMs); err != nil {
		t.Fatalf("query updated profile failed: %v", err)
	}
	if displayName != "New" || avatarURL != "https://example.com/old.png" || qqEmail.Valid || updatedAtMs != 1700000000123 {
		t.Fatalf("unexpected stored profile: display=%q avatar=%q qq=%+v updated=%d", displayName, avatarURL, qqEmail, updatedAtMs)
	}
}

func TestGetSettingsReturnsEmptyDataWithoutProfileOrAchievement(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(51801 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_empty_user', 'Profile Empty User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}

	data, err := NewService(db).GetSettings(ctx, userID, time.Now().UnixMilli())
	if err != nil {
		t.Fatalf("get settings without rows failed: %v", err)
	}
	if data.DisplayName != nil || data.AvatarURL != nil || data.QQEmail != nil || data.UpdatedAt != nil || data.EquippedAchievement != nil {
		t.Fatalf("expected empty settings data, got %+v", data)
	}
}

func TestEquipAchievementPersistsAndClearsSelection(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(51901 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_equip_user', 'Profile Equip User', now(), now())`,
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
		t.Fatalf("seed grant failed: %v", err)
	}

	achievementID := "beginner"
	result, err := NewService(db).EquipAchievement(ctx, userID, &achievementID, nowMs+1)
	if err != nil {
		t.Fatalf("equip achievement failed: %v", err)
	}
	if result.EquippedID == nil || *result.EquippedID != "beginner" || result.Equipped == nil || result.Equipped.ID != "beginner" {
		t.Fatalf("unexpected equip result: %+v", result)
	}

	var storedID string
	if err := db.QueryRow(ctx,
		`SELECT achievement_id FROM user_equipped_achievements WHERE user_id = $1`,
		userID,
	).Scan(&storedID); err != nil {
		t.Fatalf("query equipped achievement failed: %v", err)
	}
	if storedID != "beginner" {
		t.Fatalf("unexpected equipped id: %s", storedID)
	}

	cleared, err := NewService(db).EquipAchievement(ctx, userID, nil, nowMs+2)
	if err != nil {
		t.Fatalf("clear equipped achievement failed: %v", err)
	}
	if cleared.EquippedID != nil || cleared.Equipped != nil {
		t.Fatalf("unexpected clear result: %+v", cleared)
	}
	var count int
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_equipped_achievements WHERE user_id = $1`,
		userID,
	).Scan(&count); err != nil {
		t.Fatalf("count equipped achievements failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("equipped achievement should be cleared, count=%d", count)
	}
}

func TestEquipAchievementRejectsLockedAndForcedAchievement(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(51951 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'profile_forced_user', 'Profile Forced User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}

	achievementID := "beginner"
	if _, err := NewService(db).EquipAchievement(ctx, userID, &achievementID, nowMs); !errors.Is(err, ErrAchievementLocked) {
		t.Fatalf("expected locked error, got %v", err)
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
		`INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms)
		 VALUES ($1, 'thief', $2, $3)`,
		userID,
		nowMs+60_000,
		nowMs,
	); err != nil {
		t.Fatalf("seed forced achievement failed: %v", err)
	}
	if _, err := NewService(db).EquipAchievement(ctx, userID, &achievementID, nowMs+1); !errors.Is(err, ErrForcedAchievementActive) {
		t.Fatalf("expected forced error, got %v", err)
	}
}

func TestGetOverviewAggregatesMigratedProfileData(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(52701 + time.Now().UnixNano()%1_000_000_000)
	cleanupProfileIntegrationUser(t, ctx, db, userID)
	defer cleanupProfileIntegrationUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'overview_user', 'Overview User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms)
		 VALUES ($1, '主页昵称', 'https://example.com/overview.png', '789@qq.com', $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed profile failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance)
		 VALUES ($1, 12000)`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $3, 1000, 'game', '游戏奖励', 11000, now() - interval '1 minute'),
		        ($2, $3, 1000, 'eco', '环保奖励', 12000, now())`,
		"overview-ledger-old-"+time.Now().Format("150405.000000000"),
		"overview-ledger-new-"+time.Now().Format("150405.000000000"),
		userID,
	); err != nil {
		t.Fatalf("seed point ledger failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, card_draws, makeup_cards)
		 VALUES ($1, 3, 2)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, score, points_earned, payload, created_at)
		 VALUES ($1, $5, 's1', 'match3', 1500, 30, '{"completed":true}'::jsonb, now() - interval '4 minutes'),
		        ($2, $5, 's2', 'whack_mole', 350, 20, '{"won":true}'::jsonb, now() - interval '3 minutes'),
		        ($3, $5, 's3', 'minesweeper', 100, 10, '{"won":true}'::jsonb, now() - interval '2 minutes'),
		        ($4, $5, 's4', 'lottery', 0, 0, '{}'::jsonb, now() - interval '1 minute')`,
		"overview-game-1-"+time.Now().Format("150405.000000000"),
		"overview-game-2-"+time.Now().Format("150405.000000000"),
		"overview-game-3-"+time.Now().Format("150405.000000000"),
		"overview-game-4-"+time.Now().Format("150405.000000000"),
		userID,
	); err != nil {
		t.Fatalf("seed game records failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, created_at_ms, read_at_ms)
		 VALUES ($1, $4, 'system', '未读通知', '内容', $5, NULL),
		        ($2, $4, 'reward', '奖励通知', '内容', $6, NULL),
		        ($3, $4, 'system', '已读通知', '内容', $7, $7)`,
		"overview-notify-1-"+time.Now().Format("150405.000000000"),
		"overview-notify-2-"+time.Now().Format("150405.000000000"),
		"overview-notify-3-"+time.Now().Format("150405.000000000"),
		userID,
		nowMs-3000,
		nowMs-2000,
		nowMs-1000,
	); err != nil {
		t.Fatalf("seed notifications failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (user_id, lifetime_cleared, lifetime_points, last_tick_at_ms, created_at_ms, updated_at_ms)
		 VALUES ($1, 10000, 5000, $2, $2, $2)`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, lifetime_claim_count)
		 VALUES ($1, 'diamond', 7),
		        ($1, 'photo', 5)`,
		userID,
	); err != nil {
		t.Fatalf("seed eco prize inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason)
		 VALUES ($1, 'small_success', 'auto', $2, $3, 'expired seed')`,
		userID,
		nowMs-120_000,
		nowMs-60_000,
	); err != nil {
		t.Fatalf("seed expired achievement failed: %v", err)
	}

	overview, err := NewService(db).GetOverview(ctx, userID, "overview_user", nowMs)
	if err != nil {
		t.Fatalf("get overview failed: %v", err)
	}
	if overview.User.CustomDisplayName == nil || *overview.User.CustomDisplayName != "主页昵称" {
		t.Fatalf("unexpected overview user: %+v", overview.User)
	}
	if overview.Points.Balance != 12000 || len(overview.Points.RecentLogs) != 2 || overview.Points.RecentLogs[0].Source != "eco" {
		t.Fatalf("unexpected overview points: %+v", overview.Points)
	}
	if overview.Cards.DrawsAvailable != 3 || len(overview.Cards.Albums) != 0 {
		t.Fatalf("unexpected overview cards: %+v", overview.Cards)
	}
	if len(overview.Gameplay.RecentRecords) != 4 || overview.AchievementStats.GameWinRate != 1 {
		t.Fatalf("unexpected gameplay summary: gameplay=%+v stats=%+v", overview.Gameplay, overview.AchievementStats)
	}
	if overview.Notifications.UnreadCount != 2 || len(overview.Notifications.Recent) != 3 {
		t.Fatalf("unexpected notifications: %+v", overview.Notifications)
	}
	if overview.AchievementStats.EcoLifetimeCleared != 10000 || overview.AchievementStats.EcoLifetimePrizeClaims != 12 || overview.AchievementStats.EcoLifetimePhotoClaims != 5 {
		t.Fatalf("unexpected eco achievement stats: %+v", overview.AchievementStats)
	}
	for _, achievementID := range []string{"beginner", "first_pot", "small_success", "tycoon", "lottery_player", "game_king", "eco_ambassador", "gold_digger", "xiaoc_fan"} {
		if !achievementUnlocked(overview.Achievements.Items, achievementID) {
			t.Fatalf("achievement %s should be unlocked: %+v", achievementID, overview.Achievements.Items)
		}
	}
	for _, grant := range overview.Achievements.Grants {
		if grant.ID == "small_success" && grant.ExpiresAt != nil {
			t.Fatalf("expired automatic small_success should be refreshed: %+v", grant)
		}
	}
	if len(overview.Achievements.Items) != len(achievementDefinitions) {
		t.Fatalf("achievement items should include all definitions: got %d want %d", len(overview.Achievements.Items), len(achievementDefinitions))
	}
}

func achievementUnlocked(items []AchievementItem, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return item.Unlocked
		}
	}
	return false
}

func cleanupProfileIntegrationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup profile user %d failed: %v", userID, err)
		}
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
