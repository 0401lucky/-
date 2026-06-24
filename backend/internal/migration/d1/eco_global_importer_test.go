package d1

import (
	"strings"
	"testing"
)

func TestPlanEcoGlobalImportParsesGlobalSources(t *testing.T) {
	plan, err := PlanEcoGlobalImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','diamond','2');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','coin','3');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','[{"id":"pub-1","key":"diamond","ownerUserId":99301,"ownerName":"Alice","ownerAvatarUrl":"https://example.com/a.png","ownerLotId":"lot-1","publicAt":1000,"merchantAvailableAt":2000,"status":"stolen","thiefUserId":99302,"thiefName":"Bob","theftMessage":"test","stolenAt":3000}]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[{"id":"theft-1","key":"coin","originalUserId":99301,"thiefUserId":99302,"publicEntryId":"pub-1","originalLotId":"lot-1","thiefLotId":"lot-2","stolenAt":3000,"nextCheckAt":4000,"blackMarketAvailableAt":5000,"message":"test","resolvedAt":6000,"outcome":"caught"}]',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','diamond','4');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','total','5');
INSERT INTO "kv_zsets" ("key","member","score") VALUES('eco:trash-rank:daily:2026-06-23','u:99301',12);
`))
	if err != nil {
		t.Fatalf("PlanEcoGlobalImport returned error: %v", err)
	}
	if len(plan.GlobalPrizeStock) != 2 || len(plan.PublicPrizes) != 1 || len(plan.Thefts) != 1 || len(plan.PrizeClaimStats) != 2 || len(plan.TrashRankings) != 1 {
		t.Fatalf("unexpected plan counts: stock=%d public=%d thefts=%d stats=%d rankings=%d",
			len(plan.GlobalPrizeStock),
			len(plan.PublicPrizes),
			len(plan.Thefts),
			len(plan.PrizeClaimStats),
			len(plan.TrashRankings),
		)
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected owner/thief placeholder users, got %d", len(plan.Users))
	}

	publicPrize := plan.PublicPrizes[0]
	if publicPrize.ID != "pub-1" || publicPrize.PrizeKey != "diamond" || publicPrize.OwnerUserID != 99301 || publicPrize.ThiefUserID == nil || *publicPrize.ThiefUserID != 99302 {
		t.Fatalf("unexpected public prize: %+v", publicPrize)
	}
	theft := plan.Thefts[0]
	if theft.ID != "theft-1" || theft.Outcome == nil || *theft.Outcome != "caught" || theft.ResolvedAtMs == nil || *theft.ResolvedAtMs != 6000 {
		t.Fatalf("unexpected theft: %+v", theft)
	}
	ranking := plan.TrashRankings[0]
	if ranking.Period != "daily" || ranking.PeriodKey != "2026-06-23" || ranking.UserID != 99301 || ranking.TrashCleared != 12 {
		t.Fatalf("unexpected ranking: %+v", ranking)
	}
}

func TestPlanEcoGlobalImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanEcoGlobalImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','bad','2');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[{"id":"bad","key":"coin"}]',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:bad-date','diamond','4');
INSERT INTO "kv_zsets" ("key","member","score") VALUES('eco:trash-rank:daily:2026-06-23','bad-user',12);
`))
	if err != nil {
		t.Fatalf("PlanEcoGlobalImport returned error: %v", err)
	}
	if len(plan.GlobalPrizeStock) != 0 || len(plan.PublicPrizes) != 0 || len(plan.Thefts) != 0 || len(plan.PrizeClaimStats) != 0 || len(plan.TrashRankings) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 5 {
		t.Fatalf("expected 5 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
