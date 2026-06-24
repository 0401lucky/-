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

func TestApplyFarmV2ImportWritesRuntimeState(t *testing.T) {
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

	userID := int64(99451)
	if _, err := db.Exec(ctx, `DELETE FROM farm_water_email_dedupes WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup water emails failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM farm_maturity_email_dedupes WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup maturity emails failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM farm_daily_shop_purchases WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup daily purchases failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM farm_states WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup farm state failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("cleanup user failed: %v", err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM farm_water_email_dedupes WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM farm_maturity_email_dedupes WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM farm_daily_shop_purchases WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM farm_states WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	plan, err := PlanFarmV2Import(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:state:99451','{"userId":99451,"points":300,"lands":[],"lastTickAt":1700000000000,"createdAt":1699999900000,"updatedAt":1700000100000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:shop:daily:99451:2026-06-23:pet_food_normal','2',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:mature-mail:sent:99451:event-1','{"claimedAt":1700000200000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('farmv2:water-mail:sent:99451:2:1700000000000:1700000300000:1','{"claimedAt":1700000400000}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyFarmV2Import(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.StatesUpserted != 1 || result.DailyPurchasesUpserted != 1 || result.MaturityEmailsUpserted != 1 || result.WaterEmailsUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var points int64
	var dailyCount int64
	var maturitySentAt int64
	var waterSentAt int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT (state_json->>'points')::bigint FROM farm_states WHERE user_id = $1),
		   (SELECT purchase_count FROM farm_daily_shop_purchases WHERE user_id = $1 AND item_key = 'pet_food_normal'),
		   (SELECT sent_at_ms FROM farm_maturity_email_dedupes WHERE user_id = $1 AND event_id = 'event-1'),
		   (SELECT sent_at_ms FROM farm_water_email_dedupes WHERE user_id = $1 AND land_index = 2)`,
		userID,
	).Scan(&points, &dailyCount, &maturitySentAt, &waterSentAt); err != nil {
		t.Fatalf("query imported farm data failed: %v", err)
	}
	if points != 300 || dailyCount != 2 || maturitySentAt != 1700000200000 || waterSentAt != 1700000400000 {
		t.Fatalf("unexpected imported farm data points=%d daily=%d maturity=%d water=%d", points, dailyCount, maturitySentAt, waterSentAt)
	}

	again, err := ApplyFarmV2Import(ctx, db, plan)
	if err != nil {
		t.Fatalf("repeat apply import failed: %v", err)
	}
	if again.StatesUpserted != 1 {
		t.Fatalf("repeat import should upsert 1 state, got %+v", again)
	}
	var total int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM farm_states WHERE user_id = $1`, userID).Scan(&total); err != nil {
		t.Fatalf("query farm state total failed: %v", err)
	}
	if total != 1 {
		t.Fatalf("repeat import should keep 1 state, got %d", total)
	}
}
