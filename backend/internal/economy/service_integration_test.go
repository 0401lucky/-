//go:build integration

package economy

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	"redemption/backend/internal/platform/newapi"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestExchangeItemConcurrentInsufficientBalance(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	grant := PointMutationInput{
		Delta:       300,
		Source:      "admin_adjust",
		Description: "integration seed balance",
	}
	if result, err := service.ApplyPointsDelta(ctx, user, grant); err != nil || !result.Success {
		t.Fatalf("seed balance failed: result=%+v err=%v", result, err)
	}

	var successes atomic.Int64
	var failures atomic.Int64
	runConcurrent(100, func(index int) {
		result, err := service.ExchangeItem(ctx, user, ExchangeInput{
			ItemID:         "makeup-card-1",
			Quantity:       1,
			IdempotencyKey: randomID(),
		})
		if err != nil {
			t.Errorf("exchange %d returned error: %v", index, err)
			return
		}
		if result.Success {
			successes.Add(1)
		} else {
			failures.Add(1)
		}
	})

	if successes.Load() != 10 {
		t.Fatalf("expected 10 successful exchanges, got %d failures=%d", successes.Load(), failures.Load())
	}

	summary, err := service.GetPointsSummary(ctx, user, 100)
	if err != nil {
		t.Fatalf("get points summary failed: %v", err)
	}
	if summary.Balance != 0 {
		t.Fatalf("expected final balance 0, got %d", summary.Balance)
	}
}

func TestExchangeItemDuplicateIdempotencyKey(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	grant := PointMutationInput{
		Delta:       2000,
		Source:      "admin_adjust",
		Description: "integration seed balance",
	}
	if result, err := service.ApplyPointsDelta(ctx, user, grant); err != nil || !result.Success {
		t.Fatalf("seed balance failed: result=%+v err=%v", result, err)
	}

	idempotencyKey := "same-key-" + randomID()
	var successes atomic.Int64
	runConcurrent(20, func(index int) {
		result, err := service.ExchangeItem(ctx, user, ExchangeInput{
			ItemID:         "card-draw-1",
			Quantity:       1,
			IdempotencyKey: idempotencyKey,
		})
		if err != nil {
			t.Errorf("exchange %d returned error: %v", index, err)
			return
		}
		if result.Success {
			successes.Add(1)
		}
	})

	if successes.Load() != 20 {
		t.Fatalf("all duplicate-idempotency calls should replay success, got %d", successes.Load())
	}

	summary, err := service.GetPointsSummary(ctx, user, 100)
	if err != nil {
		t.Fatalf("get points summary failed: %v", err)
	}
	if summary.Balance != 1100 {
		t.Fatalf("expected exactly one 900-point deduction, got balance %d", summary.Balance)
	}

	var assetDraws int64
	if err := service.db.QueryRow(ctx, `SELECT card_draws FROM user_assets WHERE user_id = $1`, user.ID).Scan(&assetDraws); err != nil {
		t.Fatalf("query user assets card draws failed: %v", err)
	}
	if assetDraws != 1 {
		t.Fatalf("expected exactly one user_assets card draw, got %d", assetDraws)
	}

	var cardStateDraws int64
	if err := service.db.QueryRow(ctx, `SELECT draws_available FROM card_user_states WHERE user_id = $1`, user.ID).Scan(&cardStateDraws); err != nil {
		t.Fatalf("query card user state draws failed: %v", err)
	}
	if cardStateDraws != 2 {
		t.Fatalf("expected card state draws to include default draw plus one purchase, got %d", cardStateDraws)
	}
}

func TestAdminPointsQueryAndAdjust(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	target := integrationUser()
	target.Username = "admin-points-target"
	target.DisplayName = "Admin Points Target"
	admin := auth.User{ID: target.ID + 1, Username: "admin", DisplayName: "Admin", IsAdmin: true}
	seedPoints(t, ctx, service, target, 100)

	added, mutation, err := service.AdjustAdminUserPoints(ctx, admin, AdminPointsAdjustmentInput{
		UserID:      target.ID,
		Amount:      25,
		Description: "人工补偿",
	})
	if err != nil || !mutation.Success {
		t.Fatalf("admin add points failed: result=%+v mutation=%+v err=%v", added, mutation, err)
	}
	if added.NewBalance != 125 || added.Adjustment != 25 {
		t.Fatalf("unexpected add result: %+v", added)
	}

	deducted, mutation, err := service.AdjustAdminUserPoints(ctx, admin, AdminPointsAdjustmentInput{
		UserID:      target.ID,
		Amount:      -50,
		Description: "违规扣除",
	})
	if err != nil || !mutation.Success {
		t.Fatalf("admin deduct points failed: result=%+v mutation=%+v err=%v", deducted, mutation, err)
	}
	if deducted.NewBalance != 75 || deducted.Adjustment != -50 {
		t.Fatalf("unexpected deduct result: %+v", deducted)
	}

	page, err := service.GetAdminUserPoints(ctx, target.ID, 1, 2)
	if err != nil {
		t.Fatalf("get admin user points failed: %v", err)
	}
	if page.UserID != target.ID || page.Balance != 75 || len(page.Logs) != 2 {
		t.Fatalf("unexpected admin points page: %+v", page)
	}
	if page.Pagination.Total != 3 || page.Pagination.TotalPages != 2 || !page.Pagination.HasMore {
		t.Fatalf("unexpected admin points pagination: %+v", page.Pagination)
	}
	if page.Logs[0].Amount != -50 || !strings.Contains(page.Logs[0].Description, "[管理员:admin]") {
		t.Fatalf("latest admin log should be deduct with admin prefix: %+v", page.Logs[0])
	}

	_, mutation, err = service.AdjustAdminUserPoints(ctx, admin, AdminPointsAdjustmentInput{
		UserID:      target.ID,
		Amount:      -1000,
		Description: "超额扣除",
	})
	if err != nil {
		t.Fatalf("insufficient admin deduct should be business result, got error: %v", err)
	}
	if mutation.Success || mutation.Message != "积分不足" {
		t.Fatalf("unexpected insufficient deduct mutation: %+v", mutation)
	}
}

func TestStoreAdminManageItems(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	category, err := service.SaveStoreCategory(ctx, StoreCategoryMutationInput{
		Name:      "集成测试分类",
		Color:     "#06b6d4",
		SortOrder: 99,
		Enabled:   true,
	})
	if err != nil {
		t.Fatalf("create category failed: %v", err)
	}
	if category.ID == "" {
		t.Fatalf("created category should have id")
	}

	dailyLimit := int64(2)
	item, err := service.CreateStoreItem(ctx, StoreItemMutationInput{
		Name:        "集成测试商品",
		Description: "说明",
		Type:        ItemTypeLotterySpin,
		CategoryID:  category.ID,
		PointsCost:  100,
		Value:       1,
		DailyLimit:  &dailyLimit,
		SortOrder:   100,
		Enabled:     true,
	})
	if err != nil {
		t.Fatalf("create item failed: %v", err)
	}
	if item.CategoryID != category.ID || item.DailyLimit == nil || *item.DailyLimit != 2 {
		t.Fatalf("unexpected created item: %+v", item)
	}

	name := "集成测试商品已更新"
	enabled := false
	updated, err := service.UpdateStoreItem(ctx, StoreItemUpdateInput{
		ID:            item.ID,
		Name:          &name,
		DailyLimitSet: true,
		DailyLimit:    nil,
		Enabled:       &enabled,
	})
	if err != nil {
		t.Fatalf("update item failed: %v", err)
	}
	if updated.Name != name || updated.Enabled || updated.DailyLimit != nil {
		t.Fatalf("unexpected updated item: %+v", updated)
	}

	adminData, err := service.GetStoreAdmin(ctx)
	if err != nil {
		t.Fatalf("get store admin failed: %v", err)
	}
	if !containsStoreItem(adminData.Items, item.ID) || !containsStoreCategory(adminData.Categories, category.ID) {
		t.Fatalf("admin data should include created category and item")
	}

	deleted, err := service.DeleteStoreItem(ctx, item.ID)
	if err != nil {
		t.Fatalf("delete item failed: %v", err)
	}
	if !deleted {
		t.Fatalf("delete item should report deleted=true")
	}
}

func TestStoreAdminFarmShopOverrides(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	adminData, err := service.GetStoreAdmin(ctx)
	if err != nil {
		t.Fatalf("get store admin failed: %v", err)
	}
	if !containsFarmItem(adminData.FarmItems, "speed_normal") {
		t.Fatalf("admin data should include farm shop items")
	}
	assertFarmItemOrder(t, adminData.FarmItems, "pet_water_basic", "pet_care_basic", "pet_rest_basic", "pet_play_basic")

	cost := int64(33)
	dailyLimit := int64(4)
	speedReduce := int64(12)
	override, err := service.SaveFarmShopItemOverride(ctx, FarmShopItemOverrideInput{
		Key:                "speed_normal",
		Cost:               &cost,
		DailyLimit:         &dailyLimit,
		SpeedReduceMinutes: &speedReduce,
		PetEffect:          PetItemEffect{"mood": 5},
	})
	if err != nil {
		t.Fatalf("save farm override failed: %v", err)
	}
	if override.Cost == nil || *override.Cost != 33 || override.DailyLimit == nil || *override.DailyLimit != 4 || override.SpeedReduceMinutes == nil || *override.SpeedReduceMinutes != 12 || override.PetEffect["mood"] != 5 {
		t.Fatalf("unexpected override: %+v", override)
	}

	adminData, err = service.GetStoreAdmin(ctx)
	if err != nil {
		t.Fatalf("get store admin after override failed: %v", err)
	}
	item, ok := findFarmItem(adminData.FarmItems, "speed_normal")
	if !ok {
		t.Fatalf("speed_normal should be returned")
	}
	if item.Cost != 33 || item.DailyLimit == nil || *item.DailyLimit != 4 || item.SpeedReduceMinutes == nil || *item.SpeedReduceMinutes != 12 || item.PetEffect["mood"] != 5 || item.Override == nil {
		t.Fatalf("override should be reflected in effective item: %+v", item)
	}

	if _, err := service.SaveFarmShopItemOverride(ctx, FarmShopItemOverrideInput{Key: "missing_item"}); !errors.Is(err, ErrFarmShopItemNotFound) {
		t.Fatalf("expected ErrFarmShopItemNotFound, got %v", err)
	}
}

func TestWalletTransactionLifecycle(t *testing.T) {
	ctx := context.Background()
	service, cleanup := newIntegrationService(t, ctx)
	defer cleanup()

	user := integrationUser()
	if result, err := service.ApplyPointsDelta(ctx, user, PointMutationInput{
		Delta:       100,
		Source:      "admin_adjust",
		Description: "wallet integration seed",
	}); err != nil || !result.Success {
		t.Fatalf("seed user failed: result=%+v err=%v", result, err)
	}

	requestedPoints := int64(100)
	feePoints := int64(5)
	netPoints := int64(95)
	transaction, err := service.BeginWalletTransaction(ctx, BeginWalletTransactionInput{
		UserID:          user.ID,
		Operation:       WalletOperationWithdraw,
		PointsDelta:     -100,
		DollarsDelta:    9.5,
		RequestedPoints: &requestedPoints,
		FeePoints:       &feePoints,
		NetPoints:       &netPoints,
		Message:         "提现 100 积分",
	})
	if err != nil {
		t.Fatalf("begin wallet transaction failed: %v", err)
	}
	if transaction.Status != WalletStatusPending || transaction.RequestedPoints == nil || *transaction.RequestedPoints != 100 {
		t.Fatalf("unexpected pending transaction: %+v", transaction)
	}

	quota := int64(500000)
	balanceDollars := 1.0
	wholeDollars := int64(1)
	updated, err := service.UpdateWalletTransaction(ctx, UpdateWalletTransactionInput{
		ID:                        transaction.ID,
		Status:                    WalletStatusUncertain,
		Message:                   "额度入账结果不确定",
		NewAPIQuota:               &quota,
		NewAPIBalanceDollars:      &balanceDollars,
		NewAPIBalanceWholeDollars: &wholeDollars,
	})
	if err != nil {
		t.Fatalf("update wallet transaction failed: %v", err)
	}
	if updated.Status != WalletStatusUncertain ||
		updated.NewAPIQuota == nil || *updated.NewAPIQuota != quota ||
		updated.NewAPIBalanceDollars == nil || *updated.NewAPIBalanceDollars != balanceDollars {
		t.Fatalf("unexpected updated transaction: %+v", updated)
	}
}

func TestExecuteWithdrawSuccess(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		creditResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                true,
				Message:                "提现成功到账",
				NewQuota:               4850000,
				NewBalanceDollars:      9.7,
				NewBalanceWholeDollars: 9,
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	result, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("withdraw failed: %v", err)
	}
	if !result.Success || result.Balance != 0 || result.Dollars != 9.7 || result.FeePoints != 3 {
		t.Fatalf("unexpected withdraw result: %+v", result)
	}
	if len(quota.creditCalls) != 1 || quota.creditCalls[0].dollars != 9.7 {
		t.Fatalf("unexpected credit calls: %+v", quota.creditCalls)
	}
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationWithdraw)
	if transaction.Status != WalletStatusSuccess || transaction.PointsDelta != -100 {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteWithdrawUncertainKeepsDeductedPoints(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		creditResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                false,
				Message:                "无法确认充值结果",
				Uncertain:              true,
				NewQuota:               0,
				NewBalanceDollars:      0,
				NewBalanceWholeDollars: 0,
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	result, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("withdraw failed: %v", err)
	}
	if result.Success || !result.Uncertain || result.Balance != 0 {
		t.Fatalf("unexpected withdraw result: %+v", result)
	}
	assertBalance(t, ctx, service, user, 0)
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationWithdraw)
	if transaction.Status != WalletStatusUncertain {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteWithdrawCreditFailureRefundsPoints(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		creditResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success: false,
				Message: "账户额度入账失败",
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	seedPoints(t, ctx, service, user, 100)

	result, err := service.ExecuteWithdraw(ctx, user, 100)
	if err != nil {
		t.Fatalf("withdraw failed: %v", err)
	}
	if result.Success || result.Uncertain || result.Balance != 100 {
		t.Fatalf("unexpected withdraw result: %+v", result)
	}
	assertBalance(t, ctx, service, user, 100)
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationWithdraw)
	if transaction.Status != WalletStatusFailed {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteTopupSuccess(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		deductResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                true,
				Message:                "扣减成功",
				NewQuota:               1500000,
				NewBalanceDollars:      3,
				NewBalanceWholeDollars: 3,
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	result, err := service.ExecuteTopup(ctx, user, 2)
	if err != nil {
		t.Fatalf("topup failed: %v", err)
	}
	if !result.Success || result.Balance != 20 || result.PointsGained != 20 || result.NewAPIBalanceDollars != 3 {
		t.Fatalf("unexpected topup result: %+v", result)
	}
	if len(quota.deductCalls) != 1 || quota.deductCalls[0].dollars != 2 {
		t.Fatalf("unexpected deduct calls: %+v", quota.deductCalls)
	}
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationTopup)
	if transaction.Status != WalletStatusSuccess || transaction.PointsDelta != 20 {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteTopupDeductUncertainStillGrantsPoints(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		deductResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                false,
				Message:                "扣减结果不确定",
				Uncertain:              true,
				NewQuota:               0,
				NewBalanceDollars:      0,
				NewBalanceWholeDollars: 0,
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	result, err := service.ExecuteTopup(ctx, user, 1)
	if err != nil {
		t.Fatalf("topup failed: %v", err)
	}
	if !result.Success || !result.Uncertain || result.Balance != 10 {
		t.Fatalf("unexpected topup result: %+v", result)
	}
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationTopup)
	if transaction.Status != WalletStatusUncertain {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteTopupGrantFailureRollsBackQuota(t *testing.T) {
	ctx := context.Background()
	quota := &fakeWalletQuotaClient{
		deductResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                true,
				Message:                "扣减成功",
				NewQuota:               0,
				NewBalanceDollars:      0,
				NewBalanceWholeDollars: 0,
			},
		}},
		creditResults: []fakeQuotaResult{{
			result: newapi.QuotaResult{
				Success:                true,
				Message:                "已退回额度",
				NewQuota:               500000,
				NewBalanceDollars:      1,
				NewBalanceWholeDollars: 1,
			},
		}},
	}
	service, cleanup := newWalletIntegrationService(t, ctx, quota)
	defer cleanup()

	user := integrationUser()
	if err := service.ensureWalletUser(ctx, user); err != nil {
		t.Fatalf("ensure user failed: %v", err)
	}
	if _, err := service.db.Exec(ctx, `UPDATE point_accounts SET balance = $1 WHERE user_id = $2`, int64(math.MaxInt64), user.ID); err != nil {
		t.Fatalf("seed max balance failed: %v", err)
	}

	result, err := service.ExecuteTopup(ctx, user, 1)
	if err != nil {
		t.Fatalf("topup should return rollback result, got error: %v", err)
	}
	if result.Success || result.Uncertain || len(quota.creditCalls) != 1 {
		t.Fatalf("unexpected topup rollback result=%+v creditCalls=%+v", result, quota.creditCalls)
	}
	assertBalance(t, ctx, service, user, int64(math.MaxInt64))
	transaction := latestWalletTransaction(t, ctx, service, user.ID, WalletOperationTopup)
	if transaction.Status != WalletStatusFailed {
		t.Fatalf("unexpected transaction: %+v", transaction)
	}
}

func TestExecuteWithdrawReturnsBusyWhenWalletLockIsHeld(t *testing.T) {
	ctx := context.Background()
	redisClient := newFakeRedisLockClient()
	redisClient.values[walletOperationLockKey(1001)] = "existing"
	service := NewServiceWithWalletDeps(nil, redisClient, &fakeWalletQuotaClient{})

	result, err := service.ExecuteWithdraw(ctx, auth.User{ID: 1001, Username: "busy-user"}, 100)
	if err != nil {
		t.Fatalf("busy lock should be returned as business result: %v", err)
	}
	if result.Success || result.Message != "已有提现请求正在处理中，请稍后再试" {
		t.Fatalf("unexpected busy result: %+v", result)
	}
}

func newIntegrationService(t *testing.T, ctx context.Context) (*Service, func()) {
	t.Helper()
	return newIntegrationServiceWithFactory(t, ctx, func(db *pgxpool.Pool) *Service {
		return NewService(db)
	})
}

func newWalletIntegrationService(t *testing.T, ctx context.Context, quotaClient WalletQuotaClient) (*Service, func()) {
	t.Helper()
	return newIntegrationServiceWithFactory(t, ctx, func(db *pgxpool.Pool) *Service {
		return NewServiceWithWalletDeps(db, newFakeRedisLockClient(), quotaClient)
	})
}

func newIntegrationServiceWithFactory(t *testing.T, ctx context.Context, factory func(*pgxpool.Pool) *Service) (*Service, func()) {
	t.Helper()

	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}

	return factory(db), db.Close
}

func seedPoints(t *testing.T, ctx context.Context, service *Service, user auth.User, points int64) {
	t.Helper()

	result, err := service.ApplyPointsDelta(ctx, user, PointMutationInput{
		Delta:       points,
		Source:      "admin_adjust",
		Description: "integration seed balance",
	})
	if err != nil || !result.Success {
		t.Fatalf("seed points failed: result=%+v err=%v", result, err)
	}
}

func assertBalance(t *testing.T, ctx context.Context, service *Service, user auth.User, expected int64) {
	t.Helper()

	summary, err := service.GetPointsSummary(ctx, user, 1)
	if err != nil {
		t.Fatalf("get points summary failed: %v", err)
	}
	if summary.Balance != expected {
		t.Fatalf("expected balance %d, got %d", expected, summary.Balance)
	}
}

func latestWalletTransaction(t *testing.T, ctx context.Context, service *Service, userID int64, operation string) WalletTransaction {
	t.Helper()

	transaction, err := queryWalletTransaction(ctx, service.db,
		`SELECT `+walletTransactionSelectColumns()+`
		 FROM wallet_transactions
		 WHERE user_id = $1 AND operation = $2
		 ORDER BY created_at DESC
		 LIMIT 1`,
		userID,
		operation,
	)
	if err != nil {
		t.Fatalf("query latest wallet transaction failed: %v", err)
	}
	return transaction
}

type fakeQuotaCall struct {
	userID  int64
	dollars float64
}

type fakeQuotaResult struct {
	result newapi.QuotaResult
	err    error
}

type fakeWalletQuotaClient struct {
	balance       newapi.QuotaBalance
	balanceErr    error
	creditResults []fakeQuotaResult
	deductResults []fakeQuotaResult
	creditCalls   []fakeQuotaCall
	deductCalls   []fakeQuotaCall
}

func (client *fakeWalletQuotaClient) GetQuotaBalance(ctx context.Context, userID int64) (newapi.QuotaBalance, error) {
	return client.balance, client.balanceErr
}

func (client *fakeWalletQuotaClient) CreditQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error) {
	client.creditCalls = append(client.creditCalls, fakeQuotaCall{userID: userID, dollars: dollars})
	return client.nextCreditResult()
}

func (client *fakeWalletQuotaClient) DeductQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error) {
	client.deductCalls = append(client.deductCalls, fakeQuotaCall{userID: userID, dollars: dollars})
	return client.nextDeductResult()
}

func (client *fakeWalletQuotaClient) nextCreditResult() (newapi.QuotaResult, error) {
	if len(client.creditResults) == 0 {
		return newapi.QuotaResult{Success: true, Message: "credit ok"}, nil
	}
	next := client.creditResults[0]
	client.creditResults = client.creditResults[1:]
	return next.result, next.err
}

func (client *fakeWalletQuotaClient) nextDeductResult() (newapi.QuotaResult, error) {
	if len(client.deductResults) == 0 {
		return newapi.QuotaResult{Success: true, Message: "deduct ok"}, nil
	}
	next := client.deductResults[0]
	client.deductResults = client.deductResults[1:]
	return next.result, next.err
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}

func integrationUser() auth.User {
	id := time.Now().UnixNano()
	return auth.User{
		ID:          id,
		Username:    "integration-user",
		DisplayName: "Integration User",
	}
}

func runConcurrent(count int, fn func(index int)) {
	var wg sync.WaitGroup
	wg.Add(count)
	for index := 0; index < count; index++ {
		index := index
		go func() {
			defer wg.Done()
			fn(index)
		}()
	}
	wg.Wait()
}

func containsStoreItem(items []StoreItem, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func containsStoreCategory(categories []StoreCategory, id string) bool {
	for _, category := range categories {
		if category.ID == id {
			return true
		}
	}
	return false
}

func containsFarmItem(items []EffectiveFarmItem, key string) bool {
	_, ok := findFarmItem(items, key)
	return ok
}

func findFarmItem(items []EffectiveFarmItem, key string) (EffectiveFarmItem, bool) {
	for _, item := range items {
		if item.Key == key {
			return item, true
		}
	}
	return EffectiveFarmItem{}, false
}

func assertFarmItemOrder(t *testing.T, items []EffectiveFarmItem, keys ...string) {
	t.Helper()

	indexes := make(map[string]int, len(items))
	for index, item := range items {
		indexes[item.Key] = index
	}
	for index := 1; index < len(keys); index++ {
		left, leftOK := indexes[keys[index-1]]
		right, rightOK := indexes[keys[index]]
		if !leftOK || !rightOK {
			t.Fatalf("farm item order assertion missing key %q or %q", keys[index-1], keys[index])
		}
		if left >= right {
			t.Fatalf("expected %s before %s, indexes=%v", keys[index-1], keys[index], indexes)
		}
	}
}
