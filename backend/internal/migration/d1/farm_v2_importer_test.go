package d1

import (
	"strings"
	"testing"
)

func TestPlanFarmV2ImportParsesLegacyFarmData(t *testing.T) {
	plan, err := PlanFarmV2Import(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:state:99401','{"userId":99401,"points":120,"lands":[],"lastTickAt":1700000000000,"createdAt":1699999900000,"updatedAt":1700000100000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:shop:daily:99401:2026-06-23:pet_food_normal','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:mature-mail:sent:99401:event-1','{"claimedAt":1700000200000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:water-mail:sent:99401:2:1700000000000:1700000300000:1','{"claimedAt":1700000400000}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanFarmV2Import returned error: %v", err)
	}
	if len(plan.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(plan.Users))
	}
	if len(plan.States) != 1 {
		t.Fatalf("expected 1 state, got %d", len(plan.States))
	}
	if len(plan.DailyPurchases) != 1 {
		t.Fatalf("expected 1 daily purchase, got %d", len(plan.DailyPurchases))
	}
	if len(plan.MaturityEmails) != 1 {
		t.Fatalf("expected 1 maturity email, got %d", len(plan.MaturityEmails))
	}
	if len(plan.WaterEmails) != 1 {
		t.Fatalf("expected 1 water email, got %d", len(plan.WaterEmails))
	}

	state := plan.States[0]
	if state.UserID != 99401 || state.LastTickAtMs != 1700000000000 || state.UpdatedAtMs != 1700000100000 {
		t.Fatalf("unexpected state: %+v", state)
	}
	purchase := plan.DailyPurchases[0]
	if purchase.UserID != 99401 || purchase.PurchaseDate != "2026-06-23" || purchase.ItemKey != "pet_food_normal" || purchase.PurchaseCount != 2 {
		t.Fatalf("unexpected daily purchase: %+v", purchase)
	}
	maturity := plan.MaturityEmails[0]
	if maturity.UserID != 99401 || maturity.EventID != "event-1" || maturity.SentAtMs != 1700000200000 {
		t.Fatalf("unexpected maturity email: %+v", maturity)
	}
	water := plan.WaterEmails[0]
	if water.UserID != 99401 || water.LandIndex != 2 || water.WaterMissCount != 1 || water.SentAtMs != 1700000400000 {
		t.Fatalf("unexpected water email: %+v", water)
	}
}

func TestPlanFarmV2ImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanFarmV2Import(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:state:bad','{}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:state:99402','[]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:shop:daily:99402:not-a-date:item','1',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:shop:daily:99402:2026-06-23:item','-1',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:mature-mail:sent:99402:','{"claimedAt":1700000200000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:water-mail:sent:99402:0:1700000000000:1700000300000:1','{"claimedAt":1700000400000}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanFarmV2Import returned error: %v", err)
	}
	if len(plan.States) != 0 || len(plan.DailyPurchases) != 0 || len(plan.MaturityEmails) != 0 || len(plan.WaterEmails) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 6 {
		t.Fatalf("expected 6 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
