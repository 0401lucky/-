//go:build integration

package cards

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestStoreReadsAndWritesCardTables(t *testing.T) {
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
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99701', 'cards_99701', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	missing, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get missing state failed: %v", err)
	}
	if missing.Exists || missing.UserID != userID || missing.DrawsAvailable != 1 {
		t.Fatalf("unexpected missing state: %+v", missing)
	}

	createdAt := time.UnixMilli(1700000000000).UTC()
	if err := store.SaveUserState(ctx, UserState{
		UserID:            userID,
		Inventory:         []string{"animal-s1-common-仓鼠", "animal-s1-common-仓鼠", ""},
		Fragments:         12,
		PityRare:          3,
		PityLegendaryRare: 11,
		DrawsAvailable:    4,
		CollectionRewards: []string{"album:s1:common"},
		RecentDraws: []RecentDraw{{
			CardID:         "animal-s1-common-仓鼠",
			Rarity:         RarityCommon,
			IsDuplicate:    false,
			FragmentsAdded: 0,
			Timestamp:      1700000000000,
		}},
		RawState:  map[string]any{"source": "integration"},
		CreatedAt: createdAt,
		UpdatedAt: createdAt,
	}); err != nil {
		t.Fatalf("save state failed: %v", err)
	}

	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get saved state failed: %v", err)
	}
	if !state.Exists || state.Fragments != 12 || state.PityRare != 3 || state.PityLegendaryRare != 11 || state.DrawsAvailable != 4 {
		t.Fatalf("unexpected saved state: %+v", state)
	}
	if len(state.Inventory) != 1 || state.Inventory[0] != "animal-s1-common-仓鼠" {
		t.Fatalf("inventory should be normalized, got %#v", state.Inventory)
	}
	if len(state.RecentDraws) != 1 || state.RecentDraws[0].Rarity != RarityCommon {
		t.Fatalf("unexpected recent draws: %#v", state.RecentDraws)
	}

	defaultRules, err := store.GetRules(ctx)
	if err != nil {
		t.Fatalf("get default rules failed: %v", err)
	}
	if defaultRules.CardDrawPrice != 900 || defaultRules.PityThresholds[RarityLegendaryRare] != 200 {
		t.Fatalf("unexpected default rules: %+v", defaultRules)
	}

	if _, err := db.Exec(ctx,
		`INSERT INTO card_rules (
		   id, rarity_probabilities, pity_thresholds, card_draw_price,
		   fragment_values, exchange_prices, config_json, updated_at_ms
		 ) VALUES (
		   'default',
		   '{"common":60,"rare":30,"epic":7,"legendary":2,"legendary_rare":1}'::jsonb,
		   '{"rare":9,"epic":40,"legendary":90,"legendary_rare":180}'::jsonb,
		   800,
		   '{"common":8,"rare":13,"epic":25,"legendary":45,"legendary_rare":90}'::jsonb,
		   '{"common":20,"rare":70,"epic":180,"legendary":450,"legendary_rare":900}'::jsonb,
		   '{}'::jsonb,
		   1700000200000
		 )
		 ON CONFLICT (id) DO UPDATE SET
		   rarity_probabilities = excluded.rarity_probabilities,
		   pity_thresholds = excluded.pity_thresholds,
		   card_draw_price = excluded.card_draw_price,
		   fragment_values = excluded.fragment_values,
		   exchange_prices = excluded.exchange_prices,
		   config_json = excluded.config_json,
		   updated_at_ms = excluded.updated_at_ms`,
	); err != nil {
		t.Fatalf("insert rules failed: %v", err)
	}
	rules, err := store.GetRules(ctx)
	if err != nil {
		t.Fatalf("get imported rules failed: %v", err)
	}
	if rules.CardDrawPrice != 800 || rules.RarityProbabilities[RarityCommon] != 60 || rules.ExchangePrices[RarityLegendaryRare] != 900 {
		t.Fatalf("unexpected imported rules: %+v", rules)
	}
}

func TestServiceExecuteDrawsPersistsStateAndLogs(t *testing.T) {
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

	userID := int64(99702)
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99702', 'cards_99702', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:         userID,
		Inventory:      []string{"common-1"},
		DrawsAvailable: 2,
		RawState:       map[string]any{"source": "service-test"},
	}); err != nil {
		t.Fatalf("save initial state failed: %v", err)
	}

	service := NewServiceWithRandom(db, &fixedRandom{
		floats: []float64{0.99},
		ints:   []int{0},
	})
	result, err := service.ExecuteDraws(ctx, DrawCardsInput{
		UserID:      userID,
		Count:       1,
		Catalog:     testCatalog(),
		DrawGroupID: "service-draw-99702",
		NowMs:       1700000100000,
	})
	if err != nil {
		t.Fatalf("execute draws failed: %v", err)
	}
	if !result.Success || result.DrawsAvailable != 1 || len(result.Results) != 1 || !result.Results[0].IsDuplicate {
		t.Fatalf("unexpected draw result: %+v", result)
	}

	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after draw failed: %v", err)
	}
	if state.DrawsAvailable != 1 || state.Fragments != DefaultRules().FragmentValues[RarityCommon] || len(state.Inventory) != 1 {
		t.Fatalf("unexpected state after draw: %+v", state)
	}
	if len(state.RecentDraws) != 1 || !state.RecentDraws[0].IsDuplicate || state.RecentDraws[0].Timestamp != 1700000100000 {
		t.Fatalf("unexpected recent draws after draw: %#v", state.RecentDraws)
	}

	var logCount int
	var isDuplicate bool
	var fragmentsAdded int64
	var createdAtMs int64
	if err := db.QueryRow(ctx,
		`SELECT count(*), bool_or(is_duplicate), COALESCE(sum(fragments_added), 0), max(created_at_ms)
		   FROM card_draw_logs
		  WHERE user_id = $1 AND draw_group_id = 'service-draw-99702'`,
		userID,
	).Scan(&logCount, &isDuplicate, &fragmentsAdded, &createdAtMs); err != nil {
		t.Fatalf("query draw logs failed: %v", err)
	}
	if logCount != 1 || !isDuplicate || fragmentsAdded != DefaultRules().FragmentValues[RarityCommon] || createdAtMs != 1700000100000 {
		t.Fatalf("unexpected draw log summary: count=%d duplicate=%v fragments=%d created=%d", logCount, isDuplicate, fragmentsAdded, createdAtMs)
	}
}

func TestServiceExecuteDrawsCreatesMissingStateAndRejectsInsufficientDraws(t *testing.T) {
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

	userID := int64(99703)
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99703', 'cards_99703', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	service := NewServiceWithRandom(db, &fixedRandom{
		floats: []float64{0.99},
		ints:   []int{0},
	})
	first, err := service.ExecuteDraws(ctx, DrawCardsInput{
		UserID:      userID,
		Count:       1,
		Catalog:     testCatalog(),
		DrawGroupID: "service-draw-99703-first",
		NowMs:       1700000200000,
	})
	if err != nil {
		t.Fatalf("execute first draw failed: %v", err)
	}
	if !first.Success || first.DrawsAvailable != 0 {
		t.Fatalf("unexpected first draw result: %+v", first)
	}

	second, err := service.ExecuteDraws(ctx, DrawCardsInput{
		UserID:      userID,
		Count:       1,
		Catalog:     testCatalog(),
		DrawGroupID: "service-draw-99703-second",
		NowMs:       1700000201000,
	})
	if err != nil {
		t.Fatalf("execute insufficient draw failed: %v", err)
	}
	if second.Success || second.DrawsAvailable != 0 || second.Message == "" {
		t.Fatalf("expected insufficient draw result, got %+v", second)
	}

	var secondLogCount int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM card_draw_logs WHERE user_id = $1 AND draw_group_id = 'service-draw-99703-second'`,
		userID,
	).Scan(&secondLogCount); err != nil {
		t.Fatalf("query insufficient draw logs failed: %v", err)
	}
	if secondLogCount != 0 {
		t.Fatalf("insufficient draw should not write logs, got %d", secondLogCount)
	}
}

func TestServiceExecuteFragmentExchangePersistsState(t *testing.T) {
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

	userID := int64(99704)
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99704', 'cards_99704', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:         userID,
		Fragments:      100,
		DrawsAvailable: 1,
		RawState:       map[string]any{},
	}); err != nil {
		t.Fatalf("save initial state failed: %v", err)
	}

	result, err := NewService(db).ExecuteFragmentExchange(ctx, FragmentExchangeInput{
		UserID:  userID,
		CardID:  "rare-1",
		Catalog: testCatalog(),
	})
	if err != nil {
		t.Fatalf("execute fragment exchange failed: %v", err)
	}
	if !result.Success || result.Fragments != 20 || result.FragmentsCost != DefaultRules().ExchangePrices[RarityRare] {
		t.Fatalf("unexpected exchange result: %+v", result)
	}

	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after exchange failed: %v", err)
	}
	if state.Fragments != 20 || len(state.Inventory) != 1 || state.Inventory[0] != "rare-1" {
		t.Fatalf("unexpected state after exchange: %+v", state)
	}
}

func TestServiceExecuteFragmentExchangeRejectsInsufficientWithoutWriting(t *testing.T) {
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

	userID := int64(99705)
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99705', 'cards_99705', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:         userID,
		Fragments:      79,
		DrawsAvailable: 1,
		RawState:       map[string]any{},
	}); err != nil {
		t.Fatalf("save initial state failed: %v", err)
	}

	result, err := NewService(db).ExecuteFragmentExchange(ctx, FragmentExchangeInput{
		UserID:  userID,
		CardID:  "rare-1",
		Catalog: testCatalog(),
	})
	if err != nil {
		t.Fatalf("execute insufficient exchange failed: %v", err)
	}
	if result.Success || result.Message != "碎片不足" || result.Fragments != 79 {
		t.Fatalf("unexpected insufficient exchange result: %+v", result)
	}

	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after insufficient exchange failed: %v", err)
	}
	if state.Fragments != 79 || len(state.Inventory) != 0 {
		t.Fatalf("insufficient exchange should not write state, got %+v", state)
	}
}

func TestServiceExecuteRewardClaimGrantsPointsAndPreventsDuplicate(t *testing.T) {
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

	userID := int64(99706)
	cleanupCardStoreUser(t, ctx, db, userID)
	defer cleanupCardStoreUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_99706', 'cards_99706', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:            userID,
		Inventory:         []string{"common-1"},
		DrawsAvailable:    1,
		CollectionRewards: []string{},
		RawState:          map[string]any{},
	}); err != nil {
		t.Fatalf("save initial state failed: %v", err)
	}

	service := NewService(db)
	first, err := service.ExecuteRewardClaim(ctx, RewardClaimServiceInput{
		UserID:        userID,
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityCommon),
		PointsAwarded: 400,
		Catalog:       testCatalog(),
		NowMs:         1700000300000,
	})
	if err != nil {
		t.Fatalf("execute reward claim failed: %v", err)
	}
	if !first.Success || first.PointsAwarded != 400 || first.NewBalance != 400 || first.RewardKey != "album:album-1:common" {
		t.Fatalf("unexpected first reward claim: %+v", first)
	}

	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after reward claim failed: %v", err)
	}
	if len(state.CollectionRewards) != 1 || state.CollectionRewards[0] != "album:album-1:common" {
		t.Fatalf("unexpected collection rewards after claim: %#v", state.CollectionRewards)
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query point balance failed: %v", err)
	}
	if balance != 400 {
		t.Fatalf("unexpected balance after reward claim: %d", balance)
	}

	var claimCount int
	var ledgerCount int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM card_reward_claims
		  WHERE user_id = $1 AND album_id = 'album-1' AND reward_type = 'common' AND points_awarded = 400`,
		userID,
	).Scan(&claimCount); err != nil {
		t.Fatalf("query reward claims failed: %v", err)
	}
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM point_ledger WHERE user_id = $1 AND source = 'card_collection' AND amount = 400`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query point ledger failed: %v", err)
	}
	if claimCount != 1 || ledgerCount != 1 {
		t.Fatalf("unexpected claim/ledger counts: claim=%d ledger=%d", claimCount, ledgerCount)
	}

	duplicate, err := service.ExecuteRewardClaim(ctx, RewardClaimServiceInput{
		UserID:        userID,
		AlbumID:       "album-1",
		RewardType:    RewardType(RarityCommon),
		PointsAwarded: 400,
		Catalog:       testCatalog(),
		NowMs:         1700000301000,
	})
	if err != nil {
		t.Fatalf("execute duplicate reward claim failed: %v", err)
	}
	if duplicate.Success || duplicate.Message != "该奖励已领取" {
		t.Fatalf("unexpected duplicate reward claim: %+v", duplicate)
	}
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query point balance after duplicate failed: %v", err)
	}
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM point_ledger WHERE user_id = $1 AND source = 'card_collection' AND amount = 400`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query point ledger after duplicate failed: %v", err)
	}
	if balance != 400 || ledgerCount != 1 {
		t.Fatalf("duplicate claim should not grant points again: balance=%d ledger=%d", balance, ledgerCount)
	}
}

func cleanupCardStoreUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM card_reward_claims WHERE user_id = $1`,
		`DELETE FROM card_draw_logs WHERE user_id = $1`,
		`DELETE FROM card_user_states WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup card store user %d failed: %v", userID, err)
		}
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_rules WHERE id = 'default'`); err != nil {
		t.Fatalf("cleanup card rules failed: %v", err)
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
