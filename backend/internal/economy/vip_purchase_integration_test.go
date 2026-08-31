//go:build integration

package economy

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/vip"
)

func TestPurchaseVIPRejectsInsufficientBalance(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil {
		t.Fatalf("purchase returned error: %v", err)
	}
	if result.Success || result.Code != CodeInsufficientPoints {
		t.Fatalf("expected insufficient points, got %+v", result)
	}

	if _, ok, err := vip.GetExpiry(ctx, service.db, user.ID); err != nil || ok {
		t.Fatalf("failed purchase must not create membership, ok=%v err=%v", ok, err)
	}
}

func TestPurchaseVIPAccumulatesDuration(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	first, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !first.Success {
		t.Fatalf("first purchase failed: result=%+v err=%v", first, err)
	}
	if first.DaysAdded != 30 || first.PointsSpent != 3000 || first.Balance != 7000 {
		t.Fatalf("unexpected first purchase result: %+v", first)
	}

	second, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !second.Success {
		t.Fatalf("second purchase failed: result=%+v err=%v", second, err)
	}
	if second.Balance != 4000 {
		t.Fatalf("second purchase balance = %d, want 4000", second.Balance)
	}

	// 时长累加：第二次到期时间 = 第一次到期时间 + 30 天
	gap := second.ExpiresAt - first.ExpiresAt
	wantGap := (30 * 24 * time.Hour).Milliseconds()
	if gap != wantGap {
		t.Fatalf("expiry gap = %d ms, want %d ms", gap, wantGap)
	}

	var purchaseCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM vip_purchases WHERE user_id = $1`, user.ID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("count purchases failed: %v", err)
	}
	if purchaseCount != 2 {
		t.Fatalf("vip_purchases rows = %d, want 2", purchaseCount)
	}
}

func TestPurchaseVIPRejectsOverMaxTotalDaysWithoutSideEffects(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// 直接把会籍推到距上限不足一个月卡的位置：剩余 350 天 + 30 天 > 365 天
	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		user.ID, user.Username,
	); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (350 * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at`,
		user.ID,
	); err != nil {
		t.Fatalf("seed near-ceiling membership failed: %v", err)
	}

	balanceBefore, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	expiryBefore, _, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil {
		t.Fatalf("read expiry failed: %v", err)
	}

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil {
		t.Fatalf("purchase returned error: %v", err)
	}
	if result.Success || result.Code != CodeVIPMaxDurationReached {
		t.Fatalf("expected max-duration rejection, got %+v", result)
	}

	// 校验先于扣分，必须零副作用
	balanceAfter, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if balanceAfter.Balance != balanceBefore.Balance {
		t.Fatalf("balance changed on rejected purchase: %d -> %d", balanceBefore.Balance, balanceAfter.Balance)
	}
	expiryAfter, _, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil {
		t.Fatalf("read expiry failed: %v", err)
	}
	if !expiryAfter.Equal(expiryBefore) {
		t.Fatalf("expiry changed on rejected purchase: %v -> %v", expiryBefore, expiryAfter)
	}
}

func TestPurchaseVIPAllowsExactCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	if _, err := service.db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		user.ID, user.Username,
	); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	// 剩余略少于 335 天，+30 天后刚好不超过 365 天上限
	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + (334 * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at`,
		user.ID,
	); err != nil {
		t.Fatalf("seed membership failed: %v", err)
	}

	result, err := service.PurchaseVIP(ctx, user, randomID())
	if err != nil || !result.Success {
		t.Fatalf("purchase at exact ceiling should succeed: result=%+v err=%v", result, err)
	}
}

func TestPurchaseVIPIdempotencyKeyDeductsOnce(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	key := "same-key-" + randomID()
	var successes atomic.Int64
	runConcurrent(20, func(index int) {
		result, err := service.PurchaseVIP(ctx, user, key)
		if err != nil {
			t.Errorf("purchase %d returned error: %v", index, err)
			return
		}
		if result.Success {
			successes.Add(1)
		}
	})

	if successes.Load() != 20 {
		t.Fatalf("all duplicate-idempotency calls should replay success, got %d", successes.Load())
	}

	summary, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if summary.Balance != 7000 {
		t.Fatalf("expected exactly one 3000-point deduction, got balance %d", summary.Balance)
	}

	var purchaseCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT count(*) FROM vip_purchases WHERE user_id = $1`, user.ID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("count purchases failed: %v", err)
	}
	if purchaseCount != 1 {
		t.Fatalf("vip_purchases rows = %d, want 1", purchaseCount)
	}
}

func TestPurchaseVIPConcurrentDistinctKeysRespectCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100000)

	// 20 笔并发、各自幂等键不同的合法购买。行锁把它们串行化，
	// 每笔都基于前一笔的结果重新判定，累计剩余时长不得突破 365 天上限。
	runConcurrent(20, func(index int) {
		if _, err := service.PurchaseVIP(ctx, user, randomID()); err != nil {
			t.Errorf("purchase %d returned error: %v", index, err)
		}
	})

	expiry, ok, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil || !ok {
		t.Fatalf("read expiry failed: ok=%v err=%v", ok, err)
	}
	ceiling := time.Now().Add(365 * 24 * time.Hour)
	if expiry.After(ceiling) {
		t.Fatalf("concurrent purchases broke the ceiling: expiry=%v ceiling=%v", expiry, ceiling)
	}
}
