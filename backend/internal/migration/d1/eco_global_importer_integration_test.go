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

func TestApplyEcoGlobalImportWritesStructuredEcoTables(t *testing.T) {
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

	plan, err := PlanEcoGlobalImport(strings.NewReader(`
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:global-prize-stock','diamond','2');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','[{"id":"pub-99311-1","key":"diamond","ownerUserId":99311,"ownerName":"Alice","ownerLotId":"lot-99311-1","publicAt":1000,"merchantAvailableAt":2000,"status":"stolen","thiefUserId":99312,"thiefName":"Bob","theftMessage":"test","stolenAt":3000}]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[{"id":"theft-99311-1","key":"coin","originalUserId":99311,"thiefUserId":99312,"publicEntryId":"pub-99311-1","originalLotId":"lot-99311-1","thiefLotId":"lot-99312-1","stolenAt":3000,"nextCheckAt":4000,"blackMarketAvailableAt":5000,"message":"test","resolvedAt":6000,"outcome":"caught"}]',NULL);
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','diamond','4');
INSERT INTO "kv_hashes" ("key","field","value") VALUES('eco:prize-claims:2026-06-23','total','5');
INSERT INTO "kv_zsets" ("key","member","score") VALUES('eco:trash-rank:daily:2026-06-23','u:99311',12);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyEcoGlobalImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 2 || result.GlobalPrizeStockUpserted != 1 || result.PublicPrizesUpserted != 1 || result.TheftsUpserted != 1 || result.PrizeClaimStatsUpserted != 2 || result.TrashRankingsUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var stockCount int64
	if err := db.QueryRow(ctx,
		`SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'`,
	).Scan(&stockCount); err != nil {
		t.Fatalf("query eco global prize stock failed: %v", err)
	}
	if stockCount != 2 {
		t.Fatalf("unexpected stock count: %d", stockCount)
	}

	var publicStatus string
	var publicThiefID int64
	if err := db.QueryRow(ctx,
		`SELECT status, thief_user_id FROM eco_public_prizes WHERE id = 'pub-99311-1'`,
	).Scan(&publicStatus, &publicThiefID); err != nil {
		t.Fatalf("query eco public prize failed: %v", err)
	}
	if publicStatus != "stolen" || publicThiefID != 99312 {
		t.Fatalf("unexpected public prize: status=%s thief=%d", publicStatus, publicThiefID)
	}

	var theftOutcome string
	if err := db.QueryRow(ctx,
		`SELECT outcome FROM eco_thefts WHERE id = 'theft-99311-1'`,
	).Scan(&theftOutcome); err != nil {
		t.Fatalf("query eco theft failed: %v", err)
	}
	if theftOutcome != "caught" {
		t.Fatalf("unexpected theft outcome: %s", theftOutcome)
	}

	var claimCount int64
	if err := db.QueryRow(ctx,
		`SELECT claim_count
		   FROM eco_prize_claim_stats
		  WHERE stat_date = '2026-06-23' AND prize_key = 'diamond'`,
	).Scan(&claimCount); err != nil {
		t.Fatalf("query eco prize claim stats failed: %v", err)
	}
	if claimCount != 4 {
		t.Fatalf("unexpected claim count: %d", claimCount)
	}

	var trashCleared int64
	if err := db.QueryRow(ctx,
		`SELECT trash_cleared
		   FROM eco_trash_rankings
		  WHERE period = 'daily' AND period_key = '2026-06-23' AND user_id = 99311`,
	).Scan(&trashCleared); err != nil {
		t.Fatalf("query eco trash ranking failed: %v", err)
	}
	if trashCleared != 12 {
		t.Fatalf("unexpected trash ranking score: %d", trashCleared)
	}

	emptyPlan, err := PlanEcoGlobalImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:public-prizes','[]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('eco:thefts','[]',NULL);
`))
	if err != nil {
		t.Fatalf("plan empty snapshot import failed: %v", err)
	}
	if _, err := ApplyEcoGlobalImport(ctx, db, emptyPlan); err != nil {
		t.Fatalf("apply empty snapshot import failed: %v", err)
	}

	var publicCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM eco_public_prizes`).Scan(&publicCount); err != nil {
		t.Fatalf("query eco public prize count failed: %v", err)
	}
	if publicCount != 0 {
		t.Fatalf("expected public prizes to be cleared, got %d", publicCount)
	}
	var theftCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM eco_thefts`).Scan(&theftCount); err != nil {
		t.Fatalf("query eco theft count failed: %v", err)
	}
	if theftCount != 0 {
		t.Fatalf("expected thefts to be cleared, got %d", theftCount)
	}
}
