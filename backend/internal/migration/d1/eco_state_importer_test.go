package d1

import (
	"strings"
	"testing"
)

func TestPlanEcoStateImportParsesUserState(t *testing.T) {
	plan, err := PlanEcoStateImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:state:99201','{"userId":99201,"pending":12,"spawnLeftoverMs":100,"autoLeftoverMs":200,"pointBuffer":3,"upgrades":{"spawn":2,"storage":1,"value":3,"auto":9},"inventory":{"diamond":2,"coin":1,"trophy":4},"limitedPrizeInventory":{"diamond":1,"trophy":9},"lifetimePrizeClaimCounts":{"diamond":3,"coin":1,"trophy":5},"prizeLots":[{"id":"lot-1","key":"diamond","acquiredAt":1000,"availableAt":2000,"limited":true,"source":"claim","publicEntryId":"pub-1","publiclyListedAt":3000,"merchantAvailableAt":4000},{"id":"lot-2","key":"trophy","acquiredAt":5000,"source":"stolen","stolenFromUserId":42,"stolenAt":6000,"theftId":"theft-1","blackMarketAvailableAt":7000},{"id":"bad-lot","key":"bad","acquiredAt":1}],"visiblePrizes":[{"id":"vis-1","key":"coin","createdAt":8000,"limited":true},{"id":"bad-visible","key":"coin","createdAt":0}],"luckyGenerationsRemaining":5,"gloveUsesRemaining":6,"itemPurchases":{"clear_truck":{"date":"2026-06-23","count":2},"recycle_glove":{"date":"bad","count":1},"unknown":{"date":"2026-06-23","count":1}},"dailyTrashPoints":{"date":"2026-06-23","points":14},"exp":15,"lifetimeCleared":16,"lifetimePoints":17,"points":940,"lastTickAt":9000,"createdAt":10000,"updatedAt":11000}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanEcoStateImport returned error: %v", err)
	}
	if len(plan.Users) != 2 || len(plan.States) != 1 {
		t.Fatalf("expected state user plus stolen-from placeholder user and one state, got users=%d states=%d", len(plan.Users), len(plan.States))
	}
	state := plan.States[0]
	if state.UserID != 99201 || state.Pending != 12 || state.PointsSnapshot != 940 || state.DailyTrashDate == nil || *state.DailyTrashDate != "2026-06-23" {
		t.Fatalf("unexpected state: %+v", state)
	}
	if state.LastTickAtMs != 9000 || state.CreatedAtMs != 10000 || state.UpdatedAtMs != 11000 {
		t.Fatalf("unexpected state timestamps: %+v", state)
	}

	upgrades := map[string]int64{}
	for _, upgrade := range plan.Upgrades {
		upgrades[upgrade.UpgradeKey] = upgrade.Level
	}
	if upgrades["spawn"] != 2 || upgrades["storage"] != 1 || upgrades["value"] != 3 || upgrades["auto"] != 6 {
		t.Fatalf("unexpected upgrades: %+v", upgrades)
	}

	inventory := map[string]EcoPrizeInventoryImportRecord{}
	for _, record := range plan.PrizeInventories {
		inventory[record.PrizeKey] = record
	}
	if len(inventory) != 5 {
		t.Fatalf("expected inventory rows for all prize keys, got %d", len(inventory))
	}
	if inventory["diamond"].InventoryCount != 2 || inventory["diamond"].LimitedCount != 1 || inventory["diamond"].LifetimeClaimCount != 3 {
		t.Fatalf("unexpected diamond inventory: %+v", inventory["diamond"])
	}
	if inventory["trophy"].InventoryCount != 4 || inventory["trophy"].LimitedCount != 4 || inventory["trophy"].LifetimeClaimCount != 5 {
		t.Fatalf("unexpected trophy inventory: %+v", inventory["trophy"])
	}

	if len(plan.PrizeLots) != 2 {
		t.Fatalf("expected two valid prize lots, got %d", len(plan.PrizeLots))
	}
	if plan.PrizeLots[1].Source != "stolen" || plan.PrizeLots[1].AvailableAtMs != 5000 || plan.PrizeLots[1].StolenFromUserID == nil || *plan.PrizeLots[1].StolenFromUserID != 42 {
		t.Fatalf("unexpected stolen lot: %+v", plan.PrizeLots[1])
	}
	if len(plan.VisiblePrizes) != 1 || plan.VisiblePrizes[0].ID != "vis-1" || !plan.VisiblePrizes[0].Limited {
		t.Fatalf("unexpected visible prizes: %+v", plan.VisiblePrizes)
	}
	if len(plan.ItemPurchases) != 1 || plan.ItemPurchases[0].ItemKey != "clear_truck" || plan.ItemPurchases[0].PurchaseCount != 2 {
		t.Fatalf("unexpected item purchases: %+v", plan.ItemPurchases)
	}
	if len(plan.Warnings) != 4 {
		t.Fatalf("expected 4 warnings for invalid lot, visible prize and item purchases, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}

func TestPlanEcoStateImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanEcoStateImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:state:bad','{}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:state:99202','not-json',NULL);
`))
	if err != nil {
		t.Fatalf("PlanEcoStateImport returned error: %v", err)
	}
	if len(plan.Users) != 0 || len(plan.States) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 2 {
		t.Fatalf("expected two warnings for invalid user id and invalid JSON, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
