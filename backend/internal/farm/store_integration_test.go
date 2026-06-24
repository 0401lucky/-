//go:build integration

package farm

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStoreReadsAndWritesFarmRuntimeTables(t *testing.T) {
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

	userID := int64(99471)
	cleanupFarmStoreUser(t, ctx, db, userID)
	defer cleanupFarmStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'farm_99471', 'farm_99471', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	missing, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("get missing state failed: %v", err)
	}
	if missing.Exists || missing.UserID != userID {
		t.Fatalf("unexpected missing state: %+v", missing)
	}

	createdAt := time.UnixMilli(1700000000000).UTC()
	if err := store.SaveState(ctx, StateRecord{
		UserID:       userID,
		StateJSON:    []byte(`{"userId":99471,"points":200,"lands":[]}`),
		LastTickAtMs: 1700000000100,
		UpdatedAtMs:  1700000000200,
		CreatedAt:    createdAt,
		UpdatedAt:    createdAt,
	}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	state, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("get saved state failed: %v", err)
	}
	if !state.Exists || state.UserID != userID || state.LastTickAtMs != 1700000000100 || state.UpdatedAtMs != 1700000000200 {
		t.Fatalf("unexpected saved state: %+v", state)
	}
	var stateBody struct {
		UserID int64 `json:"userId"`
		Points int64 `json:"points"`
	}
	if err := json.Unmarshal(state.StateJSON, &stateBody); err != nil {
		t.Fatalf("decode state json failed: %v", err)
	}
	if stateBody.UserID != userID || stateBody.Points != 200 {
		t.Fatalf("unexpected state json: %+v raw=%s", stateBody, string(state.StateJSON))
	}

	if _, err := db.Exec(ctx,
		`INSERT INTO farm_daily_shop_purchases
		   (user_id, purchase_date, item_key, purchase_count, updated_at_ms)
		 VALUES ($1, '2026-06-23', 'pet_food_normal', 2, 1700000000300)`,
		userID,
	); err != nil {
		t.Fatalf("insert daily purchase failed: %v", err)
	}
	purchases, err := store.ListDailyPurchases(ctx, userID, "2026-06-23")
	if err != nil {
		t.Fatalf("list daily purchases failed: %v", err)
	}
	if purchases["pet_food_normal"] != 2 {
		t.Fatalf("unexpected purchases: %+v", purchases)
	}
}

func cleanupFarmStoreUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM farm_water_email_dedupes WHERE user_id = $1`,
		`DELETE FROM farm_maturity_email_dedupes WHERE user_id = $1`,
		`DELETE FROM farm_daily_shop_purchases WHERE user_id = $1`,
		`DELETE FROM farm_states WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup farm store user %d failed: %v", userID, err)
		}
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
