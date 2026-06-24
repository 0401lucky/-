//go:build integration

package d1

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/welfare"
)

func TestApplyPublicListImportWritesReadableWelfareLists(t *testing.T) {
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
	projectID := fmt.Sprintf("import-project-%d", suffix)
	raffleID := fmt.Sprintf("import-raffle-%d", suffix)
	createdAt := time.Now().UnixMilli() + 1_000_000_000
	plan, err := PlanPublicListImport(strings.NewReader(fmt.Sprintf(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('projects:%s','{"id":"%s","name":"导入项目","description":"说明","maxClaims":10,"claimedCount":1,"codesCount":9,"status":"active","createdAt":%d,"createdBy":"admin","rewardType":"code"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('raffle:%s','{"id":"%s","mode":"draw","title":"导入抽奖","description":"说明","prizes":[{"id":"p1","name":"10积分","points":10,"quantity":1}],"triggerType":"threshold","threshold":3,"status":"active","participantsCount":1,"winnersCount":0,"createdBy":100,"createdAt":%d,"updatedAt":%d}',NULL);
`, projectID, projectID, createdAt, raffleID, raffleID, createdAt, createdAt+200)))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyPublicListImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.ProjectsUpserted != 1 || result.RafflesUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	service := welfare.NewService(db)
	projects, err := service.ListProjects(ctx)
	if err != nil {
		t.Fatalf("list projects failed: %v", err)
	}
	if !containsProject(projects, projectID) {
		t.Fatalf("imported project not readable through welfare service")
	}

	raffles, err := service.ListRaffles(ctx, welfare.RaffleListFilter{ActiveOnly: true})
	if err != nil {
		t.Fatalf("list raffles failed: %v", err)
	}
	if !containsRaffle(raffles, raffleID) {
		t.Fatalf("imported raffle not readable through welfare service")
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()

	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "migrations")
}

func containsProject(projects []welfare.Project, id string) bool {
	for _, project := range projects {
		if project.ID == id {
			return true
		}
	}
	return false
}

func containsRaffle(raffles []welfare.RaffleListItem, id string) bool {
	for _, raffle := range raffles {
		if raffle.ID == id {
			return true
		}
	}
	return false
}
