//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/cards"
	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminCardReadHandlersReturnLegacyShapes(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userIDs := []int64{99821, 99822}
	cleanupAdminCardHTTPUsers(t, ctx, db, userIDs)
	cleanupAdminCardHTTPRewards(t, ctx, db)
	defer cleanupAdminCardHTTPUsers(t, ctx, db, userIDs)
	defer cleanupAdminCardHTTPRewards(t, ctx, db)

	insertAdminCardHTTPUser(t, ctx, db, 99821, "http_admin_cards_alice", time.UnixMilli(1700000000000).UTC())
	insertAdminCardHTTPUser(t, ctx, db, 99822, "http_admin_cards_bob", time.UnixMilli(1700000100000).UTC())

	store := cards.NewStore(db)
	if err := store.SaveUserState(ctx, cards.UserState{
		UserID:            99821,
		Inventory:         []string{"animal-s1-common-仓鼠"},
		Fragments:         12,
		PityLegendaryRare: 11,
		DrawsAvailable:    4,
		CollectionRewards: []string{"album:animal-s1:common"},
		RecentDraws: []cards.RecentDraw{{
			CardID:    "animal-s1-common-仓鼠",
			Rarity:    cards.RarityCommon,
			Timestamp: 1700000200000,
		}},
		RawState: map[string]any{},
	}); err != nil {
		t.Fatalf("save admin card http state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO card_album_rewards (album_id, reward_points, raw_reward, updated_at_ms)
		 VALUES ('animal-s1', 123, '{}'::jsonb, 1700000300000)`); err != nil {
		t.Fatalf("insert card album reward failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO card_tier_rewards (reward_type, reward_points, raw_reward, updated_at_ms)
		 VALUES ('common', 5, '{}'::jsonb, 1700000300000)`); err != nil {
		t.Fatalf("insert card tier reward failed: %v", err)
	}

	handlers := newAdminCardHandlers(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	usersResponse := performAdminCardHandlerRequest(handlers.users, "/api/admin/cards/users?page=1&limit=50&search=http_admin_cards")
	if usersResponse.Code != http.StatusOK {
		t.Fatalf("expected users 200, got %d body=%s", usersResponse.Code, usersResponse.Body.String())
	}
	var usersPayload struct {
		Success bool `json:"success"`
		Users   []struct {
			ID             int64  `json:"id"`
			Username       string `json:"username"`
			FirstSeen      int64  `json:"firstSeen"`
			CardCount      int64  `json:"cardCount"`
			Fragments      int64  `json:"fragments"`
			DrawsAvailable int64  `json:"drawsAvailable"`
			PityCounter    int64  `json:"pityCounter"`
		} `json:"users"`
		Pagination struct {
			Total      int64 `json:"total"`
			TotalPages int   `json:"totalPages"`
			HasMore    bool  `json:"hasMore"`
		} `json:"pagination"`
	}
	if err := json.Unmarshal(usersResponse.Body.Bytes(), &usersPayload); err != nil {
		t.Fatalf("decode users response failed: %v", err)
	}
	if !usersPayload.Success || len(usersPayload.Users) != 2 || usersPayload.Users[0].ID != 99822 || usersPayload.Users[1].ID != 99821 {
		t.Fatalf("unexpected users payload: %+v", usersPayload)
	}
	if usersPayload.Users[1].CardCount != 1 || usersPayload.Users[1].Fragments != 12 || usersPayload.Users[1].DrawsAvailable != 4 || usersPayload.Users[1].PityCounter != 11 {
		t.Fatalf("unexpected alice stats: %+v", usersPayload.Users[1])
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/admin/cards/user/99821", nil)
	detailRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	detailResponse := httptest.NewRecorder()
	handlers.userDetail(detailResponse, adminCardRequestWithUserID(detailRequest, "99821"))
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Inventory         []string           `json:"inventory"`
			Fragments         int64              `json:"fragments"`
			PityCounter       int64              `json:"pityCounter"`
			DrawsAvailable    int64              `json:"drawsAvailable"`
			CollectionRewards []string           `json:"collectionRewards"`
			RecentDraws       []cards.RecentDraw `json:"recentDraws"`
		} `json:"data"`
	}
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detailPayload); err != nil {
		t.Fatalf("decode detail response failed: %v", err)
	}
	if !detailPayload.Success || len(detailPayload.Data.Inventory) != 1 || detailPayload.Data.PityCounter != 11 || detailPayload.Data.DrawsAvailable != 4 {
		t.Fatalf("unexpected detail payload: %+v", detailPayload)
	}

	albumsResponse := performAdminCardHandlerRequest(handlers.albums, "/api/admin/cards/albums")
	if albumsResponse.Code != http.StatusOK {
		t.Fatalf("expected albums 200, got %d body=%s", albumsResponse.Code, albumsResponse.Body.String())
	}
	var albumsPayload struct {
		Success bool `json:"success"`
		Albums  []struct {
			ID            string `json:"id"`
			DefaultReward int64  `json:"defaultReward"`
			CurrentReward int64  `json:"currentReward"`
		} `json:"albums"`
		Tiers []struct {
			ID            string `json:"id"`
			DefaultReward int64  `json:"defaultReward"`
			CurrentReward int64  `json:"currentReward"`
		} `json:"tiers"`
	}
	if err := json.Unmarshal(albumsResponse.Body.Bytes(), &albumsPayload); err != nil {
		t.Fatalf("decode albums response failed: %v", err)
	}
	if !albumsPayload.Success || len(albumsPayload.Albums) != 3 || albumsPayload.Albums[0].CurrentReward != 123 {
		t.Fatalf("unexpected albums payload: %+v", albumsPayload)
	}
	if len(albumsPayload.Tiers) != 5 || albumsPayload.Tiers[0].CurrentReward != 5 {
		t.Fatalf("unexpected tiers payload: %+v", albumsPayload)
	}

	rulesResponse := performAdminCardHandlerRequest(handlers.rules, "/api/admin/cards/rules")
	if rulesResponse.Code != http.StatusOK || !strings.Contains(rulesResponse.Body.String(), "cardDrawPrice") {
		t.Fatalf("unexpected rules response: status=%d body=%s", rulesResponse.Code, rulesResponse.Body.String())
	}

	rewardResponse := performAdminCardHandlerWriteRequest(
		handlers.updateReward,
		http.MethodPost,
		"/api/admin/cards/albums",
		`{"tierId":"rare","reward":22}`,
	)
	if rewardResponse.Code != http.StatusOK || !strings.Contains(rewardResponse.Body.String(), "稀有度奖励更新成功") {
		t.Fatalf("unexpected reward update response: status=%d body=%s", rewardResponse.Code, rewardResponse.Body.String())
	}
	var rareReward int64
	if err := db.QueryRow(ctx, `SELECT reward_points FROM card_tier_rewards WHERE reward_type = 'rare'`).Scan(&rareReward); err != nil {
		t.Fatalf("query updated rare reward failed: %v", err)
	}
	if rareReward != 22 {
		t.Fatalf("unexpected rare reward after handler update: %d", rareReward)
	}

	rulesUpdateResponse := performAdminCardHandlerWriteRequest(
		handlers.updateRules,
		http.MethodPatch,
		"/api/admin/cards/rules",
		`{"cardDrawPrice":777,"rarityProbabilities":{"legendary_rare":1,"legendary":2,"epic":7,"rare":30,"common":60}}`,
	)
	if rulesUpdateResponse.Code != http.StatusOK || !strings.Contains(rulesUpdateResponse.Body.String(), "卡牌规则已保存") {
		t.Fatalf("unexpected rules update response: status=%d body=%s", rulesUpdateResponse.Code, rulesUpdateResponse.Body.String())
	}
	var cardDrawPrice int64
	if err := db.QueryRow(ctx, `SELECT card_draw_price FROM card_rules WHERE id = 'default'`).Scan(&cardDrawPrice); err != nil {
		t.Fatalf("query updated card draw price failed: %v", err)
	}
	if cardDrawPrice != 777 {
		t.Fatalf("unexpected card draw price after handler update: %d", cardDrawPrice)
	}

	resetResponse := performAdminCardHandlerWriteRequest(
		handlers.reset,
		http.MethodPost,
		"/api/admin/cards/reset",
		`{"userId":99821}`,
	)
	if resetResponse.Code != http.StatusOK || !strings.Contains(resetResponse.Body.String(), "用户卡牌进度重置成功") {
		t.Fatalf("unexpected reset response: status=%d body=%s", resetResponse.Code, resetResponse.Body.String())
	}
	var stateCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_user_states WHERE user_id = 99821`).Scan(&stateCount); err != nil {
		t.Fatalf("query state after reset failed: %v", err)
	}
	if stateCount != 0 {
		t.Fatalf("reset handler should remove card state, got %d rows", stateCount)
	}
}

func performAdminCardHandlerRequest(handler func(http.ResponseWriter, *http.Request), path string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler(response, request)
	return response
}

func performAdminCardHandlerWriteRequest(handler func(http.ResponseWriter, *http.Request), method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := httptest.NewRecorder()
	handler(response, request)
	return response
}

func insertAdminCardHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string, firstSeenAt time.Time) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, $3, $3)`,
		userID,
		username,
		firstSeenAt,
	); err != nil {
		t.Fatalf("insert admin card http user %d failed: %v", userID, err)
	}
}

func cleanupAdminCardHTTPUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool, userIDs []int64) {
	t.Helper()
	for _, userID := range userIDs {
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
				t.Fatalf("cleanup admin card http user %d failed: %v", userID, err)
			}
		}
	}
}

func cleanupAdminCardHTTPRewards(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM card_album_rewards WHERE album_id IN ('animal-s1', 'animal-s2', 'tarot')`); err != nil {
		t.Fatalf("cleanup admin card http album rewards failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM card_tier_rewards WHERE reward_type IN ('common', 'rare', 'epic', 'legendary', 'legendary_rare', 'full_set')`); err != nil {
		t.Fatalf("cleanup admin card http tier rewards failed: %v", err)
	}
}
