//go:build integration

package profile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"redemption/backend/internal/achievement"
	"redemption/backend/internal/auth"
	"redemption/backend/internal/cards"
	"redemption/backend/internal/gamesummary"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestOverviewBackfillsAndPersistsMissingAchievements(t *testing.T) {
	db, userID := newOverviewTestUser(t)
	ctx := context.Background()
	now := time.Date(2026, 9, 8, 16, 30, 0, 0, time.UTC)
	nowMs := now.UnixMilli()
	service := NewService(db)

	execOverviewFixture(t, db, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 500)`, userID)
	execOverviewFixture(t, db, `INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after)
	 VALUES ($1, $2, 12000, 'game', 'historical milestone', 12000)`, fmt.Sprintf("achievement-points-%d", userID), userID)
	// An old 30-day streak, including makeup check-ins, must survive a later break.
	execOverviewFixture(t, db, `INSERT INTO checkin_records (user_id, checkin_date, source)
	 SELECT $1, day::date, CASE WHEN day::date = '2026-07-15'::date THEN 'makeup' ELSE 'daily' END
	 FROM generate_series('2026-07-01'::date, '2026-07-30'::date, interval '1 day') day`, userID)

	inventory := []string{}
	for _, card := range cards.AllCards() {
		inventory = append(inventory, card.ID)
	}
	rawInventory, err := json.Marshal(inventory)
	if err != nil {
		t.Fatal(err)
	}
	execOverviewFixture(t, db, `INSERT INTO card_user_states (user_id, inventory, fragments, draws_available)
	 VALUES ($1, $2::jsonb, 123, 4)`, userID, string(rawInventory))
	execOverviewFixture(t, db, `INSERT INTO user_assets (user_id, card_draws) VALUES ($1, 99)`, userID)
	seedOverviewLands(t, db, userID, 7, nowMs)

	// Both storage tables contain each modern spin. Mirrors must not double counts.
	execOverviewFixture(t, db, `INSERT INTO lottery_records
	 (id, user_id, username, tier_id, tier_name, tier_value, created_at_ms)
	 SELECT 'achievement-lottery-' || $1::bigint::text || '-' || n, $1::bigint, 'achievement_user',
	        CASE WHEN n <= 99 THEN 'pts_200' ELSE 'pts_0' END, 'renamed tier', 0, $2
	 FROM generate_series(1, 198) n`, userID, nowMs-100000)
	execOverviewFixture(t, db, `INSERT INTO game_records
	 (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
	 SELECT 'game_' || id, user_id, id, 'lottery', tier_id, 0, 0,
	        jsonb_build_object('lotteryRecordId', id, 'tierId', tier_id), '2026-01-01'::timestamptz
	 FROM lottery_records WHERE user_id = $1`, userID)
	below, err := service.overviewAchievementStats(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if below.FarmUnlockedLands != 7 || below.LotteryPlays != 198 || below.LotteryOrangeCount != 99 || below.LotteryHeartCount != 99 {
		t.Fatalf("unexpected below-threshold stats: %+v", below)
	}
	for _, id := range []string{"farm_owner", "lucky_star", "unlucky_star"} {
		if automaticAchievementIDs(OverviewData{AchievementStats: below})[id] {
			t.Fatalf("%s must remain locked below threshold", id)
		}
	}
	seedOverviewLands(t, db, userID, 8, nowMs)
	// Preserve older game-only lottery records, including the legacy name format.
	execOverviewFixture(t, db, `INSERT INTO game_records (id, user_id, session_id, game_type, score, points_earned, payload, created_at)
	 VALUES ($1, $3, $1, 'lottery', 0, 0, '{"tierId":"pts_200"}', '2026-01-02'::timestamptz),
	        ($2, $3, $2, 'lottery', 0, 0, '{"tierName":"谢谢惠顾"}', '2026-01-02'::timestamptz)`,
		fmt.Sprintf("achievement-old-orange-%d", userID), fmt.Sprintf("achievement-old-heart-%d", userID), userID)

	execOverviewFixture(t, db, `INSERT INTO eco_states (user_id, lifetime_cleared, last_tick_at_ms, created_at_ms, updated_at_ms)
	 VALUES ($1, 10000, $2, $2, $2)`, userID, nowMs)
	execOverviewFixture(t, db, `INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, lifetime_claim_count)
	 VALUES ($1, 'photo', 0, 5), ($1, 'diamond', 0, 5)`, userID)
	execOverviewFixture(t, db, `INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, expires_at_ms)
	 VALUES ($1, 'contributor', 'admin', $2, NULL),
	        ($1, 'peak_first', 'ranking_monthly', $2, $3),
	        ($1, 'thief', 'auto', $2, $3)`, userID, nowMs-2000, nowMs-1000)

	games := []struct {
		kind, difficulty, payload string
		score                     int64
	}{
		{"memory", "normal", `{"completed":true}`, 10},
		{"linkgame", "normal", `{"completed":true}`, 10},
		{"minesweeper", "normal", `{"won":true}`, 10},
		{"roguelite", "", `{"won":true}`, 10},
		{"game_2048", "", `{}`, 20000},
		{"whack_mole", "hard", `{}`, 1500},
		{"lucky_td", "training_field", `{"won":true}`, 600},
		{"piano_tiles", "classic", `{"mode":"classic","crowns":1}`, 10},
		{"match3", "", `{}`, 1200},
		{"memory", "normal", `{"completed":false}`, 0},
		{"memory", "normal", `{"completed":false}`, 0},
		{"memory", "normal", `{"completed":false}`, 0},
	}
	for index, game := range games {
		execOverviewFixture(t, db, `INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $1, $3, $4, $5, 0, $6::jsonb, $7)`, fmt.Sprintf("achievement-game-%d-%d", userID, index), userID,
			game.kind, game.difficulty, game.score, game.payload, now)
	}
	execOverviewFixture(t, db, `INSERT INTO game_records (id, user_id, session_id, game_type, score, points_earned, payload, created_at)
	 VALUES ($1, $2, $1, 'memory', 10000, 0, '{"pending":true,"completed":true}', $3)`, fmt.Sprintf("achievement-pending-%d", userID), userID, now.Add(time.Second))

	overview, err := service.GetOverview(ctx, userID, "achievement_user", nowMs)
	if err != nil {
		t.Fatal(err)
	}
	if overview.Cards.Owned != 163 || overview.Cards.CompletionRate != 100 || overview.Cards.Fragments != 123 || overview.Cards.DrawsAvailable != 4 {
		t.Fatalf("profile must read the live card inventory: %+v", overview.Cards)
	}
	if overview.Gameplay.TotalCheckinDays != 30 || overview.Gameplay.CheckinStreak != 0 || overview.AchievementStats.CheckinMaxStreak != 30 {
		t.Fatalf("historical streak was lost: gameplay=%+v stats=%+v", overview.Gameplay, overview.AchievementStats)
	}
	if overview.AchievementStats.LotteryPlays != 200 || overview.AchievementStats.LotteryOrangeCount != 100 || overview.AchievementStats.LotteryHeartCount != 100 {
		t.Fatalf("unexpected lifetime lottery counts: %+v", overview.AchievementStats)
	}
	for _, record := range overview.Gameplay.RecentRecords {
		if record.GameType == "lottery" || record.Score == 10000 {
			t.Fatalf("lottery history must not depend on recent records; pending games must be hidden: %+v", record)
		}
	}
	gameCenter, err := gamesummary.NewService(db).GetProfile(ctx, auth.User{ID: userID, Username: "achievement_user"})
	if err != nil {
		t.Fatal(err)
	}
	if overview.AchievementStats.GameWinRate != 0.75 || overview.AchievementStats.GameWinPlays != 12 || overview.AchievementStats.GameWinRate != gameCenter.WinRate {
		t.Fatalf("profile and game center must agree: stats=%+v gameCenter=%+v", overview.AchievementStats, gameCenter)
	}
	wantAuto := []string{"beginner", "first_checkin", "checkin_3", "checkin_7", "checkin_30", "first_pot", "small_success", "tycoon",
		"card_beginner", "card_collector", "collection_master", "lottery_player", "game_king", "farm_owner", "lucky_star", "unlucky_star",
		"eco_ambassador", "gold_digger", "xiaoc_fan"}
	for _, id := range append(wantAuto, "contributor") {
		if !achievementUnlocked(overview.Achievements.Items, id) {
			t.Fatalf("missing eligible achievement %s", id)
		}
	}
	for _, id := range []string{"peak_first", "thief"} {
		if achievementUnlocked(overview.Achievements.Items, id) {
			t.Fatalf("expired special achievement %s must not be reissued", id)
		}
	}
	for _, grant := range overview.Achievements.Grants {
		if grant.Source == "auto" && grant.ID != "thief" && (grant.ExpiresAt != nil || grant.GrantedAt != nowMs) {
			t.Fatalf("automatic grant must be persisted permanently: %+v", grant)
		}
	}
	farmID := "farm_owner"
	if equipped, err := service.EquipAchievement(ctx, userID, &farmID, nowMs); err != nil || equipped.EquippedID == nil || *equipped.EquippedID != farmID {
		t.Fatalf("backfilled achievement should be equippable: %+v, %v", equipped, err)
	}

	// Lower current progress to verify persisted awards and unchanged grant times.
	seedOverviewLands(t, db, userID, 4, nowMs+1)
	execOverviewFixture(t, db, `UPDATE card_user_states SET inventory = '[]' WHERE user_id = $1`, userID)
	execOverviewFixture(t, db, `UPDATE point_accounts SET balance = 0 WHERE user_id = $1`, userID)
	execOverviewFixture(t, db, `INSERT INTO game_records (id, user_id, session_id, game_type, score, points_earned, payload, created_at)
	 SELECT 'achievement-loss-' || $1::bigint::text || '-' || n, $1::bigint,
	        'achievement-loss-' || $1::bigint::text || '-' || n, 'memory', 0, 0, '{"completed":false}'::jsonb, $2
	 FROM generate_series(1, 50) n`, userID, now.Add(time.Second))
	repeated, err := service.GetOverview(ctx, userID, "achievement_user", nowMs+1000)
	if err != nil {
		t.Fatal(err)
	}
	if repeated.AchievementStats.GameWinRate >= 0.75 || repeated.Cards.Owned != 0 || repeated.AchievementStats.FarmUnlockedLands != 4 {
		t.Fatal("test progress was not lowered")
	}
	for _, id := range wantAuto {
		if !achievementUnlocked(repeated.Achievements.Items, id) {
			t.Fatalf("previously granted achievement %s was lost", id)
		}
	}
	if len(repeated.Achievements.Grants) != len(overview.Achievements.Grants) {
		t.Fatal("repeat overview duplicated achievement grants")
	}
	for index, grant := range repeated.Achievements.Grants {
		if grant.ID != overview.Achievements.Grants[index].ID || grant.GrantedAt != overview.Achievements.Grants[index].GrantedAt {
			t.Fatalf("repeat overview rewrote the original grant: %+v", grant)
		}
	}
}

func TestOverviewCheckinsUseChinaCalendarAndAllHistory(t *testing.T) {
	db, userID := newOverviewTestUser(t)
	now := time.Date(2026, 9, 8, 16, 30, 0, 0, time.UTC) // September 9 in China.
	tests := []struct {
		name                    string
		offsets                 []int
		total, current, longest int64
	}{
		{"empty", nil, 0, 0, 0},
		{"today", []int{-2, -1, 0}, 3, 3, 3},
		{"today_not_yet_signed", []int{-3, -2, -1}, 3, 3, 3},
		{"broken_streak", []int{-4, -3, -2}, 3, 0, 3},
		{"future_excluded", []int{-2, -1, 0, 1}, 3, 3, 3},
		{"makeup_connects_streak", []int{-3, -2, -1, 0}, 4, 4, 4},
	}
	longHistory := make([]int, 401)
	for index := range longHistory {
		longHistory[index] = index - 400
	}
	tests = append(tests, struct {
		name                    string
		offsets                 []int
		total, current, longest int64
	}{"over_one_year", longHistory, 401, 401, 401})
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			execOverviewFixture(t, db, `DELETE FROM checkin_records WHERE user_id = $1`, userID)
			for _, offset := range tt.offsets {
				execOverviewFixture(t, db, `INSERT INTO checkin_records (user_id, checkin_date, source)
				 VALUES ($1, '2026-09-09'::date + $2::int, CASE WHEN $2::int = -1 THEN 'makeup' ELSE 'daily' END)`, userID, offset)
			}
			stats, err := NewService(db).overviewCheckins(context.Background(), userID, now.UnixMilli())
			if err != nil {
				t.Fatal(err)
			}
			if stats.TotalDays != tt.total || stats.CurrentStreak != tt.current || stats.MaxStreak != tt.longest {
				t.Fatalf("unexpected check-in summary: %+v", stats)
			}
		})
	}
}

func TestOverviewWealthAchievementsRecoverBalanceBeforeFirstRetainedDebit(t *testing.T) {
	db, userID := newOverviewTestUser(t)
	execOverviewFixture(t, db, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 500)`, userID)
	execOverviewFixture(t, db, `INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after)
	 VALUES ($1, $2, -11500, 'exchange', 'first retained debit', 500)`, fmt.Sprintf("achievement-debit-%d", userID), userID)

	overview, err := NewService(db).GetOverview(context.Background(), userID, "achievement_user", time.Now().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if overview.Points.Balance != 500 || overview.AchievementStats.PeakPointsBalance != 12000 {
		t.Fatalf("the first retained expense still proves the previous balance: %+v", overview.AchievementStats)
	}
	for _, id := range []string{"first_pot", "small_success", "tycoon"} {
		if !achievementUnlocked(overview.Achievements.Items, id) {
			t.Fatalf("missing historical wealth achievement %s", id)
		}
	}
}

func TestForcedAchievementSwitchDoesNotInheritPreviousDuration(t *testing.T) {
	db, userID := newOverviewTestUser(t)
	ctx := context.Background()
	nowMs := time.Now().UnixMilli()
	peakUntil := nowMs + (30 * 24 * time.Hour).Milliseconds()
	thiefUntil := nowMs + (10 * time.Hour).Milliseconds()
	execOverviewFixture(t, db, `INSERT INTO user_achievement_grants
	 (user_id, achievement_id, source, granted_at_ms, expires_at_ms)
	 VALUES ($1, 'peak_first', 'ranking_monthly', $2, $3)`, userID, nowMs, peakUntil)
	execOverviewFixture(t, db, `INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms)
	 VALUES ($1, 'peak_first', $2, $3)`, userID, peakUntil, nowMs)

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })
	if err := achievement.GrantAndForceEquip(ctx, tx, userID, achievement.IDThief, nowMs, thiefUntil, "caught"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var forcedUntil int64
	if err := db.QueryRow(ctx, `SELECT until_ms FROM user_forced_achievements WHERE user_id = $1`, userID).Scan(&forcedUntil); err != nil {
		t.Fatal(err)
	}
	if forcedUntil != thiefUntil {
		t.Fatalf("thief must keep its 10-hour duration instead of the previous monthly award: got %d want %d", forcedUntil, thiefUntil)
	}

	service := NewService(db)
	peakID := "peak_first"
	if _, err := service.EquipAchievement(ctx, userID, &peakID, thiefUntil-1); !errors.Is(err, ErrForcedAchievementActive) {
		t.Fatalf("an active forced achievement must still block changes: %v", err)
	}
	if _, err := service.EquipAchievement(ctx, userID, &peakID, thiefUntil); err != nil {
		t.Fatalf("the valid monthly award should be equippable after thief expires: %v", err)
	}

	// Existing rows with an overstated forced deadline must not keep users locked out.
	execOverviewFixture(t, db, `UPDATE user_forced_achievements SET until_ms = $2 WHERE user_id = $1`, userID, peakUntil)
	if _, err := service.EquipAchievement(ctx, userID, &peakID, thiefUntil); err != nil {
		t.Fatalf("an expired grant must not enforce a stale forced deadline: %v", err)
	}
}

func newOverviewTestUser(t *testing.T) (*pgxpool.Pool, int64) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}
	ctx := context.Background()
	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatal(err)
	}
	userID := int64(63000 + time.Now().UnixNano()%1_000_000_000)
	t.Cleanup(func() { cleanupProfileIntegrationUser(t, ctx, db, userID) })
	execOverviewFixture(t, db, `INSERT INTO users (id, username) VALUES ($1, 'achievement_user')`, userID)
	return db, userID
}

func execOverviewFixture(t *testing.T, db *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func seedOverviewLands(t *testing.T, db *pgxpool.Pool, userID int64, unlocked int, nowMs int64) {
	t.Helper()
	execOverviewFixture(t, db, `INSERT INTO farm_states (user_id, state_json, updated_at_ms)
	 SELECT $1, jsonb_build_object('lands', jsonb_agg(jsonb_build_object('index', n, 'status',
	   CASE WHEN n > $3::int THEN 'locked'
	        ELSE (ARRAY['empty','growing','thirsty','mature','withered','eaten','empty','empty'])[n] END))), $2
	 FROM generate_series(1, 8) n
	 ON CONFLICT (user_id) DO UPDATE SET state_json = excluded.state_json, updated_at_ms = excluded.updated_at_ms`, userID, nowMs, unlocked)
}
