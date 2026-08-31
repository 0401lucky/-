//go:build integration

package economy

import (
	"context"
	"testing"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/platform/newapi"
)

func TestWithdrawRejectsAfterDailyLimitWithoutSideEffects(t *testing.T) {
	ctx := context.Background()
	quotaClient := &fakeWalletQuotaClient{}
	service, cleanup := newWalletIntegrationService(t, ctx, quotaClient)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// 默认上限 4 次
	for index := 0; index < 4; index++ {
		result, err := service.ExecuteWithdraw(ctx, user, 100)
		if err != nil {
			t.Fatalf("withdraw %d failed: %v", index, err)
		}
		if !result.Success {
			t.Fatalf("withdraw %d should succeed, got %+v", index, result)
		}
		if result.DailyWithdrawUsed != int64(index+1) || result.DailyWithdrawLimit != 4 {
			t.Fatalf("withdraw %d usage = %d/%d, want %d/4", index, result.DailyWithdrawUsed, result.DailyWithdrawLimit, index+1)
		}
	}

	balanceBefore, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	creditCallsBefore := len(quotaClient.creditCalls)

	result, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("fifth withdraw returned error: %v", err)
	}
	if result.Success || result.Code != CodeWithdrawDailyLimit {
		t.Fatalf("fifth withdraw should be rejected by daily limit, got %+v", result)
	}

	// 超限必须零副作用：既不扣分，也不调用 new-api
	balanceAfter, err := service.GetPointsSummary(ctx, user, 0)
	if err != nil {
		t.Fatalf("read balance failed: %v", err)
	}
	if balanceAfter.Balance != balanceBefore.Balance {
		t.Fatalf("balance changed on rejected withdraw: %d -> %d", balanceBefore.Balance, balanceAfter.Balance)
	}
	if len(quotaClient.creditCalls) != creditCallsBefore {
		t.Fatalf("rejected withdraw must not call new-api, calls %d -> %d", creditCallsBefore, len(quotaClient.creditCalls))
	}
}

func TestWithdrawCountsUncertainButNotFailed(t *testing.T) {
	ctx := context.Background()
	quotaClient := &fakeWalletQuotaClient{
		creditResults: []fakeQuotaResult{
			{result: newapi.QuotaResult{Success: false, Uncertain: true, Message: "入账结果不确定"}},
			{result: newapi.QuotaResult{Success: false, Message: "入账失败"}},
		},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quotaClient)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)

	// uncertain 必须计数：否则用户能靠反复触发 uncertain 绕过上限
	uncertainResult, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("uncertain withdraw failed: %v", err)
	}
	if !uncertainResult.Uncertain || uncertainResult.DailyWithdrawUsed != 1 {
		t.Fatalf("uncertain withdraw should count once, got %+v", uncertainResult)
	}

	// failed 不计数：积分已全额退回
	failedResult, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("failed withdraw returned error: %v", err)
	}
	if failedResult.Success || failedResult.DailyWithdrawUsed != 1 {
		t.Fatalf("failed withdraw must not count, got %+v", failedResult)
	}

	used, err := countWithdrawUsedToday(ctx, service.db, user.ID, todayChina())
	if err != nil {
		t.Fatalf("count failed: %v", err)
	}
	if used != 1 {
		t.Fatalf("persisted used count = %d, want 1", used)
	}
}

func TestGetWithdrawDailyUsageReflectsVIPLimit(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	usage, err := service.GetWithdrawDailyUsage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get usage failed: %v", err)
	}
	if usage.Limit != 4 || usage.Used != 0 || usage.Remaining != 4 {
		t.Fatalf("non-vip usage = %+v, want limit 4 remaining 4", usage)
	}
	if usage.ResetAtMs <= 0 {
		t.Fatalf("reset timestamp should be positive, got %d", usage.ResetAtMs)
	}

	grantVIPForTest(t, ctx, service, user, 30)

	vipUsage, err := service.GetWithdrawDailyUsage(ctx, user.ID)
	if err != nil {
		t.Fatalf("get vip usage failed: %v", err)
	}
	if vipUsage.Limit != 8 || vipUsage.Remaining != 8 {
		t.Fatalf("vip usage = %+v, want limit 8 remaining 8", vipUsage)
	}
}

// VIP 的手续费折扣与限次共用同一次 VIP 状态读取，这里锁住折扣真的落到了扣分与到账金额上。
func TestWithdrawAppliesVIPFeeDiscount(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 10000)
	grantVIPForTest(t, ctx, service, user, 30)

	// 1000 积分的阶梯费率 2%：原价 20 积分，VIP 五折 10 积分，到账 $99
	result, err := service.ExecuteWithdraw(ctx, user, 1000)
	if err != nil {
		t.Fatalf("vip withdraw failed: %v", err)
	}
	if !result.Success {
		t.Fatalf("vip withdraw should succeed, got %+v", result)
	}
	if result.FeePoints != 10 || result.Dollars != 99 {
		t.Fatalf("vip withdraw fee = %d dollars = %v, want 10 and 99", result.FeePoints, result.Dollars)
	}
	if result.DailyWithdrawLimit != 8 {
		t.Fatalf("vip daily limit = %d, want 8", result.DailyWithdrawLimit)
	}
}

// grantVIPForTest 直接写会籍表，绕开购买流程，供限次与折扣测试构造 VIP 用户。
func grantVIPForTest(t *testing.T, ctx context.Context, service *Service, user auth.User, days int64) {
	t.Helper()

	if _, err := service.db.Exec(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, now() + ($2::double precision * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   expires_at = now() + ($2::double precision * INTERVAL '1 day'),
		   updated_at = now()`,
		user.ID, days,
	); err != nil {
		t.Fatalf("grant vip failed: %v", err)
	}
}
