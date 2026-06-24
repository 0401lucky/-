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

func TestApplyUserProfilesImportWritesCustomProfiles(t *testing.T) {
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

	plan, err := PlanUserProfilesImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99201','{"displayName":"  Alice  ","avatarUrl":"data:image/webp;base64,AAAA","qqEmail":"123456@QQ.com","updatedAt":1700000000000}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyUserProfilesImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.ProfilesUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var username string
	if err := db.QueryRow(ctx, `SELECT username FROM users WHERE id = 99201`).Scan(&username); err != nil {
		t.Fatalf("query placeholder user failed: %v", err)
	}
	if username != "user_99201" {
		t.Fatalf("unexpected placeholder username: %s", username)
	}

	var displayName string
	var avatarURL string
	var qqEmail string
	var updatedAtMs int64
	if err := db.QueryRow(ctx,
		`SELECT display_name, avatar_url, qq_email, updated_at_ms
		   FROM user_profiles
		  WHERE user_id = 99201`,
	).Scan(&displayName, &avatarURL, &qqEmail, &updatedAtMs); err != nil {
		t.Fatalf("query imported user profile failed: %v", err)
	}
	if displayName != "Alice" || avatarURL != "data:image/webp;base64,AAAA" || qqEmail != "123456@qq.com" || updatedAtMs != 1700000000000 {
		t.Fatalf("unexpected user profile: display=%q avatar=%q qq=%q updated=%d", displayName, avatarURL, qqEmail, updatedAtMs)
	}
}
