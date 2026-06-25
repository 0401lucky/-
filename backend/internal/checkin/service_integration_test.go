//go:build integration

package checkin

import (
	"context"
	"os"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceCheckinAndMakeupUsePostgresTransaction(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过签到集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	user := auth.User{ID: 997301, Username: "checkin_service_user", DisplayName: "Checkin Service"}
	cleanupCheckinState(t, ctx, db, user.ID)
	defer cleanupCheckinState(t, ctx, db, user.ID)

	service := NewServiceWithNow(db, func() time.Time {
		return time.Date(2026, 6, 24, 20, 0, 0, 0, time.UTC) // 中国时区 2026-06-25 周四
	})

	if _, err := service.Snapshot(ctx, user); err != nil {
		t.Fatalf("snapshot should initialize user state: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO checkin_records (user_id, checkin_date, source, points_awarded, extra_spins_awarded, week_broken)
		 VALUES ($1, '2026-06-22', 'daily', 50, 1, false),
		        ($1, '2026-06-23', 'daily', 50, 1, false)`,
		user.ID,
	); err != nil {
		t.Fatalf("seed checkin history failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`UPDATE user_assets SET makeup_cards = 1, updated_at = now() WHERE user_id = $1`,
		user.ID,
	); err != nil {
		t.Fatalf("seed makeup cards failed: %v", err)
	}

	result, err := service.Checkin(ctx, user)
	if err != nil {
		t.Fatalf("checkin failed: %v", err)
	}
	if !result.Success || result.PointsAwarded != 50 || !result.WeekBroken || result.ExtraSpinsAwarded != 1 || result.PointsBalance != 50 {
		t.Fatalf("unexpected checkin result: %+v", result)
	}

	duplicate, err := service.Checkin(ctx, user)
	if err != nil {
		t.Fatalf("duplicate checkin failed: %v", err)
	}
	if duplicate.Success || duplicate.Message != "今天已经签到过了" {
		t.Fatalf("unexpected duplicate result: %+v", duplicate)
	}

	makeup, err := service.Makeup(ctx, user, "2026-06-24")
	if err != nil {
		t.Fatalf("makeup failed: %v", err)
	}
	if !makeup.Success || makeup.PointsAwarded != 50 || makeup.ExtraSpinsAwarded != 1 || makeup.MakeupCards != 0 || makeup.PointsBalance != 100 {
		t.Fatalf("unexpected makeup result: %+v", makeup)
	}
	if len(makeup.StillMissing) != 0 {
		t.Fatalf("expected no missing days after makeup, got %+v", makeup.StillMissing)
	}

	var balance int64
	var extraSpins int64
	var makeupCards int64
	var recordCount int64
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance, a.extra_spins, a.makeup_cards,
		        (SELECT count(*) FROM checkin_records WHERE user_id = $1),
		        (SELECT count(*) FROM point_ledger WHERE user_id = $1 AND source = 'checkin_bonus')
		   FROM point_accounts p
		   JOIN user_assets a ON a.user_id = p.user_id
		  WHERE p.user_id = $1`,
		user.ID,
	).Scan(&balance, &extraSpins, &makeupCards, &recordCount, &ledgerCount); err != nil {
		t.Fatalf("query final state failed: %v", err)
	}
	if balance != 100 || extraSpins != 2 || makeupCards != 0 || recordCount != 4 || ledgerCount != 2 {
		t.Fatalf("unexpected final state balance=%d extra=%d makeup=%d records=%d ledger=%d", balance, extraSpins, makeupCards, recordCount, ledgerCount)
	}
}

func cleanupCheckinState(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	for _, query := range []string{
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM checkin_records WHERE user_id = $1`,
		`DELETE FROM user_assets WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	} {
		_, _ = db.Exec(ctx, query, userID)
	}
}
