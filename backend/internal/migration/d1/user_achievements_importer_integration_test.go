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

func TestApplyUserAchievementsImportWritesAchievementTables(t *testing.T) {
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

	plan, err := PlanUserAchievementsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievements:99301','[{"id":"beginner","source":"auto","grantedAt":1700000000000},{"id":"peak_first","source":"ranking_monthly","grantedAt":1700000000100,"expiresAt":1702592000000}]',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:equipped:99301','"peak_first"',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:forced:99301','{"id":"thief","until":1700003600000}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyUserAchievementsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.GrantsUpserted != 2 || result.EquippedUpserted != 1 || result.ForcedUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var grantCount int
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM user_achievement_grants WHERE user_id = 99301`,
	).Scan(&grantCount); err != nil {
		t.Fatalf("query grant count failed: %v", err)
	}
	if grantCount != 2 {
		t.Fatalf("unexpected grant count: %d", grantCount)
	}

	var equippedID string
	if err := db.QueryRow(ctx,
		`SELECT achievement_id FROM user_equipped_achievements WHERE user_id = 99301`,
	).Scan(&equippedID); err != nil {
		t.Fatalf("query equipped achievement failed: %v", err)
	}
	if equippedID != "peak_first" {
		t.Fatalf("unexpected equipped achievement: %s", equippedID)
	}

	var forcedID string
	var untilMs int64
	if err := db.QueryRow(ctx,
		`SELECT achievement_id, until_ms FROM user_forced_achievements WHERE user_id = 99301`,
	).Scan(&forcedID, &untilMs); err != nil {
		t.Fatalf("query forced achievement failed: %v", err)
	}
	if forcedID != "thief" || untilMs != 1700003600000 {
		t.Fatalf("unexpected forced achievement: id=%s until=%d", forcedID, untilMs)
	}
}
