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

func TestApplyUserAssetsImportWritesUserAssets(t *testing.T) {
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

	plan, err := PlanUserAssetsImport(strings.NewReader(`
INSERT INTO "native_user_assets" ("user_id","extra_spins","updated_at") VALUES(99101,9,2000);
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(99101,'{"drawsAvailable":4}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:makeup_cards:99101','3',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyUserAssetsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.AssetsUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var extraSpins int64
	var cardDraws int64
	var makeupCards int64
	if err := db.QueryRow(ctx,
		`SELECT extra_spins, card_draws, makeup_cards FROM user_assets WHERE user_id = 99101`,
	).Scan(&extraSpins, &cardDraws, &makeupCards); err != nil {
		t.Fatalf("query imported user assets failed: %v", err)
	}
	if extraSpins != 9 || cardDraws != 4 || makeupCards != 3 {
		t.Fatalf("unexpected user assets: extra=%d card=%d makeup=%d", extraSpins, cardDraws, makeupCards)
	}
}
