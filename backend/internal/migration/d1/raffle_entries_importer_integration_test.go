//go:build integration

package d1

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/welfare"
)

func TestApplyRaffleEntriesImportWritesReadableRaffleDetail(t *testing.T) {
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

	suffix := time.Now().UnixNano()
	raffleID := fmt.Sprintf("import-raffle-entries-%d", suffix)
	missingRaffleID := fmt.Sprintf("missing-raffle-entries-%d", suffix)
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', '导入参与记录抽奖', '测试描述',
		           '[{"id":"p1","name":"积分","points":10,"quantity":1}]'::jsonb,
		           'threshold', 10, 'active', 0, 0, 0, 1000, 1000)`,
		raffleID,
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}

	plan, err := PlanRaffleEntriesImport(strings.NewReader(fmt.Sprintf(`
INSERT INTO "kv_lists" ("id","key","value") VALUES('entry-a-%[1]d','raffle:entries:%[2]s','{"id":"entry-a-%[1]d","userId":97001,"username":"alice","entryNumber":1,"createdAt":2000}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('entry-b-%[1]d','raffle:entries:%[2]s','{"id":"entry-b-%[1]d","userId":97002,"username":"bob","entryNumber":2,"createdAt":2100}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('entry-missing-%[1]d','raffle:entries:%[3]s','{"id":"entry-missing-%[1]d","userId":97003,"username":"carol","entryNumber":1,"createdAt":2200}');
`, suffix, raffleID, missingRaffleID)))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}

	result, err := ApplyRaffleEntriesImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.EntriesUpserted != 2 {
		t.Fatalf("expected 2 upserted entries, got %+v", result)
	}
	if len(result.Warnings) != 1 {
		t.Fatalf("expected warning for missing raffle, got %#v", result.Warnings)
	}

	userID := int64(97001)
	detail, err := welfare.NewService(db).GetRaffleDetail(ctx, raffleID, &userID)
	if err != nil {
		t.Fatalf("get raffle detail failed: %v", err)
	}
	if detail.Raffle.ID != raffleID || len(detail.Entries) != 2 {
		t.Fatalf("unexpected raffle detail: %+v", detail)
	}
	if detail.UserStatus == nil || !detail.UserStatus.HasJoined || detail.UserStatus.Entry == nil || detail.UserStatus.Entry.UserID != userID {
		t.Fatalf("unexpected user raffle status: %+v", detail.UserStatus)
	}
}
