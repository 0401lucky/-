//go:build integration

package economy

import (
	"context"
	"testing"
)

func TestListWalletTransactionsPaginatesAndScopesToUser(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	other := integrationUser()
	other.ID = user.ID + 1

	if err := service.ensureWalletUser(ctx, user); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	if err := service.ensureWalletUser(ctx, other); err != nil {
		t.Fatalf("ensure other user failed: %v", err)
	}

	for index := 0; index < 5; index++ {
		if _, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
			UserID:      user.ID,
			Operation:   WalletOperationWithdraw,
			PointsDelta: -100,
			Message:     "integration seed",
		}); err != nil {
			t.Fatalf("seed transaction %d failed: %v", index, err)
		}
	}
	if _, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
		UserID:      other.ID,
		Operation:   WalletOperationTopup,
		PointsDelta: 100,
		Message:     "other user",
	}); err != nil {
		t.Fatalf("seed other transaction failed: %v", err)
	}

	transactions, total, err := service.ListWalletTransactions(ctx, user.ID, 2, 0)
	if err != nil {
		t.Fatalf("list failed: %v", err)
	}
	if total != 5 || len(transactions) != 2 {
		t.Fatalf("page 1: total=%d len=%d, want 5/2", total, len(transactions))
	}
	for _, transaction := range transactions {
		if transaction.UserID != user.ID {
			t.Fatalf("leaked other user's transaction: %+v", transaction)
		}
	}

	lastPage, total, err := service.ListWalletTransactions(ctx, user.ID, 2, 4)
	if err != nil {
		t.Fatalf("list last page failed: %v", err)
	}
	if total != 5 || len(lastPage) != 1 {
		t.Fatalf("last page: total=%d len=%d, want 5/1", total, len(lastPage))
	}
}

func TestGetWalletOverviewReflectsVIPState(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 5000)

	overview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("overview failed: %v", err)
	}
	if overview.Balance != 5000 || overview.FeePercent != 100 {
		t.Fatalf("non-vip overview = %+v, want balance 5000 feePercent 100", overview)
	}
	if overview.VIP.Active || overview.VIP.ExpiresAt != nil {
		t.Fatalf("expected non-vip state, got %+v", overview.VIP)
	}
	if !overview.VIP.CanPurchase {
		t.Fatalf("non-vip user should be able to purchase, got %+v", overview.VIP)
	}
	// benefits 恒定下发，供非 VIP 用户看到「开通后能得到什么」
	if overview.VIP.Benefits.DailyWithdrawLimit != 8 ||
		overview.VIP.Benefits.WithdrawFeePercent != 50 ||
		overview.VIP.Benefits.DailyLotterySpins != 2 {
		t.Fatalf("unexpected benefits: %+v", overview.VIP.Benefits)
	}
	if overview.DailyWithdraw.Limit != 4 {
		t.Fatalf("non-vip withdraw limit = %d, want 4", overview.DailyWithdraw.Limit)
	}

	grantVIPForTest(t, ctx, service, user, 30)

	vipOverview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("vip overview failed: %v", err)
	}
	if !vipOverview.VIP.Active || vipOverview.VIP.ExpiresAt == nil {
		t.Fatalf("expected active vip, got %+v", vipOverview.VIP)
	}
	if vipOverview.FeePercent != 50 || vipOverview.DailyWithdraw.Limit != 8 {
		t.Fatalf("vip overview = feePercent %d limit %d, want 50/8", vipOverview.FeePercent, vipOverview.DailyWithdraw.Limit)
	}
}

func TestGetWalletOverviewBlocksPurchaseAtCeiling(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newWalletIntegrationService(t, ctx, &fakeWalletQuotaClient{})
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 5000)
	grantVIPForTest(t, ctx, service, user, 350)

	overview, err := service.GetWalletOverview(ctx, user.ID)
	if err != nil {
		t.Fatalf("overview failed: %v", err)
	}
	if overview.VIP.CanPurchase {
		t.Fatalf("user at ceiling should not be able to purchase, got %+v", overview.VIP)
	}
	if overview.VIP.PurchaseBlockedReason == "" {
		t.Fatalf("blocked purchase must carry a reason, got %+v", overview.VIP)
	}
}
