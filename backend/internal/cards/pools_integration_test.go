//go:build integration

package cards

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLimitedPoolMigrationAndTransactions(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}
	parentDB, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer parentDB.Close()
	schema := fmt.Sprintf("cards_limited_%d", time.Now().UnixNano())
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := parentDB.Exec(ctx, "CREATE SCHEMA "+quotedSchema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = parentDB.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE") }()
	poolConfig := parentDB.Config()
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runner := pgmigration.NewRunner(db, migrationsDir(t))
	if _, err := runner.Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}
	store := NewStore(db)
	initial, err := store.GetRules(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// 独立 schema 验证首次迁移，避免其他集成测试清理全局规则的影响。
	if !initial.LimitedPool.Enabled || initial.LimitedPool.AlbumID != hokModernAlbumID || initial.LimitedPool.DrawCost != 2 || initial.LimitedPool.EndsAt <= initial.LimitedPool.StartsAt {
		t.Fatalf("migration should open HOK limited pool: %+v", initial.LimitedPool)
	}
	var expectedEnd int64
	if err := db.QueryRow(ctx, `SELECT (extract(epoch FROM (((to_timestamp($1::double precision / 1000) AT TIME ZONE 'Asia/Shanghai') + interval '1 month') AT TIME ZONE 'Asia/Shanghai')) * 1000)::bigint`, initial.LimitedPool.StartsAt).Scan(&expectedEnd); err != nil {
		t.Fatal(err)
	}
	if delta := initial.LimitedPool.EndsAt - expectedEnd; delta < -1 || delta > 1 {
		t.Fatalf("migration should use one calendar month: %+v, expected end=%d", initial.LimitedPool, expectedEnd)
	}
	if _, err := runner.Apply(ctx, false); err != nil {
		t.Fatal(err)
	}
	reloaded, err := store.GetRules(ctx)
	if err != nil || reloaded.LimitedPool != initial.LimitedPool {
		t.Fatalf("reapplying migrations must not extend the window: %+v, error=%v", reloaded.LimitedPool, err)
	}

	userID := int64(99931)
	if _, err := db.Exec(ctx, `INSERT INTO users (id, username, display_name, first_seen_at, updated_at) VALUES ($1, 'limited_pool_test', 'Limited Pool Test', now(), now())`, userID); err != nil {
		t.Fatal(err)
	}
	defer cleanupCardStoreUser(t, ctx, db, userID)
	state := DefaultUserState(userID)
	state.DrawsAvailable = 10
	if err := store.SaveUserState(ctx, state); err != nil {
		t.Fatal(err)
	}
	admin := NewAdminService(db)
	pool := initial.LimitedPool
	nowMs := time.Now().UnixMilli()
	pool.StartsAt = nowMs - 3600000
	pool.EndsAt = nowMs + 3600000
	saved, err := admin.UpdateRules(ctx, AdminRulesUpdateInput{LimitedPool: &pool, NowMs: nowMs})
	if err != nil {
		t.Fatal(err)
	}
	reloaded, err = store.GetRules(ctx)
	if err != nil || reloaded.LimitedPool != pool {
		t.Fatalf("admin settings were not persisted: %+v, error=%v", reloaded.LimitedPool, err)
	}
	service := NewServiceWithRandom(db, &fixedRandom{floats: []float64{0.99}})
	result, err := service.ExecuteDraws(ctx, DrawCardsInput{UserID: userID, PoolID: DrawPoolLimited, Count: 5, Catalog: AllCards(), RulesUpdatedAt: &saved.UpdatedAtMs})
	if err != nil || !result.Success || result.DrawsConsumed != 10 || result.DrawsAvailable != 0 || len(result.Results) != 5 {
		t.Fatalf("five draws should atomically consume 10: %+v, error=%v", result, err)
	}
	state, err = store.GetUserState(ctx, userID)
	if err != nil || state.DrawsAvailable != 0 || state.PityEpic != 5 || len(state.RecentDraws) != 5 {
		t.Fatalf("draw state was not persisted: %+v, error=%v", state, err)
	}
	var logCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil || logCount != 5 {
		t.Fatalf("expected five draw logs, got %d, error=%v", logCount, err)
	}

	state.DrawsAvailable = 3
	if err := store.SaveUserState(ctx, state); err != nil {
		t.Fatal(err)
	}
	before, _ := store.GetUserState(ctx, userID)
	assertRejected := func(input DrawCardsInput, message string) {
		t.Helper()
		result, err := service.ExecuteDraws(ctx, input)
		if err != nil || result.Success || !strings.Contains(result.Message, message) {
			t.Fatalf("expected rejection %q: %+v, error=%v", message, result, err)
		}
		after, err := store.GetUserState(ctx, userID)
		if err != nil || !reflect.DeepEqual(before, after) {
			t.Fatalf("rejected request changed state: before=%+v after=%+v, error=%v", before, after, err)
		}
	}
	input := DrawCardsInput{UserID: userID, PoolID: DrawPoolLimited, Count: 5, Catalog: AllCards()}
	assertRejected(input, "需要10次")
	oldVersion := saved.UpdatedAtMs - 1
	input.Count, input.RulesUpdatedAt = 1, &oldVersion
	assertRejected(input, "配置已更新")
	input.RulesUpdatedAt = nil
	for _, status := range []string{"disabled", "upcoming", "expired"} {
		closed := pool
		switch status {
		case "disabled":
			closed.Enabled = false
		case "upcoming":
			closed.StartsAt, closed.EndsAt = nowMs+3600000, nowMs+7200000
		case "expired":
			closed.StartsAt, closed.EndsAt = nowMs-7200000, nowMs-3600000
		}
		if _, err := admin.UpdateRules(ctx, AdminRulesUpdateInput{LimitedPool: &closed}); err != nil {
			t.Fatal(err)
		}
		assertRejected(input, "限定卡池未开放")
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil || logCount != 5 {
		t.Fatalf("rejected requests must not add logs: %d, error=%v", logCount, err)
	}
	if _, err := admin.UpdateRules(ctx, AdminRulesUpdateInput{LimitedPool: &pool}); err != nil {
		t.Fatal(err)
	}
	// 部分更新全局规则不能丢失已经保存的限定池配置。
	price := int64(800)
	updated, err := admin.UpdateRules(ctx, AdminRulesUpdateInput{CardDrawPrice: &price})
	if err != nil || updated.LimitedPool != pool {
		t.Fatalf("partial rule update lost limited pool: %+v, error=%v", updated, err)
	}

	start := make(chan struct{})
	results := make(chan struct {
		result DrawCardsResult
		err    error
	}, 4)
	for range 4 {
		go func() {
			<-start
			result, err := NewServiceWithRandom(db, &fixedRandom{floats: []float64{0.99}}).ExecuteDraws(ctx, input)
			results <- struct {
				result DrawCardsResult
				err    error
			}{result, err}
		}()
	}
	close(start)
	successes := 0
	for range 4 {
		outcome := <-results
		if outcome.err != nil {
			t.Fatal(outcome.err)
		}
		if outcome.result.Success {
			successes++
		}
	}
	after, err := store.GetUserState(ctx, userID)
	if err != nil || successes != 1 || after.DrawsAvailable != 1 {
		t.Fatalf("concurrent draws overspent balance: successes=%d state=%+v, error=%v", successes, after, err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil || logCount != 6 {
		t.Fatalf("only one concurrent draw may write a log: %d, error=%v", logCount, err)
	}
}
