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

func TestApplyStoreDataImportWritesStoreTables(t *testing.T) {
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

	plan, err := PlanStoreDataImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:categories','store-import-cat','{"id":"store-import-cat","name":"导入商城分类","color":"#06b6d4","sortOrder":2,"enabled":true,"createdAt":1000,"updatedAt":2000}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:items','store-import-item','{"id":"store-import-item","name":"导入商城商品","description":"说明","type":"lottery_spin","categoryId":"store-import-cat","pointsCost":120,"value":1,"dailyLimit":1,"totalStock":10,"sortOrder":3,"enabled":true,"createdAt":1000,"updatedAt":2000}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:item:purchase_counts','store-import-item','5');
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'exchange_log:97001','{"id":"store-exchange-1","userId":97001,"itemId":"store-import-item","itemName":"导入商城商品","pointsCost":120,"value":1,"type":"lottery_spin","createdAt":3000}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('exchange:daily:97001:2026-06-22:store-import-item','2',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyStoreDataImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 ||
		result.CategoriesUpserted != 1 ||
		result.ItemsUpserted != 1 ||
		result.ExchangeLogsUpserted != 1 ||
		result.DailyPurchasesUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var purchaseCount int64
	var categoryID string
	if err := db.QueryRow(ctx,
		`SELECT purchase_count, category_id FROM store_items WHERE id = 'store-import-item'`,
	).Scan(&purchaseCount, &categoryID); err != nil {
		t.Fatalf("query imported store item failed: %v", err)
	}
	if purchaseCount != 5 || categoryID != "store-import-cat" {
		t.Fatalf("unexpected store item values: purchase=%d category=%s", purchaseCount, categoryID)
	}

	var quantity int64
	var itemName string
	if err := db.QueryRow(ctx,
		`SELECT quantity, item_name FROM exchange_logs WHERE id = 'store-exchange-1'`,
	).Scan(&quantity, &itemName); err != nil {
		t.Fatalf("query imported exchange log failed: %v", err)
	}
	if quantity != 1 || itemName != "导入商城商品" {
		t.Fatalf("unexpected exchange log values: quantity=%d itemName=%s", quantity, itemName)
	}

	var dailyCount int64
	if err := db.QueryRow(ctx,
		`SELECT purchase_count FROM store_daily_purchases
		 WHERE user_id = 97001 AND item_id = 'store-import-item' AND stat_date = '2026-06-22'`,
	).Scan(&dailyCount); err != nil {
		t.Fatalf("query imported daily purchase failed: %v", err)
	}
	if dailyCount != 2 {
		t.Fatalf("unexpected daily purchase count: %d", dailyCount)
	}
}
