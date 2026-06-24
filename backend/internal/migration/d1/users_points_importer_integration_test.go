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

func TestApplyUsersPointsImportWritesUsersAndBalances(t *testing.T) {
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

	plan, err := PlanUsersPointsImport(strings.NewReader(`
INSERT INTO "native_users" ("user_id","username","first_seen","updated_at") VALUES(91001,'import_alice',1000,2000);
INSERT INTO "native_user_points" ("user_id","balance","updated_at") VALUES(91001,321,2000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:91002','66',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyUsersPointsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 2 || result.PointAccountsUpserted != 2 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var username string
	var balance int64
	if err := db.QueryRow(ctx,
		`SELECT u.username, p.balance
		 FROM users u
		 JOIN point_accounts p ON p.user_id = u.id
		 WHERE u.id = 91001`,
	).Scan(&username, &balance); err != nil {
		t.Fatalf("query imported native user failed: %v", err)
	}
	if username != "import_alice" || balance != 321 {
		t.Fatalf("unexpected imported native user: username=%s balance=%d", username, balance)
	}

	if err := db.QueryRow(ctx,
		`SELECT u.username, p.balance
		 FROM users u
		 JOIN point_accounts p ON p.user_id = u.id
		 WHERE u.id = 91002`,
	).Scan(&username, &balance); err != nil {
		t.Fatalf("query imported legacy point user failed: %v", err)
	}
	if username != "user_91002" || balance != 66 {
		t.Fatalf("unexpected imported legacy user: username=%s balance=%d", username, balance)
	}
}
