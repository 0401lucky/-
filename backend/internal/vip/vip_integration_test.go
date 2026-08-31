//go:build integration

package vip

import (
	"context"
	"os"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newVIPTestDB(t *testing.T, ctx context.Context) (*pgxpool.Pool, int64) {
	t.Helper()

	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 VIP 集成测试")
	}
	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(88801 + time.Now().UnixNano()%1_000_000_000)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'vip_user', 'VIP User', now(), now())`,
		userID,
	); err != nil {
		db.Close()
		t.Fatalf("seed user failed: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM vip_memberships WHERE user_id = $1`, userID)
		_, _ = db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		db.Close()
	})
	return db, userID
}

func TestGetReturnsZeroStatusWhenNeverPurchased(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if status.Active || status.ExpiresAt != nil {
		t.Fatalf("expected zero status, got %+v", status)
	}

	if _, ok, err := GetExpiry(ctx, db, userID); err != nil || ok {
		t.Fatalf("expected no membership, ok=%v err=%v", ok, err)
	}
}

func TestExtendAccumulatesFromExistingExpiry(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	now := time.Now()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}
	first, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("first extend failed: %v", err)
	}
	// 未过期时从原到期时间累加
	second, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("second extend failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit failed: %v", err)
	}

	wantFirst := now.Add(30 * 24 * time.Hour)
	if first.Sub(wantFirst).Abs() > time.Millisecond {
		t.Fatalf("first expiry = %v, want %v", first, wantFirst)
	}
	wantSecond := first.Add(30 * 24 * time.Hour)
	if second.Sub(wantSecond).Abs() > time.Millisecond {
		t.Fatalf("second expiry = %v, want %v", second, wantSecond)
	}

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if !status.Active || status.ExpiresAt == nil {
		t.Fatalf("expected active membership, got %+v", status)
	}
}

func TestExtendRestartsFromNowWhenExpired(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	past := time.Now().Add(-100 * 24 * time.Hour)
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2, now(), now())`,
		userID, past,
	); err != nil {
		t.Fatalf("seed expired membership failed: %v", err)
	}

	// 已过期时应从当前时间重新起算，而不是从 100 天前累加
	now := time.Now()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin failed: %v", err)
	}
	got, err := Extend(ctx, tx, userID, 30, now)
	if err != nil {
		t.Fatalf("extend failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit failed: %v", err)
	}

	want := now.Add(30 * 24 * time.Hour)
	if got.Sub(want).Abs() > time.Millisecond {
		t.Fatalf("expiry = %v, want %v", got, want)
	}
}

func TestGetReportsInactiveForExpiredMembership(t *testing.T) {
	ctx := context.Background()
	db, userID := newVIPTestDB(t, ctx)

	past := time.Now().Add(-1 * time.Hour)
	if _, err := db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2, now(), now())`,
		userID, past,
	); err != nil {
		t.Fatalf("seed expired membership failed: %v", err)
	}

	status, err := Get(ctx, db, userID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	// 到期不删行：ExpiresAt 仍有值，但 Active 为 false
	if status.Active {
		t.Fatalf("expected inactive membership, got %+v", status)
	}
	if status.ExpiresAt == nil {
		t.Fatalf("expected expiry timestamp to be retained, got %+v", status)
	}
}
