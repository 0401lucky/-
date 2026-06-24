//go:build integration

package d1

import (
	"context"
	"os"
	"strings"
	"testing"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestApplyEcoStateImportWritesStructuredEcoTables(t *testing.T) {
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

	plan, err := PlanEcoStateImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:state:99211','{"userId":99211,"pending":22,"spawnLeftoverMs":10,"autoLeftoverMs":20,"pointBuffer":3,"upgrades":{"spawn":2,"storage":1,"value":1,"auto":1},"inventory":{"diamond":2,"coin":1},"limitedPrizeInventory":{"diamond":1},"lifetimePrizeClaimCounts":{"diamond":3,"coin":1},"prizeLots":[{"id":"lot-99211-1","key":"diamond","acquiredAt":1000,"availableAt":2000,"limited":true,"source":"claim"},{"id":"lot-99211-2","key":"coin","acquiredAt":4000,"source":"stolen","stolenFromUserId":99212,"stolenAt":5000}],"visiblePrizes":[{"id":"vis-99211-1","key":"coin","createdAt":3000,"limited":false}],"itemPurchases":{"clear_truck":{"date":"2026-06-23","count":2}},"dailyTrashPoints":{"date":"2026-06-23","points":14},"exp":15,"lifetimeCleared":16,"lifetimePoints":17,"points":940,"lastTickAt":9000,"createdAt":10000,"updatedAt":11000}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyEcoStateImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 2 || result.StatesUpserted != 1 || result.UpgradesUpserted != 4 || result.PrizeInventoriesUpserted != 5 || result.PrizeLotsUpserted != 2 || result.VisiblePrizesUpserted != 1 || result.ItemPurchasesUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var pending int64
	var pointsSnapshot int64
	var dailyTrashDate string
	if err := db.QueryRow(ctx,
		`SELECT pending, points_snapshot, daily_trash_date::text FROM eco_states WHERE user_id = 99211`,
	).Scan(&pending, &pointsSnapshot, &dailyTrashDate); err != nil {
		t.Fatalf("query eco state failed: %v", err)
	}
	if pending != 22 || pointsSnapshot != 940 || dailyTrashDate != "2026-06-23" {
		t.Fatalf("unexpected eco state: pending=%d points=%d date=%s", pending, pointsSnapshot, dailyTrashDate)
	}

	var spawnLevel int64
	if err := db.QueryRow(ctx,
		`SELECT level FROM eco_user_upgrades WHERE user_id = 99211 AND upgrade_key = 'spawn'`,
	).Scan(&spawnLevel); err != nil {
		t.Fatalf("query eco upgrade failed: %v", err)
	}
	if spawnLevel != 2 {
		t.Fatalf("unexpected spawn level: %d", spawnLevel)
	}

	var diamondInventory int64
	var diamondLimited int64
	var diamondLifetime int64
	if err := db.QueryRow(ctx,
		`SELECT inventory_count, limited_count, lifetime_claim_count
		   FROM eco_prize_inventory
		  WHERE user_id = 99211 AND prize_key = 'diamond'`,
	).Scan(&diamondInventory, &diamondLimited, &diamondLifetime); err != nil {
		t.Fatalf("query eco prize inventory failed: %v", err)
	}
	if diamondInventory != 2 || diamondLimited != 1 || diamondLifetime != 3 {
		t.Fatalf("unexpected diamond inventory: inventory=%d limited=%d lifetime=%d", diamondInventory, diamondLimited, diamondLifetime)
	}

	var lotKey string
	var lotLimited bool
	if err := db.QueryRow(ctx,
		`SELECT prize_key, limited FROM eco_prize_lots WHERE id = 'lot-99211-1'`,
	).Scan(&lotKey, &lotLimited); err != nil {
		t.Fatalf("query eco prize lot failed: %v", err)
	}
	if lotKey != "diamond" || !lotLimited {
		t.Fatalf("unexpected prize lot: key=%s limited=%v", lotKey, lotLimited)
	}

	var stolenFromUserID int64
	if err := db.QueryRow(ctx,
		`SELECT stolen_from_user_id FROM eco_prize_lots WHERE id = 'lot-99211-2'`,
	).Scan(&stolenFromUserID); err != nil {
		t.Fatalf("query stolen eco prize lot failed: %v", err)
	}
	if stolenFromUserID != 99212 {
		t.Fatalf("unexpected stolen_from_user_id: %d", stolenFromUserID)
	}

	var visibleKey string
	if err := db.QueryRow(ctx,
		`SELECT prize_key FROM eco_visible_prizes WHERE id = 'vis-99211-1'`,
	).Scan(&visibleKey); err != nil {
		t.Fatalf("query eco visible prize failed: %v", err)
	}
	if visibleKey != "coin" {
		t.Fatalf("unexpected visible prize key: %s", visibleKey)
	}

	var purchaseCount int64
	if err := db.QueryRow(ctx,
		`SELECT purchase_count
		   FROM eco_item_purchases
		  WHERE user_id = 99211 AND item_key = 'clear_truck' AND purchase_date = '2026-06-23'`,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("query eco item purchase failed: %v", err)
	}
	if purchaseCount != 2 {
		t.Fatalf("unexpected item purchase count: %d", purchaseCount)
	}
}
