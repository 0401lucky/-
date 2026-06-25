//go:build integration

package systemconfig

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestServiceUpdatesDailyPointsLimitAndTxReaderUsesPostgres(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过系统配置集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, systemConfigMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	defer func() {
		_, _ = db.Exec(ctx,
			`UPDATE system_config
			    SET daily_points_limit = 5000,
			        updated_at_ms = 1,
			        updated_by = NULL,
			        updated_at = now()
			  WHERE id = 'system'`,
		)
	}()

	updatedAt := time.Date(2026, 6, 25, 8, 0, 0, 0, time.UTC)
	limit := int64(6789)
	config, err := NewServiceWithNow(db, func() time.Time { return updatedAt }).Update(ctx, UpdateInput{
		DailyPointsLimit: &limit,
		UpdatedBy:        "admin",
	})
	if err != nil {
		t.Fatalf("update system config failed: %v", err)
	}
	if config.DailyPointsLimit != limit || config.UpdatedAt == nil || *config.UpdatedAt != updatedAt.UnixMilli() || config.UpdatedBy == nil || *config.UpdatedBy != "admin" {
		t.Fatalf("unexpected config after update: %+v", config)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx failed: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	txLimit, err := DailyPointsLimit(ctx, tx)
	if err != nil {
		t.Fatalf("read daily limit in tx failed: %v", err)
	}
	if txLimit != limit {
		t.Fatalf("unexpected tx daily limit: got %d want %d", txLimit, limit)
	}
}

func systemConfigMigrationsDir(t *testing.T) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	return filepath.Join(filepath.Dir(filename), "..", "..", "migrations")
}
