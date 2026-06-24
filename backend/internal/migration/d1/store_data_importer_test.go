package d1

import (
	"strings"
	"testing"
)

func TestPlanStoreDataImportParsesLegacyStoreData(t *testing.T) {
	plan, err := PlanStoreDataImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:categories','import-cat','{"id":"import-cat","name":"导入分类","color":"#06b6d4","sortOrder":2,"enabled":true,"createdAt":1000,"updatedAt":2000}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:items','import-item','{"id":"import-item","name":"导入商品","description":"说明","type":"lottery_spin","categoryId":"import-cat","pointsCost":100,"value":1,"dailyLimit":1,"totalStock":10,"sortOrder":3,"enabled":true,"createdAt":1000,"updatedAt":2000}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:item:purchase_counts','import-item','4');
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'exchange_log:95001','{"id":"exchange-1","userId":95001,"itemId":"import-item","itemName":"导入商品","pointsCost":100,"value":1,"type":"lottery_spin","createdAt":3000}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('exchange:daily:95001:2026-06-22:import-item','2',NULL);
`))
	if err != nil {
		t.Fatalf("PlanStoreDataImport returned error: %v", err)
	}
	if len(plan.Users) != 1 {
		t.Fatalf("expected 1 placeholder user, got %d", len(plan.Users))
	}
	if len(plan.Categories) != 1 {
		t.Fatalf("expected 1 category, got %d", len(plan.Categories))
	}
	if len(plan.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(plan.Items))
	}
	if len(plan.ExchangeLogs) != 1 {
		t.Fatalf("expected 1 exchange log, got %d", len(plan.ExchangeLogs))
	}
	if len(plan.DailyPurchases) != 1 {
		t.Fatalf("expected 1 daily purchase, got %d", len(plan.DailyPurchases))
	}

	item := plan.Items[0]
	if item.ID != "import-item" || item.PurchaseCount != 4 || item.DailyLimit == nil || *item.DailyLimit != 1 {
		t.Fatalf("unexpected item: %+v", item)
	}
	log := plan.ExchangeLogs[0]
	if log.ID != "exchange-1" || log.UserID != 95001 || log.Quantity != 1 {
		t.Fatalf("unexpected exchange log: %+v", log)
	}
	daily := plan.DailyPurchases[0]
	if daily.UserID != 95001 || daily.StatDate != "2026-06-22" || daily.PurchaseCount != 2 {
		t.Fatalf("unexpected daily purchase: %+v", daily)
	}
}

func TestPlanStoreDataImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanStoreDataImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:items','bad-item','{"id":"bad-item","name":"坏商品","type":"lottery_spin","pointsCost":0,"value":1}');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('store:item:purchase_counts','ghost-item','1');
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'exchange_log:bad','{}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('exchange:daily:96001:not-a-date:item','1',NULL);
`))
	if err != nil {
		t.Fatalf("PlanStoreDataImport returned error: %v", err)
	}
	if len(plan.Items) != 0 || len(plan.ExchangeLogs) != 0 || len(plan.DailyPurchases) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 4 {
		t.Fatalf("expected 4 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
