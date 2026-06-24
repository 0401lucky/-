//go:build integration

package gamesummary

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

var gameSummaryTestIDCounter int64

func TestGetProfileAggregatesPostgreSQLGameRecords(t *testing.T) {
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

	userID := int64(73001 + time.Now().UnixNano()%1_000_000_000)
	cleanupGameSummaryIntegrationUser(t, ctx, db, userID)
	defer cleanupGameSummaryIntegrationUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'game_summary_user', 'Game Summary User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at) VALUES ($1, 321, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO game_daily_stats (user_id, stat_date, games_played, total_score, points_earned, last_game_at, updated_at)
		 VALUES ($1, $2, 3, 6000, 66, now(), now())`,
		userID,
		todayChina(),
	); err != nil {
		t.Fatalf("seed daily stats failed: %v", err)
	}

	insertGameRecord(t, ctx, db, userID, "memory", "easy", 100, 10, `{"completed":true}`, 6)
	insertGameRecord(t, ctx, db, userID, "memory", "easy", 90, 9, `{"completed":true}`, 5)
	insertGameRecord(t, ctx, db, userID, "memory", "easy", 80, 8, `{"completed":false}`, 4)
	insertGameRecord(t, ctx, db, userID, "match3", "", 1300, 13, `{"score":1300}`, 3)
	insertGameRecord(t, ctx, db, userID, "whack_mole", "hard", 1400, 14, `{"score":1400}`, 2)
	insertGameRecord(t, ctx, db, userID, "roguelite", "", 9999, 99, `{"won":true}`, 1)

	data, err := NewService(db).GetProfile(ctx, auth.User{ID: userID, Username: "game_summary_user", DisplayName: "Game Summary User"})
	if err != nil {
		t.Fatalf("GetProfile failed: %v", err)
	}

	if data.Balance != 321 || data.DailyStats.GamesPlayed != 3 || data.DailyStats.PointsEarned != 66 {
		t.Fatalf("unexpected overview fields: %+v", data)
	}
	if data.TotalGamesPlayed != 6 || data.PeakScore != 9999 || data.PeakGame == nil || *data.PeakGame != "roguelite" {
		t.Fatalf("unexpected profile summary: %+v", data)
	}
	if data.FavoriteGame == nil || *data.FavoriteGame != "memory" {
		t.Fatalf("expected favorite game memory, got %+v", data.FavoriteGame)
	}
	if data.MostWinsGame == nil || *data.MostWinsGame != "memory" || data.MostWinsCount != 2 {
		t.Fatalf("unexpected most wins: game=%+v count=%d", data.MostWinsGame, data.MostWinsCount)
	}
	if data.BestStreakGame == nil || *data.BestStreakGame != "memory" || data.BestStreak != 2 {
		t.Fatalf("unexpected best streak: game=%+v streak=%d", data.BestStreakGame, data.BestStreak)
	}
	if data.PerGame["whack-mole"].Wins != 0 || data.PerGame["match3"].Wins != 1 {
		t.Fatalf("unexpected per-game wins: %+v", data.PerGame)
	}
}

func insertGameRecord(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, gameType string, difficulty string, score int64, pointsEarned int64, payload string, minutesAgo int) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() - ($9::int * interval '1 minute'))`,
		randomTestID(),
		userID,
		randomTestID(),
		gameType,
		difficulty,
		score,
		pointsEarned,
		payload,
		minutesAgo,
	); err != nil {
		t.Fatalf("seed game record failed: %v", err)
	}
}

func cleanupGameSummaryIntegrationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM game_records WHERE user_id = $1`,
		`DELETE FROM game_daily_stats WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup failed: %v", err)
		}
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve caller")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}

func randomTestID() string {
	return fmt.Sprintf("%s-%d", time.Now().Format("20060102150405.000000000"), atomic.AddInt64(&gameSummaryTestIDCounter, 1))
}
