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

func TestApplyCardsImportWritesCardStateAndRules(t *testing.T) {
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

	userID := int64(99551)
	if _, err := db.Exec(ctx, `DELETE FROM card_reward_claims WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup card rewards failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_draw_logs WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup card draw logs failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_user_states WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup card state failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_rules WHERE id = 'default'`); err != nil {
		t.Fatalf("cleanup card rules failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_album_rewards WHERE album_id IN ('animal-s1', 'tarot')`); err != nil {
		t.Fatalf("cleanup card album rewards failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_tier_rewards WHERE reward_type IN ('common', 'legendary_rare')`); err != nil {
		t.Fatalf("cleanup card tier rewards failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("cleanup user failed: %v", err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM card_reward_claims WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM card_draw_logs WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM card_user_states WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM card_rules WHERE id = 'default'`)
		_, _ = db.Exec(ctx, `DELETE FROM card_album_rewards WHERE album_id IN ('animal-s1', 'tarot')`)
		_, _ = db.Exec(ctx, `DELETE FROM card_tier_rewards WHERE reward_type IN ('common', 'legendary_rare')`)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	plan, err := PlanCardsImport(strings.NewReader(`
INSERT INTO "native_user_cards" ("user_id","value_json","updated_at") VALUES(99551,'{"inventory":["animal-s1-common-仓鼠"],"fragments":8,"pityRare":3,"pityLegendaryRare":9,"drawsAvailable":4,"collectionRewards":["album:s1:common"],"recentDraws":[{"cardId":"animal-s1-common-仓鼠","rarity":"common","isDuplicate":false,"fragmentsAdded":0,"timestamp":1700000000000}]}',3000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:rules:config','{"cardDrawPrice":900,"rarityProbabilities":{"common":65.5,"rare":25,"epic":7,"legendary":2,"legendary_rare":0.5},"pityThresholds":{"rare":10,"epic":50,"legendary":100,"legendary_rare":200},"fragmentValues":{"common":9,"rare":14,"epic":26,"legendary":50,"legendary_rare":100},"exchangePrices":{"common":30,"rare":80,"epic":200,"legendary":500,"legendary_rare":1000},"updatedAt":1700000200000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:album_rewards','{"animal-s1":123,"tarot":456}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('cards:tier_rewards','{"common":5,"legendary_rare":88}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyCardsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.StatesUpserted != 1 || result.RulesUpserted != 1 ||
		result.AlbumRewardsUpserted != 2 || result.TierRewardsUpserted != 2 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var fragments int64
	var drawsAvailable int64
	var inventoryCount int64
	var cardDrawPrice int64
	var albumReward int64
	var tierReward int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT fragments FROM card_user_states WHERE user_id = $1),
		   (SELECT draws_available FROM card_user_states WHERE user_id = $1),
		   (SELECT jsonb_array_length(inventory) FROM card_user_states WHERE user_id = $1),
		   (SELECT card_draw_price FROM card_rules WHERE id = 'default'),
		   (SELECT reward_points FROM card_album_rewards WHERE album_id = 'animal-s1'),
		   (SELECT reward_points FROM card_tier_rewards WHERE reward_type = 'legendary_rare')`,
		userID,
	).Scan(&fragments, &drawsAvailable, &inventoryCount, &cardDrawPrice, &albumReward, &tierReward); err != nil {
		t.Fatalf("query imported card data failed: %v", err)
	}
	if fragments != 8 || drawsAvailable != 4 || inventoryCount != 1 || cardDrawPrice != 900 || albumReward != 123 || tierReward != 88 {
		t.Fatalf("unexpected imported card data fragments=%d draws=%d inventory=%d price=%d album=%d tier=%d", fragments, drawsAvailable, inventoryCount, cardDrawPrice, albumReward, tierReward)
	}

	again, err := ApplyCardsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("repeat apply import failed: %v", err)
	}
	if again.StatesUpserted != 1 || again.RulesUpserted != 1 || again.AlbumRewardsUpserted != 2 || again.TierRewardsUpserted != 2 {
		t.Fatalf("repeat import should upsert state and rules, got %+v", again)
	}
	var total int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM card_user_states WHERE user_id = $1`, userID).Scan(&total); err != nil {
		t.Fatalf("query card state total failed: %v", err)
	}
	if total != 1 {
		t.Fatalf("repeat import should keep 1 state, got %d", total)
	}
}
