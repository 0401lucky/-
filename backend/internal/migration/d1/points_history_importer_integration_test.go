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

func TestApplyPointsHistoryImportWritesLedgerAndDailyStats(t *testing.T) {
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

	plan, err := PlanPointsHistoryImport(strings.NewReader(`
INSERT INTO "native_user_point_logs" ("id","user_id","amount","source","description","balance","created_at") VALUES('import-log-1',94001,15,'game_play','导入游戏奖励',115,1000);
INSERT INTO "native_user_daily_game_points" ("user_id","stat_date","earned_points","updated_at") VALUES(94001,'2026-06-22',25,2000);
INSERT INTO "kv_lists" ("id","key","value") VALUES(1,'points_log:94002','{"id":"import-log-2","amount":-7,"source":"exchange","description":"导入兑换","balance":93,"createdAt":3000}');
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('game:daily_earned:94002:2026-06-22','35',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyPointsHistoryImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 2 || result.PointLogsUpserted != 2 || result.DailyGamePointsUpserted != 2 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var amount int64
	var balanceAfter int64
	if err := db.QueryRow(ctx,
		`SELECT amount, balance_after FROM point_ledger WHERE id = 'import-log-2'`,
	).Scan(&amount, &balanceAfter); err != nil {
		t.Fatalf("query imported point log failed: %v", err)
	}
	if amount != -7 || balanceAfter != 93 {
		t.Fatalf("unexpected point log values: amount=%d balance=%d", amount, balanceAfter)
	}

	var earned int64
	if err := db.QueryRow(ctx,
		`SELECT earned_points FROM daily_game_points WHERE user_id = 94002 AND stat_date = '2026-06-22'`,
	).Scan(&earned); err != nil {
		t.Fatalf("query imported daily game points failed: %v", err)
	}
	if earned != 35 {
		t.Fatalf("unexpected daily game points: %d", earned)
	}
}
