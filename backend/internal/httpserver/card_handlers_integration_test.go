//go:build integration

package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/cards"
	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCardInventoryHTTPReturnsMigratedState(t *testing.T) {
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

	userID := int64(52901 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_http_user', 'Cards HTTP User', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:            userID,
		Inventory:         []string{"common-1"},
		Fragments:         88,
		PityRare:          3,
		PityLegendaryRare: 12,
		DrawsAvailable:    4,
		CollectionRewards: []string{"album:album-1:common"},
		RecentDraws: []cards.RecentDraw{{
			CardID:    "common-1",
			Rarity:    cards.RarityCommon,
			Timestamp: 1700000400000,
		}},
		RawState: map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/cards/inventory", bytes.NewBufferString(""))
	request.Host = "example.com"
	request.AddCookie(testSessionCookieFor(userID, "cards_http_"+strconv.FormatInt(userID, 10), "Cards HTTP User"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Inventory         []string           `json:"inventory"`
			Fragments         int64              `json:"fragments"`
			PityCounter       int64              `json:"pityCounter"`
			PityRare          int64              `json:"pityRare"`
			DrawsAvailable    int64              `json:"drawsAvailable"`
			CollectionRewards []string           `json:"collectionRewards"`
			RecentDraws       []cards.RecentDraw `json:"recentDraws"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || len(payload.Data.Inventory) != 1 || payload.Data.Inventory[0] != "common-1" {
		t.Fatalf("unexpected inventory payload: %+v", payload)
	}
	if payload.Data.Fragments != 88 || payload.Data.PityCounter != 12 || payload.Data.PityRare != 3 || payload.Data.DrawsAvailable != 4 {
		t.Fatalf("unexpected card counters: %+v", payload.Data)
	}
	if len(payload.Data.CollectionRewards) != 1 || payload.Data.CollectionRewards[0] != "album:album-1:common" {
		t.Fatalf("unexpected collection rewards: %#v", payload.Data.CollectionRewards)
	}
	if len(payload.Data.RecentDraws) != 1 || payload.Data.RecentDraws[0].CardID != "common-1" {
		t.Fatalf("unexpected recent draws: %#v", payload.Data.RecentDraws)
	}
}

func TestCardRulesHTTPReturnsImportedRules(t *testing.T) {
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
	if _, err := db.Exec(ctx, `DELETE FROM card_rules WHERE id = 'default'`); err != nil {
		t.Fatalf("cleanup card rules failed: %v", err)
	}
	defer func() { _, _ = db.Exec(ctx, `DELETE FROM card_rules WHERE id = 'default'`) }()

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
		   1700000500000
		 )`,
	); err != nil {
		t.Fatalf("seed card rules failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	response := performJSONRequest(handler, http.MethodGet, "/api/cards/rules", "", false)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			RarityProbabilities map[string]float64 `json:"rarityProbabilities"`
			PityThresholds      map[string]int64   `json:"pityThresholds"`
			CardDrawPrice       int64              `json:"cardDrawPrice"`
			FragmentValues      map[string]int64   `json:"fragmentValues"`
			ExchangePrices      map[string]int64   `json:"exchangePrices"`
			UpdatedAt           int64              `json:"updatedAt"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.CardDrawPrice != 800 || payload.Data.UpdatedAt != 1700000500000 {
		t.Fatalf("unexpected rules payload: %+v", payload)
	}
	if payload.Data.RarityProbabilities["common"] != 60 || payload.Data.PityThresholds["legendary_rare"] != 180 ||
		payload.Data.FragmentValues["legendary_rare"] != 90 || payload.Data.ExchangePrices["legendary_rare"] != 900 {
		t.Fatalf("unexpected rules maps: %+v", payload.Data)
	}
}

func TestCardDrawHTTPExecutesSingleDraw(t *testing.T) {
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

	userID := int64(53001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_draw_http', 'Cards Draw HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:         userID,
		DrawsAvailable: 1,
		RawState:       map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/draw", bytes.NewBufferString(`{"count":1}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_draw_"+strconv.FormatInt(userID, 10), "Cards Draw HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Success        bool       `json:"success"`
			Card           cards.Card `json:"card"`
			IsDuplicate    bool       `json:"isDuplicate"`
			DrawsAvailable int64      `json:"drawsAvailable"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || !payload.Data.Success || payload.Data.Card.ID == "" || payload.Data.Card.Name == "" ||
		payload.Data.Card.Image == "" || payload.Data.Card.AlbumID == "" || payload.Data.DrawsAvailable != 0 {
		t.Fatalf("unexpected draw payload: %+v", payload)
	}

	state, err := cards.NewStore(db).GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after draw failed: %v", err)
	}
	if state.DrawsAvailable != 0 || len(state.Inventory) != 1 || len(state.RecentDraws) != 1 {
		t.Fatalf("unexpected state after draw: %+v", state)
	}

	var logCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil {
		t.Fatalf("query draw logs failed: %v", err)
	}
	if logCount != 1 {
		t.Fatalf("expected one draw log, got %d", logCount)
	}
}

func TestCardDrawHTTPRejectsInsufficientDraws(t *testing.T) {
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

	userID := int64(53101 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_draw_empty_http', 'Cards Draw Empty HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:         userID,
		DrawsAvailable: 0,
		RawState:       map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/draw", bytes.NewBufferString(`{"count":1}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_draw_empty_"+strconv.FormatInt(userID, 10), "Cards Draw Empty HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "抽卡次数不足") {
		t.Fatalf("expected insufficient draw message, got body=%s", response.Body.String())
	}
}

func TestCardExchangeHTTPPersistsState(t *testing.T) {
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

	userID := int64(53201 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_exchange_http', 'Cards Exchange HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	cardID := "animal-s1-common-仓鼠"
	price := cards.DefaultRules().ExchangePrices[cards.RarityCommon]
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:    userID,
		Inventory: []string{},
		Fragments: price + 7,
		RawState:  map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/exchange", bytes.NewBufferString(`{"cardId":"`+cardID+`"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_exchange_"+strconv.FormatInt(userID, 10), "Cards Exchange HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "兑换成功") {
		t.Fatalf("expected success message, got body=%s", response.Body.String())
	}

	state, err := cards.NewStore(db).GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after exchange failed: %v", err)
	}
	if state.Fragments != 7 || len(state.Inventory) != 1 || state.Inventory[0] != cardID {
		t.Fatalf("unexpected state after exchange: %+v", state)
	}
}

func TestCardExchangeHTTPRejectsInsufficientFragments(t *testing.T) {
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

	userID := int64(53301 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_exchange_empty_http', 'Cards Exchange Empty HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	cardID := "animal-s1-common-仓鼠"
	price := cards.DefaultRules().ExchangePrices[cards.RarityCommon]
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:    userID,
		Inventory: []string{},
		Fragments: price - 1,
		RawState:  map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/exchange", bytes.NewBufferString(`{"cardId":"`+cardID+`"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_exchange_empty_"+strconv.FormatInt(userID, 10), "Cards Exchange Empty HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "碎片不足") {
		t.Fatalf("expected insufficient fragments message, got body=%s", response.Body.String())
	}

	state, err := cards.NewStore(db).GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after exchange failed: %v", err)
	}
	if state.Fragments != price-1 || len(state.Inventory) != 0 {
		t.Fatalf("unexpected state after rejected exchange: %+v", state)
	}
}

func TestCardClaimRewardHTTPGrantsPoints(t *testing.T) {
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

	userID := int64(53401 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_claim_http', 'Cards Claim HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:    userID,
		Inventory: cardIDsForAlbumRarity("animal-s1", cards.RarityCommon),
		RawState:  map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/claim-reward", bytes.NewBufferString(`{"rewardType":"common","albumId":"animal-s1"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_claim_"+strconv.FormatInt(userID, 10), "Cards Claim HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success       bool  `json:"success"`
		PointsAwarded int64 `json:"pointsAwarded"`
		NewBalance    int64 `json:"newBalance"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.PointsAwarded != 4 || payload.NewBalance != 4 {
		t.Fatalf("unexpected claim payload: %+v", payload)
	}

	state, err := cards.NewStore(db).GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after claim failed: %v", err)
	}
	if !containsStringForTest(state.CollectionRewards, "album:animal-s1:common") {
		t.Fatalf("expected claimed reward key, got %#v", state.CollectionRewards)
	}

	var claimCount int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM card_reward_claims
		  WHERE user_id = $1 AND album_id = 'animal-s1' AND reward_type = 'common' AND points_awarded = 4`,
		userID,
	).Scan(&claimCount); err != nil {
		t.Fatalf("query reward claims failed: %v", err)
	}
	if claimCount != 1 {
		t.Fatalf("expected one reward claim row, got %d", claimCount)
	}
}

func TestCardClaimRewardHTTPRejectsIncompleteAlbum(t *testing.T) {
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

	userID := int64(53501 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestCardUser(t, ctx, db, userID)
	defer cleanupHTTPTestCardUser(t, ctx, db, userID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, 'cards_claim_incomplete_http', 'Cards Claim Incomplete HTTP', now(), now())`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	inventory := cardIDsForAlbumRarity("animal-s1", cards.RarityCommon)
	inventory = inventory[:len(inventory)-1]
	if err := cards.NewStore(db).SaveUserState(ctx, cards.UserState{
		UserID:    userID,
		Inventory: inventory,
		RawState:  map[string]any{},
	}); err != nil {
		t.Fatalf("seed card state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/cards/claim-reward", bytes.NewBufferString(`{"rewardType":"common","albumId":"animal-s1"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "cards_claim_incomplete_"+strconv.FormatInt(userID, 10), "Cards Claim Incomplete HTTP"))
	response := performRequest(handler, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "尚未集齐该系列卡牌") {
		t.Fatalf("expected incomplete album message, got body=%s", response.Body.String())
	}

	state, err := cards.NewStore(db).GetUserState(ctx, userID)
	if err != nil {
		t.Fatalf("get state after rejected claim failed: %v", err)
	}
	if len(state.CollectionRewards) != 0 {
		t.Fatalf("unexpected collection rewards after rejected claim: %#v", state.CollectionRewards)
	}

	var accountCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM point_accounts WHERE user_id = $1`, userID).Scan(&accountCount); err != nil {
		t.Fatalf("query point accounts failed: %v", err)
	}
	if accountCount != 0 {
		t.Fatalf("expected no point account after rejected claim, got %d", accountCount)
	}
}

func cleanupHTTPTestCardUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup card http user %d failed: %v", userID, err)
		}
	}
}

func cardIDsForAlbumRarity(albumID string, rarity cards.Rarity) []string {
	cardIDs := []string{}
	for _, card := range cards.CardsByAlbum(albumID) {
		if card.Rarity == rarity {
			cardIDs = append(cardIDs, card.ID)
		}
	}
	return cardIDs
}

func containsStringForTest(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
