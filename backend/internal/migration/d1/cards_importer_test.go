package d1

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPlanCardsImportMergesNativeAndLegacyCardStates(t *testing.T) {
	plan, err := PlanCardsImport(strings.NewReader(`
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(99501,'{"inventory":["animal-s1-common-仓鼠"],"fragments":8,"pityRare":3,"pityLegendaryRare":9,"drawsAvailable":4,"collectionRewards":["album:s1:common"],"recentDraws":[{"cardId":"animal-s1-common-仓鼠","rarity":"common","isDuplicate":false,"fragmentsAdded":0,"timestamp":1700000000000}]}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99501','{"inventory":["animal-s1-rare-柴犬"],"fragments":12,"pityCounter":11,"drawsAvailable":2,"collectionRewards":["album:s1:rare"],"recentDraws":[{"cardId":"animal-s1-rare-柴犬","rarity":"rare","isDuplicate":false,"fragmentsAdded":0,"timestamp":1700000100000}]}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:rules:config','{"cardDrawPrice":900,"rarityProbabilities":{"common":65.5,"rare":25,"epic":7,"legendary":2,"legendary_rare":0.5},"pityThresholds":{"rare":10,"epic":50,"legendary":100,"legendary_rare":200},"fragmentValues":{"common":9,"rare":14,"epic":26,"legendary":50,"legendary_rare":100},"exchangePrices":{"common":30,"rare":80,"epic":200,"legendary":500,"legendary_rare":1000},"updatedAt":1700000200000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:album_rewards','{"animal-s1":123,"tarot":456}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:tier_rewards','{"common":5,"legendary_rare":88,"full_set":777}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanCardsImport returned error: %v", err)
	}
	if len(plan.Users) != 1 {
		t.Fatalf("expected 1 user, got %d", len(plan.Users))
	}
	if len(plan.States) != 1 {
		t.Fatalf("expected 1 state, got %d", len(plan.States))
	}
	if len(plan.Rules) != 1 {
		t.Fatalf("expected 1 rules record, got %d", len(plan.Rules))
	}
	if len(plan.AlbumRewards) != 2 {
		t.Fatalf("expected 2 album rewards, got %d", len(plan.AlbumRewards))
	}
	if len(plan.TierRewards) != 3 {
		t.Fatalf("expected 3 tier rewards, got %d", len(plan.TierRewards))
	}

	state := plan.States[0]
	if state.UserID != 99501 || state.Fragments != 12 || state.PityRare != 3 || state.PityLegendaryRare != 11 || state.DrawsAvailable != 4 {
		t.Fatalf("unexpected merged state: %+v", state)
	}
	var inventory []string
	if err := json.Unmarshal([]byte(state.InventoryJSON), &inventory); err != nil {
		t.Fatalf("decode inventory failed: %v", err)
	}
	if len(inventory) != 2 || inventory[0] != "animal-s1-common-仓鼠" || inventory[1] != "animal-s1-rare-柴犬" {
		t.Fatalf("unexpected merged inventory: %#v", inventory)
	}
	var rewards []string
	if err := json.Unmarshal([]byte(state.CollectionRewardsJSON), &rewards); err != nil {
		t.Fatalf("decode rewards failed: %v", err)
	}
	if len(rewards) != 2 {
		t.Fatalf("expected merged rewards, got %#v", rewards)
	}
	var draws []importedRecentCardDraw
	if err := json.Unmarshal([]byte(state.RecentDrawsJSON), &draws); err != nil {
		t.Fatalf("decode recent draws failed: %v", err)
	}
	if len(draws) != 2 || draws[0].CardID != "animal-s1-rare-柴犬" {
		t.Fatalf("recent draws should be sorted newest first, got %#v", draws)
	}

	rules := plan.Rules[0]
	if rules.ID != "default" || rules.CardDrawPrice != 900 || rules.UpdatedAtMs != 1700000200000 {
		t.Fatalf("unexpected rules: %+v", rules)
	}
	if plan.AlbumRewards[0].AlbumID != "animal-s1" || plan.AlbumRewards[0].RewardPoints != 123 {
		t.Fatalf("unexpected album rewards: %+v", plan.AlbumRewards)
	}
	if plan.TierRewards[0].RewardType != "common" || plan.TierRewards[0].RewardPoints != 5 {
		t.Fatalf("unexpected tier rewards: %+v", plan.TierRewards)
	}
	if len(plan.Warnings) != 1 {
		t.Fatalf("expected 1 merge warning, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}

func TestPlanCardsImportSkipsInvalidRowsAndDefaultsRules(t *testing.T) {
	plan, err := PlanCardsImport(strings.NewReader(`
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(0,'{}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:bad','{}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:user:99502','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:rules:config','{"cardDrawPrice":0,"rarityProbabilities":[]}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:album_rewards','{"":10,"animal-s1":-1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:tier_rewards','{"bad":1,"common":-1}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanCardsImport returned error: %v", err)
	}
	if len(plan.Users) != 0 || len(plan.States) != 0 {
		t.Fatalf("invalid card user states should be skipped: %+v", plan)
	}
	if len(plan.Rules) != 1 {
		t.Fatalf("rules should be imported with defaults, got %d", len(plan.Rules))
	}
	if len(plan.AlbumRewards) != 0 || len(plan.TierRewards) != 0 {
		t.Fatalf("invalid rewards should be skipped: album=%+v tier=%+v", plan.AlbumRewards, plan.TierRewards)
	}
	if plan.Rules[0].CardDrawPrice != 900 {
		t.Fatalf("invalid cardDrawPrice should default to 900, got %d", plan.Rules[0].CardDrawPrice)
	}
	if len(plan.Warnings) < 8 {
		t.Fatalf("expected warnings for invalid rows/defaults, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
