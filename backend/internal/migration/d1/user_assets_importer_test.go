package d1

import (
	"strings"
	"testing"
)

func TestPlanUserAssetsImportPrefersNativePerField(t *testing.T) {
	plan, err := PlanUserAssetsImport(strings.NewReader(`
INSERT INTO "native_user_assets" ("user_id","extra_spins","updated_at") VALUES(99001,7,2000);
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(99001,'{"drawsAvailable":4}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:extra_spins:99001','3',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99001','{"drawsAvailable":2}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:makeup_cards:99001','5',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:extra_spins:99002','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99002','{"drawsAvailable":6}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:makeup_cards:99002','1',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserAssetsImport returned error: %v", err)
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected 2 placeholder users, got %d", len(plan.Users))
	}
	if len(plan.Assets) != 2 {
		t.Fatalf("expected 2 user asset rows, got %d", len(plan.Assets))
	}

	assets := map[int64]UserAssetImportRecord{}
	for _, asset := range plan.Assets {
		assets[asset.UserID] = asset
	}
	if assets[99001].ExtraSpins != 7 || assets[99001].CardDraws != 4 || assets[99001].MakeupCards != 5 {
		t.Fatalf("unexpected native-preferred asset: %+v", assets[99001])
	}
	if assets[99002].ExtraSpins != 2 || assets[99002].CardDraws != 6 || assets[99002].MakeupCards != 1 {
		t.Fatalf("unexpected legacy asset: %+v", assets[99002])
	}
	if len(plan.Warnings) != 2 {
		t.Fatalf("expected 2 priority warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}

func TestPlanUserAssetsImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanUserAssetsImport(strings.NewReader(`
INSERT INTO "native_user_assets" ("user_id","extra_spins","updated_at") VALUES(0,7,2000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:extra_spins:99003','-1',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99003','not-json',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserAssetsImport returned error: %v", err)
	}
	if len(plan.Users) != 0 || len(plan.Assets) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 3 {
		t.Fatalf("expected 3 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
