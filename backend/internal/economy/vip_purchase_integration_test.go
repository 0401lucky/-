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

	// 资金底账：两次购买各留下一条 source='vip_purchase' 的流水，
	// 金额为负、balance_after 与两次返回的余额一致。
	ledgerRows, err := service.db.Query(ctx,
		`SELECT amount, balance_after FROM point_ledger
		 WHERE user_id = $1 AND source = $2
		 ORDER BY created_at, id`,
		user.ID, SourceVIPPurchase,
	)
	if err != nil {
		t.Fatalf("query point_ledger failed: %v", err)
	}
	defer ledgerRows.Close()

	var amounts, balancesAfter []int64
	for ledgerRows.Next() {
		var amount, balanceAfter int64
		if err := ledgerRows.Scan(&amount, &balanceAfter); err != nil {
			t.Fatalf("scan point_ledger failed: %v", err)
		}
		amounts = append(amounts, amount)
		balancesAfter = append(balancesAfter, balanceAfter)
	}
	if err := ledgerRows.Err(); err != nil {
		t.Fatalf("iterate point_ledger failed: %v", err)
	}
	if len(amounts) != 2 {
		t.Fatalf("point_ledger %s rows = %d, want 2", SourceVIPPurchase, len(amounts))
	}
	if amounts[0] != -3000 || amounts[1] != -3000 {
		t.Fatalf("point_ledger amounts = %v, want [-3000 -3000]", amounts)
	}
	if balancesAfter[0] != 7000 || balancesAfter[1] != 4000 {
		t.Fatalf("point_ledger balance_after = %v, want [7000 4000]", balancesAfter)
	}

	// 审计明细：vip_purchases 两行的内容。首购无会籍故 expires_at_before 为 NULL，
	// 二购的 expires_at_before 必须等于首购落库的 expires_at_after —— 这一条把
	// 「累加的起算点」钉死在库里。
	purchaseRows, err := service.db.Query(ctx,
		`SELECT points_cost, days, expires_at_before, expires_at_after
		 FROM vip_purchases
		 WHERE user_id = $1
		 ORDER BY created_at, id`,
		user.ID,
	)
	if err != nil {
		t.Fatalf("query vip_purchases failed: %v", err)
	}
	defer purchaseRows.Close()

	type vipPurchaseRow struct {
		pointsCost      int64
		days            int64
		expiresAtBefore *time.Time
		expiresAtAfter  time.Time
	}
	var purchases []vipPurchaseRow
	for purchaseRows.Next() {
		var row vipPurchaseRow
		if err := purchaseRows.Scan(&row.pointsCost, &row.days, &row.expiresAtBefore, &row.expiresAtAfter); err != nil {
			t.Fatalf("scan vip_purchases failed: %v", err)
		}
		purchases = append(purchases, row)
	}
	if err := purchaseRows.Err(); err != nil {
		t.Fatalf("iterate vip_purchases failed: %v", err)
	}
	if len(purchases) != 2 {
		t.Fatalf("vip_purchases rows = %d, want 2", len(purchases))
	}
	for index, row := range purchases {
		if row.pointsCost != 3000 || row.days != 30 {
			t.Fatalf("vip_purchases[%d] points_cost=%d days=%d, want 3000/30", index, row.pointsCost, row.days)
		}
	}
	if purchases[0].expiresAtBefore != nil {
		t.Fatalf("first purchase expires_at_before = %v, want NULL", *purchases[0].expiresAtBefore)
	}
	if purchases[1].expiresAtBefore == nil {
		t.Fatal("second purchase expires_at_before must record the first purchase's result, got NULL")
	}
	if !purchases[1].expiresAtBefore.Equal(purchases[0].expiresAtAfter) {
		t.Fatalf("second purchase expires_at_before = %v, want first expires_at_after %v",
			*purchases[1].expiresAtBefore, purchases[0].expiresAtAfter)
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

// TestPurchaseVIPAllowsPurchaseJustBelowCeiling 覆盖「距上限还差一天时仍可购买」。
// 严格等号边界（335 + 30 = 365）由单元测试 TestVIPPurchaseWindowAllowsExactCeiling
// 用确定性时钟覆盖；这里保守地留出一天，避开应用进程与数据库服务器之间可能的时钟偏差。
func TestPurchaseVIPAllowsPurchaseJustBelowCeiling(t *testing.T) {
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

	// 20 笔并发、各自幂等键不同的合法购买。per-user 行锁把它们串行化，
	// 每笔都基于前一笔的结果重新判定，累计剩余时长不得突破 365 天上限。
	var successes, ceilingRejections atomic.Int64
	runConcurrent(20, func(index int) {
		result, err := service.PurchaseVIP(ctx, user, randomID())
		if err != nil {
			t.Errorf("purchase %d returned error: %v", index, err)
			return
		}
		switch {
		case result.Success:
			successes.Add(1)
		case result.Code == CodeVIPMaxDurationReached:
			ceilingRejections.Add(1)
		default:
			t.Errorf("purchase %d ended with an unexpected outcome: %+v", index, result)
		}
	})

	// 每笔要么成功、要么因触顶被拒，不存在第三种结局（余额 100000 足够 33 笔）
	succeeded := successes.Load()
	if total := succeeded + ceilingRejections.Load(); total != 20 {
		t.Fatalf("successes + ceiling rejections = %d, want 20 (successes=%d rejections=%d)",
			total, succeeded, ceilingRejections.Load())
	}
	// 成功笔数随并发时序波动，故只断言不变量：至少放行一笔，且成功笔数 × 30 天不越上限
	if succeeded < 1 {
		t.Fatalf("expected at least one successful purchase, got %d", succeeded)
	}
	if days := succeeded * 30; days > 365 {
		t.Fatalf("%d successful purchases add %d days, breaking the 365-day ceiling", succeeded, days)
	}

	expiry, ok, err := vip.GetExpiry(ctx, service.db, user.ID)
	if err != nil || !ok {
		t.Fatalf("read expiry failed: ok=%v err=%v", ok, err)
	}
	ceiling := time.Now().Add(365 * 24 * time.Hour)
	if expiry.After(ceiling) {
		t.Fatalf("concurrent purchases broke the ceiling: expiry=%v ceiling=%v", expiry, ceiling)
	}
}
