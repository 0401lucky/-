//go:build integration

package cards

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminServiceListsUsersDetailsAndRewardConfig(t *testing.T) {
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

	userIDs := []int64{99811, 99812, 99813}
	cleanupAdminCardsUsers(t, ctx, db, userIDs)
	cleanupAdminRewardOverrides(t, ctx, db)
	defer cleanupAdminCardsUsers(t, ctx, db, userIDs)
	defer cleanupAdminRewardOverrides(t, ctx, db)

	insertAdminCardsUser(t, ctx, db, 99811, "admincards_99811_alice", time.UnixMilli(1700000000000).UTC())
	insertAdminCardsUser(t, ctx, db, 99812, "admincards_99812_bob", time.UnixMilli(1700000100000).UTC())
	insertAdminCardsUser(t, ctx, db, 99813, "admincards_99813_cindy", time.UnixMilli(1700000200000).UTC())

	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:            99811,
		Inventory:         []string{"animal-s1-common-仓鼠", "animal-s1-rare-柴犬"},
		Fragments:         12,
		PityRare:          3,
		PityLegendaryRare: 11,
		DrawsAvailable:    4,
		CollectionRewards: []string{"album:animal-s1:common"},
		RecentDraws: []RecentDraw{{
			CardID:         "animal-s1-common-仓鼠",
			Rarity:         RarityCommon,
			IsDuplicate:    false,
			FragmentsAdded: 0,
			Timestamp:      1700000300000,
		}},
		RawState: map[string]any{},
	}); err != nil {
		t.Fatalf("save alice state failed: %v", err)
	}
	if err := store.SaveUserState(ctx, UserState{
		UserID:            99812,
		Inventory:         []string{"animal-s1-common-仓鼠"},
		Fragments:         8,
		PityLegendaryRare: 9,
		DrawsAvailable:    2,
		RawState:          map[string]any{},
	}); err != nil {
		t.Fatalf("save bob state failed: %v", err)
	}

	service := NewAdminService(db)
	list, err := service.ListUsers(ctx, AdminUserListInput{
		Page:   1,
		Limit:  2,
		Search: "admincards_9981",
	})
	if err != nil {
		t.Fatalf("list admin card users failed: %v", err)
	}
	if list.Pagination.Page != 1 || list.Pagination.Limit != 2 || list.Pagination.Total != 3 || list.Pagination.TotalPages != 2 || !list.Pagination.HasMore {
		t.Fatalf("unexpected pagination: %+v", list.Pagination)
	}
	if len(list.Users) != 2 || list.Users[0].ID != 99813 || list.Users[1].ID != 99812 {
		t.Fatalf("users should sort by firstSeen desc, got %#v", list.Users)
	}
	if list.Users[0].DrawsAvailable != 1 || list.Users[0].CardCount != 0 || list.Users[0].Fragments != 0 {
		t.Fatalf("missing card state should use defaults, got %+v", list.Users[0])
	}
	if list.Users[1].CardCount != 1 || list.Users[1].Fragments != 8 || list.Users[1].DrawsAvailable != 2 || list.Users[1].PityCounter != 9 {
		t.Fatalf("unexpected bob card stats: %+v", list.Users[1])
	}

	searchByID, err := service.ListUsers(ctx, AdminUserListInput{Page: 1, Limit: 50, Search: "99811"})
	if err != nil {
		t.Fatalf("search admin card users by id failed: %v", err)
	}
	if len(searchByID.Users) != 1 || searchByID.Users[0].ID != 99811 {
		t.Fatalf("unexpected id search result: %#v", searchByID.Users)
	}

	detail, err := service.GetUserDetail(ctx, 99811)
	if err != nil {
		t.Fatalf("get admin card user detail failed: %v", err)
	}
	if len(detail.Inventory) != 2 || detail.Fragments != 12 || detail.PityCounter != 11 || detail.DrawsAvailable != 4 {
		t.Fatalf("unexpected detail: %+v", detail)
	}
	if len(detail.CollectionRewards) != 1 || len(detail.RecentDraws) != 1 {
		t.Fatalf("unexpected detail arrays: %+v", detail)
	}

	if _, err := db.Exec(ctx,
		`INSERT INTO card_album_rewards (album_id, reward_points, raw_reward, updated_at_ms)
		 VALUES ('animal-s1', 123, '{}'::jsonb, 1700000400000)`); err != nil {
		t.Fatalf("insert album reward override failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO card_tier_rewards (reward_type, reward_points, raw_reward, updated_at_ms)
		 VALUES ('common', 5, '{}'::jsonb, 1700000400000),
		        ('legendary_rare', 88, '{}'::jsonb, 1700000400000),
		        ('full_set', 777, '{}'::jsonb, 1700000400000)`); err != nil {
		t.Fatalf("insert tier reward override failed: %v", err)
	}

	rewards, err := service.GetRewardConfig(ctx)
	if err != nil {
		t.Fatalf("get reward config failed: %v", err)
	}
	if len(rewards.Albums) != 3 || rewards.Albums[0].ID != "animal-s1" || rewards.Albums[0].CurrentReward != 123 {
		t.Fatalf("unexpected album rewards: %#v", rewards.Albums)
	}
	if len(rewards.Tiers) != 5 || rewards.Tiers[0].CurrentReward != 5 || rewards.Tiers[4].CurrentReward != 88 {
		t.Fatalf("unexpected tier rewards: %#v", rewards.Tiers)
	}
}

func TestAdminServiceWritesRulesRewardsAndReset(t *testing.T) {
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

	userID := int64(99814)
	cleanupAdminCardsUsers(t, ctx, db, []int64{userID})
	cleanupAdminRewardOverrides(t, ctx, db)
	defer cleanupAdminCardsUsers(t, ctx, db, []int64{userID})
	defer cleanupAdminRewardOverrides(t, ctx, db)

	insertAdminCardsUser(t, ctx, db, userID, "admincards_99814_reset", time.UnixMilli(1700000500000).UTC())
	store := NewStore(db)
	if err := store.SaveUserState(ctx, UserState{
		UserID:            userID,
		Inventory:         []string{"animal-s1-common-仓鼠"},
		Fragments:         12,
		PityLegendaryRare: 11,
		DrawsAvailable:    4,
		CollectionRewards: []string{"album:animal-s1:common"},
		RawState:          map[string]any{},
	}); err != nil {
		t.Fatalf("save reset state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO card_reward_claims (user_id, album_id, reward_type, points_awarded, claimed_at_ms)
		 VALUES ($1, 'animal-s1', 'common', 400, 1700000600000)`,
		userID,
	); err != nil {
		t.Fatalf("insert reset reward claim failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO card_draw_logs (user_id, draw_group_id, card_id, rarity, is_duplicate, fragments_added, created_at_ms)
		 VALUES ($1, 'admin-reset-log', 'animal-s1-common-仓鼠', 'common', false, 0, 1700000600000)`,
		userID,
	); err != nil {
		t.Fatalf("insert reset draw log failed: %v", err)
	}

	service := NewAdminService(db)
	price := int64(800)
	rules, err := service.UpdateRules(ctx, AdminRulesUpdateInput{
		RarityProbabilities: map[Rarity]float64{
			RarityLegendaryRare: 1,
			RarityLegendary:     2,
			RarityEpic:          7,
			RarityRare:          30,
			RarityCommon:        60,
		},
		PityThresholds: map[Rarity]int64{
			RarityRare:          9,
			RarityEpic:          40,
			RarityLegendary:     90,
			RarityLegendaryRare: 180,
		},
		CardDrawPrice: &price,
		FragmentValues: map[Rarity]int64{
			RarityCommon: 8,
		},
		ExchangePrices: map[Rarity]int64{
			RarityLegendaryRare: 900,
		},
		NowMs: 1700000700000,
	})
	if err != nil {
		t.Fatalf("update rules failed: %v", err)
	}
	if rules.CardDrawPrice != 800 || rules.PityThresholds[RarityLegendaryRare] != 180 || rules.FragmentValues[RarityCommon] != 8 || rules.ExchangePrices[RarityLegendaryRare] != 900 {
		t.Fatalf("unexpected updated rules: %+v", rules)
	}
	if _, err := service.UpdateRules(ctx, AdminRulesUpdateInput{
		RarityProbabilities: map[Rarity]float64{RarityCommon: 1},
	}); !errors.Is(err, ErrInvalidAdminCardInput) {
		t.Fatalf("expected invalid probability total, got %v", err)
	}

	rewards, err := service.UpdateReward(ctx, AdminRewardUpdateInput{AlbumID: "animal-s1", Reward: 321, NowMs: 1700000800000})
	if err != nil {
		t.Fatalf("update album reward failed: %v", err)
	}
	if rewards.Albums[0].CurrentReward != 321 {
		t.Fatalf("unexpected album reward after update: %+v", rewards.Albums[0])
	}
	rewards, err = service.UpdateReward(ctx, AdminRewardUpdateInput{TierID: RewardType(RarityCommon), Reward: 9, NowMs: 1700000800000})
	if err != nil {
		t.Fatalf("update tier reward failed: %v", err)
	}
	if rewards.Tiers[0].CurrentReward != 9 {
		t.Fatalf("unexpected tier reward after update: %+v", rewards.Tiers[0])
	}
	if _, err := service.UpdateReward(ctx, AdminRewardUpdateInput{TierID: RewardFullSet, Reward: 9}); !errors.Is(err, ErrInvalidAdminCardInput) {
		t.Fatalf("expected hidden full_set tier to be rejected, got %v", err)
	}

	if err := service.ResetUserProgress(ctx, userID); err != nil {
		t.Fatalf("reset user progress failed: %v", err)
	}
	state, err := store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after reset failed: %v", err)
	}
	if state.Exists || state.DrawsAvailable != 1 || len(state.Inventory) != 0 || state.Fragments != 0 {
		t.Fatalf("reset should remove card state and fall back to defaults, got %+v", state)
	}
	var claimCount int
	var logCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_reward_claims WHERE user_id = $1`, userID).Scan(&claimCount); err != nil {
		t.Fatalf("query claims after reset failed: %v", err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil {
		t.Fatalf("query logs after reset failed: %v", err)
	}
	if claimCount != 0 || logCount != 1 {
		t.Fatalf("reset should delete claims and keep draw logs, claims=%d logs=%d", claimCount, logCount)
	}
}

func insertAdminCardsUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string, firstSeenAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, $3, $3)`,
		userID,
		username,
		firstSeenAt,
	); err != nil {
		t.Fatalf("insert admin card user %d failed: %v", userID, err)
	}
}

func cleanupAdminCardsUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool, userIDs []int64) {
	t.Helper()
	for _, userID := range userIDs {
		cleanupCardStoreUser(t, ctx, db, userID)
	}
}

func cleanupAdminRewardOverrides(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM card_album_rewards WHERE album_id IN ('animal-s1', 'animal-s2', 'tarot')`); err != nil {
		t.Fatalf("cleanup card album rewards failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_tier_rewards WHERE reward_type IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set')`); err != nil {
		t.Fatalf("cleanup card tier rewards failed: %v", err)
	}
}
