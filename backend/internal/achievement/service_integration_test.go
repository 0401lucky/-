//go:build integration

package achievement

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestGrantAndForceEquipPersistsThiefAchievement(t *testing.T) {
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

	userID := int64(99701)
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("cleanup user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'achievement_99701', 'achievement_99701', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx failed: %v", err)
	}
	if err := GrantAndForceEquip(ctx, tx, userID, IDThief, 1000, 2000, "环保行动偷盗被警察抓住"); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("grant achievement failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit tx failed: %v", err)
	}

	tx, err = db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin second tx failed: %v", err)
	}
	if err := GrantAndForceEquip(ctx, tx, userID, IDThief, 1500, 3000, "环保行动偷盗被警察抓住"); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("extend achievement failed: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit second tx failed: %v", err)
	}

	var grantID string
	var source string
	var grantedAt int64
	var expiresAt int64
	var equippedID string
	var forcedID string
	var forcedUntil int64
	if err := db.QueryRow(ctx,
		`SELECT g.achievement_id, g.source, g.granted_at_ms, COALESCE(g.expires_at_ms, 0),
		        e.achievement_id, f.achievement_id, f.until_ms
		   FROM user_achievement_grants g
		   JOIN user_equipped_achievements e ON e.user_id = g.user_id
		   JOIN user_forced_achievements f ON f.user_id = g.user_id
		  WHERE g.user_id = $1 AND g.achievement_id = 'thief'`,
		userID,
	).Scan(&grantID, &source, &grantedAt, &expiresAt, &equippedID, &forcedID, &forcedUntil); err != nil {
		t.Fatalf("query achievement failed: %v", err)
	}
	if grantID != IDThief || source != SourceAuto || grantedAt != 1000 || expiresAt != 3000 || equippedID != IDThief || forcedID != IDThief || forcedUntil != 3000 {
		t.Fatalf("unexpected achievement rows: grant=%s source=%s granted=%d expires=%d equipped=%s forced=%s until=%d",
			grantID, source, grantedAt, expiresAt, equippedID, forcedID, forcedUntil)
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
