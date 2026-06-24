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
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestEcoRankingRouteReturnsTrashLeaderboard(t *testing.T) {
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

	userID := int64(25501 + time.Now().UnixNano()%1_000_000_000)
	otherUserID := userID + 1
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	cleanupHTTPTestEcoUser(t, ctx, db, otherUserID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, otherUserID)

	periodKey := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1, $2, 'Eco Ranking User', now(), now()),
		   ($3, $4, '', now(), now())`,
		userID,
		"eco_rank_"+strconv.FormatInt(userID, 10),
		otherUserID,
		"eco_rank_"+strconv.FormatInt(otherUserID, 10),
	); err != nil {
		t.Fatalf("seed eco ranking users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
		 VALUES ('daily', $1, $2, 999999), ('daily', $1, $3, 5)`,
		periodKey,
		userID,
		otherUserID,
	); err != nil {
		t.Fatalf("seed eco ranking rows failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/rankings/eco?period=daily&limit=1", nil)
	request.AddCookie(testSessionCookieFor(userID, "eco_rank_user", "Eco Rank User"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Period            string `json:"period"`
			PeriodKey         string `json:"periodKey"`
			TotalParticipants int64  `json:"totalParticipants"`
			Leaderboard       []struct {
				Rank         int64   `json:"rank"`
				UserID       int64   `json:"userId"`
				DisplayName  *string `json:"displayName"`
				TrashCleared int64   `json:"trashCleared"`
			} `json:"leaderboard"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode eco ranking response failed: %v", err)
	}
	if !payload.Success || payload.Data.Period != "daily" || payload.Data.PeriodKey != periodKey || payload.Data.TotalParticipants < 2 || len(payload.Data.Leaderboard) != 1 {
		t.Fatalf("unexpected eco ranking response: %+v", payload)
	}
	if payload.Data.Leaderboard[0].UserID != userID || payload.Data.Leaderboard[0].Rank != 1 || payload.Data.Leaderboard[0].TrashCleared != 999999 || payload.Data.Leaderboard[0].DisplayName == nil || *payload.Data.Leaderboard[0].DisplayName != "Eco Ranking User" {
		t.Fatalf("unexpected top eco ranking entry: %+v", payload.Data.Leaderboard[0])
	}
	if cacheControl := response.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "private") {
		t.Fatalf("expected private cache-control, got %q", cacheControl)
	}
}

func TestEcoCollectRouteCreditsPointsAndUpdatesState(t *testing.T) {
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

	userID := int64(26001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_http_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed eco user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 25, 9, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed eco state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/collect", strings.NewReader(`{"drags":5}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_http_user", "Eco HTTP User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Cleared      int64 `json:"cleared"`
			PointsEarned int64 `json:"pointsEarned"`
			Balance      int64 `json:"balance"`
			Pending      int64 `json:"pending"`
			PointBuffer  int64 `json:"pointBuffer"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.Cleared != 5 || payload.Data.PointsEarned != 1 || payload.Data.Balance != 1 || payload.Data.Pending != 20 || payload.Data.PointBuffer != 4 {
		t.Fatalf("unexpected eco collect response: %+v", payload)
	}

	var pending int64
	var pointBuffer int64
	var balance int64
	var lifetimeCleared int64
	if err := db.QueryRow(ctx,
		`SELECT s.pending, s.point_buffer, a.balance, s.lifetime_cleared
		   FROM eco_states s
		   JOIN point_accounts a ON a.user_id = s.user_id
		  WHERE s.user_id = $1`,
		userID,
	).Scan(&pending, &pointBuffer, &balance, &lifetimeCleared); err != nil {
		t.Fatalf("query collected state failed: %v", err)
	}
	if pending != 20 || pointBuffer != 4 || balance != 1 || lifetimeCleared != 5 {
		t.Fatalf("unexpected stored state: pending=%d buffer=%d balance=%d cleared=%d", pending, pointBuffer, balance, lifetimeCleared)
	}
}

func TestEcoStatusRouteReturnsCompatibleShape(t *testing.T) {
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

	userID := int64(27001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	today := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	username := "eco_status_" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, '环保状态用户', now(), now())`,
		userID,
		username,
	); err != nil {
		t.Fatalf("seed eco status user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 7, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed status point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, glove_uses_remaining,
		   daily_trash_date, daily_trash_points, exp, lifetime_cleared,
		   lifetime_points, points_snapshot, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 12, 3, 2, $2::date, 4, 20, 21, 5, 7, $3, $3, $3, '{}'::jsonb
		 )`,
		userID,
		today,
		nowMs,
	); err != nil {
		t.Fatalf("seed eco status state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level)
		 VALUES ($1, 'spawn', 2), ($1, 'storage', 1), ($1, 'value', 1)`,
		userID,
	); err != nil {
		t.Fatalf("seed status upgrades failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_item_purchases (user_id, item_key, purchase_date, purchase_count)
		 VALUES ($1, 'clear_truck', $2::date, 1)`,
		userID,
		today,
	); err != nil {
		t.Fatalf("seed status item purchase failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'diamond', 2, 1, 2)`,
		userID,
	); err != nil {
		t.Fatalf("seed status inventory failed: %v", err)
	}
	lotID := "status-lot-" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source)
		 VALUES ($1, $2, 'diamond', $3, $3, true, 'claim')`,
		lotID,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed status prize lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ($1, $2, 'coin', $3, false)`,
		"status-visible-"+strconv.FormatInt(userID, 10),
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed status visible prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('diamond', 3)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = excluded.claimed_count`,
	); err != nil {
		t.Fatalf("seed global prize stock failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES ($1, 'trophy', $2, '环保状态用户', $3, $4, $4, 'listed')`,
		"status-public-"+strconv.FormatInt(userID, 10),
		userID,
		lotID,
		nowMs,
	); err != nil {
		t.Fatalf("seed public prize failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/games/eco/status", nil)
	request.AddCookie(testSessionCookieFor(userID, username, "环保状态用户"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Points               int64  `json:"points"`
			Pending              int64  `json:"pending"`
			PendingTotal         int64  `json:"pendingTotal"`
			StorageCap           int64  `json:"storageCap"`
			PointMultiplier      int64  `json:"pointMultiplier"`
			GrabSize             int64  `json:"grabSize"`
			TodayTrashPoints     int64  `json:"todayTrashPoints"`
			TodayTrashPointsDate string `json:"todayTrashPointsDate"`
			Upgrades             []struct {
				Key   string `json:"key"`
				Level int64  `json:"level"`
			} `json:"upgrades"`
			Items []struct {
				Key            string `json:"key"`
				PurchasedToday int64  `json:"purchasedToday"`
			} `json:"items"`
			Prizes []struct {
				Key               string `json:"key"`
				Inventory         int64  `json:"inventory"`
				SellableInventory int64  `json:"sellableInventory"`
			} `json:"prizes"`
			PublicBoard struct {
				Remaining map[string]int64 `json:"remaining"`
				Entries   []struct {
					Key                 string `json:"key"`
					OwnerUserID         int64  `json:"ownerUserId"`
					CanSteal            bool   `json:"canSteal"`
					StealDisabledReason string `json:"stealDisabledReason"`
				} `json:"entries"`
			} `json:"publicBoard"`
			VisiblePrizes []struct {
				Key       string `json:"key"`
				ExpiresAt int64  `json:"expiresAt"`
			} `json:"visiblePrizes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status response failed: %v", err)
	}
	if !payload.Success || payload.Data.Points != 7 || payload.Data.Pending != 12 || payload.Data.PendingTotal != 13 {
		t.Fatalf("unexpected basic status: %+v", payload.Data)
	}
	if payload.Data.StorageCap != 120 || payload.Data.PointMultiplier != 2 || payload.Data.GrabSize != 2 {
		t.Fatalf("unexpected derived status: %+v", payload.Data)
	}
	if payload.Data.TodayTrashPoints != 4 || payload.Data.TodayTrashPointsDate != today {
		t.Fatalf("unexpected daily trash points: %+v", payload.Data)
	}
	if !hasEcoUpgradeLevel(payload.Data.Upgrades, "spawn", 2) {
		t.Fatalf("status should include spawn upgrade level 2: %+v", payload.Data.Upgrades)
	}
	if !hasEcoItemPurchase(payload.Data.Items, "clear_truck", 1) {
		t.Fatalf("status should include clear truck purchase count: %+v", payload.Data.Items)
	}
	if !hasEcoPrizeInventory(payload.Data.Prizes, "diamond", 2, 2) {
		t.Fatalf("status should include diamond inventory: %+v", payload.Data.Prizes)
	}
	if payload.Data.PublicBoard.Remaining["diamond"] != 7 || len(payload.Data.PublicBoard.Entries) == 0 || payload.Data.PublicBoard.Entries[0].OwnerUserID != userID || payload.Data.PublicBoard.Entries[0].CanSteal {
		t.Fatalf("unexpected public board: %+v", payload.Data.PublicBoard)
	}
	if len(payload.Data.VisiblePrizes) != 1 || payload.Data.VisiblePrizes[0].Key != "coin" || payload.Data.VisiblePrizes[0].ExpiresAt <= nowMs {
		t.Fatalf("unexpected visible prizes: %+v", payload.Data.VisiblePrizes)
	}
}

func TestEcoStatusRoutePersistsAdvanceAndAutoCollect(t *testing.T) {
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

	userID := int64(28001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	lastTickMs := time.Now().Add(-10 * time.Minute).UnixMilli()
	username := "eco_status_write_" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		username,
	); err != nil {
		t.Fatalf("seed status writeback user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed status writeback point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, lifetime_cleared, lifetime_points,
		   points_snapshot, last_tick_at_ms, created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 20, 0, 0, 0, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		lastTickMs,
	); err != nil {
		t.Fatalf("seed status writeback state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level)
		 VALUES ($1, 'auto', 1)`,
		userID,
	); err != nil {
		t.Fatalf("seed status writeback auto upgrade failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/games/eco/status", nil)
	request.AddCookie(testSessionCookieFor(userID, username, "Eco Status Write"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Points          int64 `json:"points"`
			Pending         int64 `json:"pending"`
			LifetimeCleared int64 `json:"lifetimeCleared"`
			LifetimePoints  int64 `json:"lifetimePoints"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode status writeback response failed: %v", err)
	}
	if !payload.Success || payload.Data.Points != 1 || payload.Data.Pending < 0 || payload.Data.Pending > 80 || payload.Data.LifetimeCleared != 10 || payload.Data.LifetimePoints != 1 {
		t.Fatalf("unexpected status writeback response: %+v", payload)
	}

	var pending int64
	var pointBuffer int64
	var balance int64
	var lifetimeCleared int64
	var lifetimePoints int64
	var lastTickAfter int64
	var ledgerAmount int64
	if err := db.QueryRow(ctx,
		`SELECT s.pending, s.point_buffer, a.balance, s.lifetime_cleared,
		        s.lifetime_points, s.last_tick_at_ms, l.amount
		   FROM eco_states s
		   JOIN point_accounts a ON a.user_id = s.user_id
		   JOIN point_ledger l ON l.user_id = s.user_id AND l.description = '环保行动·自动回收'
		  WHERE s.user_id = $1`,
		userID,
	).Scan(&pending, &pointBuffer, &balance, &lifetimeCleared, &lifetimePoints, &lastTickAfter, &ledgerAmount); err != nil {
		t.Fatalf("query status writeback result failed: %v", err)
	}
	if pending < 0 || pending > 80 || pointBuffer != 0 || balance != 1 || lifetimeCleared != 10 || lifetimePoints != 1 || lastTickAfter <= lastTickMs || ledgerAmount != 1 {
		t.Fatalf("unexpected stored status writeback: pending=%d buffer=%d balance=%d cleared=%d lifetimePoints=%d lastTick=%d ledger=%d",
			pending, pointBuffer, balance, lifetimeCleared, lifetimePoints, lastTickAfter, ledgerAmount)
	}
}

func TestEcoBuyUpgradeRouteDeductsPointsAndUpdatesStatus(t *testing.T) {
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

	userID := int64(28001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_buy_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed buy user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed buy point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 10, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed buy eco state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/buy", strings.NewReader(`{"type":"upgrade","key":"spawn"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_buy_user", "Eco Buy User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Balance int64  `json:"balance"`
			Key     string `json:"key"`
			Level   int64  `json:"level"`
			Cost    int64  `json:"cost"`
			Status  struct {
				Points   int64 `json:"points"`
				Upgrades []struct {
					Key   string `json:"key"`
					Level int64  `json:"level"`
				} `json:"upgrades"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode buy response failed: %v", err)
	}
	if !payload.Success || payload.Data.Balance != 50 || payload.Data.Key != "spawn" || payload.Data.Level != 1 || payload.Data.Cost != 50 || payload.Data.Status.Points != 50 {
		t.Fatalf("unexpected buy response: %+v", payload)
	}
	if !hasEcoUpgradeLevel(payload.Data.Status.Upgrades, "spawn", 1) {
		t.Fatalf("status should include spawn level 1: %+v", payload.Data.Status.Upgrades)
	}

	var balance int64
	var level int64
	var amount int64
	if err := db.QueryRow(ctx,
		`SELECT a.balance, u.level, l.amount
		   FROM point_accounts a
		   JOIN eco_user_upgrades u ON u.user_id = a.user_id AND u.upgrade_key = 'spawn'
		   JOIN point_ledger l ON l.user_id = a.user_id AND l.description = '环保行动升级·刷新速度 Lv1'
		  WHERE a.user_id = $1`,
		userID,
	).Scan(&balance, &level, &amount); err != nil {
		t.Fatalf("query buy result failed: %v", err)
	}
	if balance != 50 || level != 1 || amount != -50 {
		t.Fatalf("unexpected stored buy result: balance=%d level=%d amount=%d", balance, level, amount)
	}
}

func TestEcoBuyItemRouteAppliesClearTruck(t *testing.T) {
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

	userID := int64(29001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	today := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_item_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed item user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed item point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 10, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed item eco state failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/buy", strings.NewReader(`{"type":"item","key":"clear_truck"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_item_user", "Eco Item User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Balance        int64  `json:"balance"`
			Key            string `json:"key"`
			Cost           int64  `json:"cost"`
			PurchasedToday int64  `json:"purchasedToday"`
			RemainingToday int64  `json:"remainingToday"`
			Status         struct {
				Points  int64 `json:"points"`
				Pending int64 `json:"pending"`
				Items   []struct {
					Key            string `json:"key"`
					PurchasedToday int64  `json:"purchasedToday"`
				} `json:"items"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode item response failed: %v", err)
	}
	if !payload.Success || payload.Data.Balance != 65 || payload.Data.Key != "clear_truck" || payload.Data.Cost != 35 || payload.Data.PurchasedToday != 1 || payload.Data.RemainingToday != 2 {
		t.Fatalf("unexpected item response: %+v", payload)
	}
	if payload.Data.Status.Points != 65 || payload.Data.Status.Pending != 80 || !hasEcoItemPurchase(payload.Data.Status.Items, "clear_truck", 1) {
		t.Fatalf("unexpected item status: %+v", payload.Data.Status)
	}

	var balance int64
	var pending int64
	var purchaseCount int64
	var amount int64
	if err := db.QueryRow(ctx,
		`SELECT a.balance, s.pending, p.purchase_count, l.amount
		   FROM point_accounts a
		   JOIN eco_states s ON s.user_id = a.user_id
		   JOIN eco_item_purchases p ON p.user_id = a.user_id AND p.item_key = 'clear_truck' AND p.purchase_date = $2::date
		   JOIN point_ledger l ON l.user_id = a.user_id AND l.description = '环保行动道具·清运车'
		  WHERE a.user_id = $1`,
		userID,
		today,
	).Scan(&balance, &pending, &purchaseCount, &amount); err != nil {
		t.Fatalf("query item result failed: %v", err)
	}
	if balance != 65 || pending != 80 || purchaseCount != 1 || amount != -35 {
		t.Fatalf("unexpected stored item result: balance=%d pending=%d purchases=%d amount=%d", balance, pending, purchaseCount, amount)
	}
}

func TestEcoClaimPrizeRouteClaimsAndPublishesVisiblePrize(t *testing.T) {
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

	userID := int64(30001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	prizeID := "visible-prize-" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_claim_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed claim user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed claim point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 0, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed claim eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ($1, $2, 'diamond', $3, true)`,
		prizeID,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed visible prize failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/claim-prize", strings.NewReader(`{"prizeId":"`+prizeID+`","makePublic":true}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_claim_user", "Eco Claim User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			PrizeKey string `json:"prizeKey"`
			Status   struct {
				VisiblePrizes []struct {
					Key string `json:"key"`
				} `json:"visiblePrizes"`
				Prizes []struct {
					Key               string `json:"key"`
					Inventory         int64  `json:"inventory"`
					PublicInventory   int64  `json:"publicInventory"`
					SellableInventory int64  `json:"sellableInventory"`
				} `json:"prizes"`
				PublicBoard struct {
					Entries []struct {
						Key         string `json:"key"`
						OwnerUserID int64  `json:"ownerUserId"`
						CanSteal    bool   `json:"canSteal"`
					} `json:"entries"`
				} `json:"publicBoard"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode claim response failed: %v", err)
	}
	if !payload.Success || payload.Data.PrizeKey != "diamond" {
		t.Fatalf("unexpected claim response: %+v", payload)
	}
	if len(payload.Data.Status.VisiblePrizes) != 0 {
		t.Fatalf("claimed visible prize should be removed from status: %+v", payload.Data.Status.VisiblePrizes)
	}
	if !hasEcoClaimedPrize(payload.Data.Status.Prizes, "diamond", 1, 1, 0) {
		t.Fatalf("status should include claimed public diamond: %+v", payload.Data.Status.Prizes)
	}
	if len(payload.Data.Status.PublicBoard.Entries) == 0 || payload.Data.Status.PublicBoard.Entries[0].OwnerUserID != userID || payload.Data.Status.PublicBoard.Entries[0].CanSteal {
		t.Fatalf("unexpected public board after claim: %+v", payload.Data.Status.PublicBoard)
	}

	var visibleCount int64
	var inventoryCount int64
	var limitedCount int64
	var lotPublicEntryID string
	var publicCount int64
	var claimCount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT COUNT(*) FROM eco_visible_prizes WHERE user_id = $1),
		   i.inventory_count,
		   i.limited_count,
		   COALESCE(l.public_entry_id, ''),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE owner_user_id = $1 AND prize_key = 'diamond'),
		   (SELECT claim_count FROM eco_prize_claim_stats WHERE stat_date = $2::date AND prize_key = 'diamond')
		 FROM eco_prize_inventory i
		 JOIN eco_prize_lots l ON l.user_id = i.user_id AND l.prize_key = i.prize_key
		 WHERE i.user_id = $1 AND i.prize_key = 'diamond'`,
		userID,
		time.Now().UTC().Add(8*time.Hour).Format("2006-01-02"),
	).Scan(&visibleCount, &inventoryCount, &limitedCount, &lotPublicEntryID, &publicCount, &claimCount); err != nil {
		t.Fatalf("query claim result failed: %v", err)
	}
	if visibleCount != 0 || inventoryCount != 1 || limitedCount != 1 || lotPublicEntryID == "" || publicCount != 1 || claimCount < 1 {
		t.Fatalf("unexpected stored claim result: visible=%d inventory=%d limited=%d publicEntry=%s public=%d claims=%d", visibleCount, inventoryCount, limitedCount, lotPublicEntryID, publicCount, claimCount)
	}
}

func TestEcoStealPrizeRouteMovesPublicLotToThiefInventory(t *testing.T) {
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

	ownerUserID := int64(30001 + time.Now().UnixNano()%1_000_000_000)
	thiefUserID := ownerUserID + 1_000_000_000
	cleanupHTTPTestEcoUser(t, ctx, db, ownerUserID)
	cleanupHTTPTestEcoUser(t, ctx, db, thiefUserID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, ownerUserID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, thiefUserID)

	nowMs := time.Now().UnixMilli()
	ownerLotID := "steal-owner-lot-" + strconv.FormatInt(ownerUserID, 10)
	publicID := "steal-public-" + strconv.FormatInt(ownerUserID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now()), ($3, $4, $4, now(), now())`,
		ownerUserID,
		"eco_owner_"+strconv.FormatInt(ownerUserID, 10),
		thiefUserID,
		"eco_thief_"+strconv.FormatInt(thiefUserID, 10),
	); err != nil {
		t.Fatalf("seed steal users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now()), ($2, 0, now())`,
		ownerUserID,
		thiefUserID,
	); err != nil {
		t.Fatalf("seed steal point accounts failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, lifetime_points, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES
		   ($1, 0, 0, 0, $3, $3, $3, '{}'::jsonb),
		   ($2, 0, 0, 0, $3, $3, $3, '{}'::jsonb)`,
		ownerUserID,
		thiefUserID,
		nowMs,
	); err != nil {
		t.Fatalf("seed steal eco states failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'diamond', 1, 1, 1)`,
		ownerUserID,
	); err != nil {
		t.Fatalf("seed steal owner inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms
		 ) VALUES (
		   $1, $2, 'diamond', $3, $3, true, 'claim', $4, $3, $3
		 )`,
		ownerLotID,
		ownerUserID,
		nowMs-1000,
		publicID,
	); err != nil {
		t.Fatalf("seed steal owner lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES (
		   $1, 'diamond', $2, 'eco owner', $3, $4, $4, 'listed'
		 )`,
		publicID,
		ownerUserID,
		ownerLotID,
		nowMs-1000,
	); err != nil {
		t.Fatalf("seed steal public prize failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/steal", strings.NewReader(`{"entryId":"`+publicID+`","message":"test message"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(thiefUserID, "eco_thief_user", "Eco Thief User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Status struct {
				Prizes []struct {
					Key                       string `json:"key"`
					Inventory                 int64  `json:"inventory"`
					StolenInventory           int64  `json:"stolenInventory"`
					BlackMarketAvailableCount int64  `json:"blackMarketAvailableCount"`
				} `json:"prizes"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode steal response failed: %v", err)
	}
	if !payload.Success || !hasEcoStolenPrize(payload.Data.Status.Prizes, "diamond", 1, 1, 0) {
		t.Fatalf("unexpected steal response: %+v", payload)
	}

	var ownerInventory int64
	var ownerLimited int64
	var ownerLotCount int64
	var thiefInventory int64
	var thiefLimited int64
	var thiefLotCount int64
	var publicStatus string
	var publicThiefID int64
	var publicMessage string
	var theftCount int64
	var unresolved bool
	var theftBlackMarketAt int64
	if err := db.QueryRow(ctx,
		`SELECT
		   owner_i.inventory_count,
		   owner_i.limited_count,
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND prize_key = 'diamond'),
		   thief_i.inventory_count,
		   thief_i.limited_count,
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $2 AND prize_key = 'diamond' AND source = 'stolen'),
		   p.status,
		   COALESCE(p.thief_user_id, 0),
		   COALESCE(p.theft_message, ''),
		   (SELECT COUNT(*) FROM eco_thefts WHERE thief_user_id = $2 AND public_entry_id = $3),
		   (SELECT resolved_at_ms IS NULL FROM eco_thefts WHERE thief_user_id = $2 AND public_entry_id = $3),
		   (SELECT black_market_available_at_ms FROM eco_thefts WHERE thief_user_id = $2 AND public_entry_id = $3)
		 FROM eco_prize_inventory owner_i
		 JOIN eco_prize_inventory thief_i ON thief_i.user_id = $2 AND thief_i.prize_key = 'diamond'
		 JOIN eco_public_prizes p ON p.id = $3
		 WHERE owner_i.user_id = $1 AND owner_i.prize_key = 'diamond'`,
		ownerUserID,
		thiefUserID,
		publicID,
	).Scan(&ownerInventory, &ownerLimited, &ownerLotCount, &thiefInventory, &thiefLimited, &thiefLotCount, &publicStatus, &publicThiefID, &publicMessage, &theftCount, &unresolved, &theftBlackMarketAt); err != nil {
		t.Fatalf("query steal result failed: %v", err)
	}
	if ownerInventory != 0 || ownerLimited != 0 || ownerLotCount != 0 || thiefInventory != 1 || thiefLimited != 1 || thiefLotCount != 1 || publicStatus != "stolen" || publicThiefID != thiefUserID || publicMessage != "test message" || theftCount != 1 || !unresolved || theftBlackMarketAt <= nowMs {
		t.Fatalf("unexpected stored steal result: ownerInventory=%d ownerLimited=%d ownerLots=%d thiefInventory=%d thiefLimited=%d thiefLots=%d publicStatus=%s publicThief=%d message=%s theftCount=%d unresolved=%v blackMarketAt=%d",
			ownerInventory, ownerLimited, ownerLotCount, thiefInventory, thiefLimited, thiefLotCount, publicStatus, publicThiefID, publicMessage, theftCount, unresolved, theftBlackMarketAt)
	}
}

func TestEcoSellPrizeRouteCreditsPointsAndRemovesPublicLot(t *testing.T) {
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

	userID := int64(31001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	lotID := "sell-lot-" + strconv.FormatInt(userID, 10)
	publicID := "sell-public-" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_sell_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed sell user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed sell point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, lifetime_points, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 0, 0, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed sell eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'diamond', 1, 1, 1)`,
		userID,
	); err != nil {
		t.Fatalf("seed sell inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms
		 ) VALUES (
		   $1, $2, 'diamond', $3, $3, true, 'claim', $4, $3, $3
		 )`,
		lotID,
		userID,
		nowMs-1000,
		publicID,
	); err != nil {
		t.Fatalf("seed sell lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES (
		   $1, 'diamond', $2, 'eco seller', $3, $4, $4, 'listed'
		 )`,
		publicID,
		userID,
		lotID,
		nowMs-1000,
	); err != nil {
		t.Fatalf("seed sell public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('diamond', 1)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = 1`,
	); err != nil {
		t.Fatalf("seed sell global stock failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/sell", strings.NewReader(`{"key":"diamond","quantity":1}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_sell_user", "Eco Sell User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			PrizeKey     string `json:"prizeKey"`
			QuantitySold int64  `json:"quantitySold"`
			Price        int64  `json:"price"`
			PointsEarned int64  `json:"pointsEarned"`
			Status       struct {
				Points int64 `json:"points"`
				Prizes []struct {
					Key               string `json:"key"`
					Inventory         int64  `json:"inventory"`
					PublicInventory   int64  `json:"publicInventory"`
					SellableInventory int64  `json:"sellableInventory"`
				} `json:"prizes"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode sell response failed: %v", err)
	}
	if !payload.Success || payload.Data.PrizeKey != "diamond" || payload.Data.QuantitySold != 1 || payload.Data.Price <= 0 || payload.Data.PointsEarned != payload.Data.Price || payload.Data.Status.Points != payload.Data.PointsEarned {
		t.Fatalf("unexpected sell response: %+v", payload)
	}
	if !hasEcoClaimedPrize(payload.Data.Status.Prizes, "diamond", 0, 0, 0) {
		t.Fatalf("status should show sold diamond removed: %+v", payload.Data.Status.Prizes)
	}

	var balance int64
	var inventoryCount int64
	var limitedCount int64
	var lotCount int64
	var publicCount int64
	var globalStock int64
	var ledgerAmount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   a.balance,
		   i.inventory_count,
		   i.limited_count,
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND prize_key = 'diamond'),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE id = $2),
		   (SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'),
		   l.amount
		 FROM point_accounts a
		 JOIN eco_prize_inventory i ON i.user_id = a.user_id AND i.prize_key = 'diamond'
		 JOIN point_ledger l ON l.user_id = a.user_id AND l.description = '环保行动出售·钻石'
		 WHERE a.user_id = $1`,
		userID,
		publicID,
	).Scan(&balance, &inventoryCount, &limitedCount, &lotCount, &publicCount, &globalStock, &ledgerAmount); err != nil {
		t.Fatalf("query sell result failed: %v", err)
	}
	if balance != payload.Data.PointsEarned || inventoryCount != 0 || limitedCount != 0 || lotCount != 0 || publicCount != 0 || globalStock != 0 || ledgerAmount != payload.Data.PointsEarned {
		t.Fatalf("unexpected stored sell result: balance=%d inventory=%d limited=%d lots=%d public=%d stock=%d ledger=%d earned=%d", balance, inventoryCount, limitedCount, lotCount, publicCount, globalStock, ledgerAmount, payload.Data.PointsEarned)
	}
}

func TestEcoMerchantSellPrizeRouteCreditsPointsAndRemovesPublicLot(t *testing.T) {
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

	userID := int64(32001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestEcoUser(t, ctx, db, userID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, userID)

	nowMs := time.Now().UnixMilli()
	lotID := "merchant-lot-" + strconv.FormatInt(userID, 10)
	publicID := "merchant-public-" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		"eco_merchant_"+strconv.FormatInt(userID, 10),
	); err != nil {
		t.Fatalf("seed merchant user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		userID,
	); err != nil {
		t.Fatalf("seed merchant point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, lifetime_points, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 0, 0, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed merchant eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'diamond', 1, 1, 1)`,
		userID,
	); err != nil {
		t.Fatalf("seed merchant inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms
		 ) VALUES (
		   $1, $2, 'diamond', $3, $3, true, 'claim', $4, $3, $3
		 )`,
		lotID,
		userID,
		nowMs-1000,
		publicID,
	); err != nil {
		t.Fatalf("seed merchant lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status
		 ) VALUES (
		   $1, 'diamond', $2, 'eco merchant', $3, $4, $4, 'listed'
		 )`,
		publicID,
		userID,
		lotID,
		nowMs-1000,
	); err != nil {
		t.Fatalf("seed merchant public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('diamond', 1)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = 1`,
	); err != nil {
		t.Fatalf("seed merchant global stock failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/merchant-sell", strings.NewReader(`{"key":"diamond"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "eco_merchant_user", "Eco Merchant User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			PrizeKey     string `json:"prizeKey"`
			QuantitySold int64  `json:"quantitySold"`
			Price        int64  `json:"price"`
			PointsEarned int64  `json:"pointsEarned"`
			Status       struct {
				Points int64 `json:"points"`
				Prizes []struct {
					Key               string `json:"key"`
					Inventory         int64  `json:"inventory"`
					PublicInventory   int64  `json:"publicInventory"`
					SellableInventory int64  `json:"sellableInventory"`
				} `json:"prizes"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode merchant response failed: %v", err)
	}
	if !payload.Success || payload.Data.PrizeKey != "diamond" || payload.Data.QuantitySold != 1 || payload.Data.Price <= 0 || payload.Data.PointsEarned != payload.Data.Price || payload.Data.Status.Points != payload.Data.PointsEarned {
		t.Fatalf("unexpected merchant response: %+v", payload)
	}
	if !hasEcoClaimedPrize(payload.Data.Status.Prizes, "diamond", 0, 0, 0) {
		t.Fatalf("status should show merchant sold diamond removed: %+v", payload.Data.Status.Prizes)
	}

	var balance int64
	var inventoryCount int64
	var limitedCount int64
	var lotCount int64
	var publicCount int64
	var globalStock int64
	var ledgerAmount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   a.balance,
		   i.inventory_count,
		   i.limited_count,
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND prize_key = 'diamond'),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE id = $2),
		   (SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'),
		   l.amount
		 FROM point_accounts a
		 JOIN eco_prize_inventory i ON i.user_id = a.user_id AND i.prize_key = 'diamond'
		 JOIN point_ledger l ON l.user_id = a.user_id AND l.description = '环保行动商人收购·钻石'
		 WHERE a.user_id = $1`,
		userID,
		publicID,
	).Scan(&balance, &inventoryCount, &limitedCount, &lotCount, &publicCount, &globalStock, &ledgerAmount); err != nil {
		t.Fatalf("query merchant result failed: %v", err)
	}
	if balance != payload.Data.PointsEarned || inventoryCount != 0 || limitedCount != 0 || lotCount != 0 || publicCount != 0 || globalStock != 0 || ledgerAmount != payload.Data.PointsEarned {
		t.Fatalf("unexpected stored merchant result: balance=%d inventory=%d limited=%d lots=%d public=%d stock=%d ledger=%d earned=%d", balance, inventoryCount, limitedCount, lotCount, publicCount, globalStock, ledgerAmount, payload.Data.PointsEarned)
	}
}

func TestEcoBlackMarketSellPrizeRouteResolvesTheftAndRemovesPublicLot(t *testing.T) {
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

	thiefUserID := int64(33001 + time.Now().UnixNano()%1_000_000_000)
	ownerUserID := thiefUserID + 1_000_000_000
	cleanupHTTPTestEcoUser(t, ctx, db, thiefUserID)
	cleanupHTTPTestEcoUser(t, ctx, db, ownerUserID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, thiefUserID)
	defer cleanupHTTPTestEcoUser(t, ctx, db, ownerUserID)

	nowMs := time.Now().UnixMilli()
	theftID := "black-theft-" + strconv.FormatInt(thiefUserID, 10)
	thiefLotID := "black-lot-" + strconv.FormatInt(thiefUserID, 10)
	ownerLotID := "black-owner-lot-" + strconv.FormatInt(ownerUserID, 10)
	publicID := "black-public-" + strconv.FormatInt(ownerUserID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now()), ($3, $4, $4, now(), now())`,
		thiefUserID,
		"eco_black_"+strconv.FormatInt(thiefUserID, 10),
		ownerUserID,
		"eco_black_owner_"+strconv.FormatInt(ownerUserID, 10),
	); err != nil {
		t.Fatalf("seed black market users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())`,
		thiefUserID,
	); err != nil {
		t.Fatalf("seed black market point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, pending, point_buffer, lifetime_points, last_tick_at_ms,
		   created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, 0, 0, 0, $2, $2, $2, '{}'::jsonb
		 )`,
		thiefUserID,
		nowMs,
	); err != nil {
		t.Fatalf("seed black market eco state failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_inventory (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
		 VALUES ($1, 'diamond', 1, 1, 1)`,
		thiefUserID,
	); err != nil {
		t.Fatalf("seed black market inventory failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_prize_lots (
		   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		   stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms
		 ) VALUES (
		   $1, $2, 'diamond', $3, $3, true, 'stolen', $4, $3, $5, $3
		 )`,
		thiefLotID,
		thiefUserID,
		nowMs-1000,
		ownerUserID,
		theftID,
	); err != nil {
		t.Fatalf("seed black market lot failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_public_prizes (
		   id, prize_key, owner_user_id, owner_name, owner_lot_id,
		   public_at_ms, merchant_available_at_ms, status,
		   thief_user_id, thief_name, theft_message, stolen_at_ms
		 ) VALUES (
		   $1, 'diamond', $2, 'eco owner', $3, $4, $4, 'stolen',
		   $5, 'eco thief', 'test', $4
		 )`,
		publicID,
		ownerUserID,
		ownerLotID,
		nowMs-1000,
		thiefUserID,
	); err != nil {
		t.Fatalf("seed black market public prize failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_thefts (
		   id, prize_key, original_user_id, thief_user_id, public_entry_id,
		   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
		   black_market_available_at_ms, message
		 ) VALUES (
		   $1, 'diamond', $2, $3, $4, $5, $6, $7, $7, $7, 'test'
		 )`,
		theftID,
		ownerUserID,
		thiefUserID,
		publicID,
		ownerLotID,
		thiefLotID,
		nowMs-1000,
	); err != nil {
		t.Fatalf("seed black market theft failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
		 VALUES ('diamond', 1)
		 ON CONFLICT (prize_key) DO UPDATE SET claimed_count = 1`,
	); err != nil {
		t.Fatalf("seed black market global stock failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/games/eco/black-market-sell", strings.NewReader(`{"key":"diamond"}`))
	request.Host = "example.com"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(thiefUserID, "eco_black_user", "Eco Black User"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			PrizeKey     string `json:"prizeKey"`
			QuantitySold int64  `json:"quantitySold"`
			Price        int64  `json:"price"`
			PointsEarned int64  `json:"pointsEarned"`
			Status       struct {
				Points int64 `json:"points"`
				Prizes []struct {
					Key                       string `json:"key"`
					Inventory                 int64  `json:"inventory"`
					StolenInventory           int64  `json:"stolenInventory"`
					BlackMarketAvailableCount int64  `json:"blackMarketAvailableCount"`
				} `json:"prizes"`
			} `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode black market response failed: %v", err)
	}
	if !payload.Success || payload.Data.PrizeKey != "diamond" || payload.Data.QuantitySold != 1 || payload.Data.Price != 15000 || payload.Data.PointsEarned != 15000 || payload.Data.Status.Points != 15000 {
		t.Fatalf("unexpected black market response: %+v", payload)
	}
	if !hasEcoStolenPrize(payload.Data.Status.Prizes, "diamond", 0, 0, 0) {
		t.Fatalf("status should show black market diamond removed: %+v", payload.Data.Status.Prizes)
	}

	var balance int64
	var inventoryCount int64
	var limitedCount int64
	var lotCount int64
	var publicCount int64
	var globalStock int64
	var ledgerAmount int64
	var resolvedAt int64
	var outcome string
	if err := db.QueryRow(ctx,
		`SELECT
		   a.balance,
		   i.inventory_count,
		   i.limited_count,
		   (SELECT COUNT(*) FROM eco_prize_lots WHERE user_id = $1 AND prize_key = 'diamond'),
		   (SELECT COUNT(*) FROM eco_public_prizes WHERE id = $2),
		   (SELECT claimed_count FROM eco_global_prize_stock WHERE prize_key = 'diamond'),
		   l.amount,
		   t.resolved_at_ms,
		   t.outcome
		 FROM point_accounts a
		 JOIN eco_prize_inventory i ON i.user_id = a.user_id AND i.prize_key = 'diamond'
		 JOIN point_ledger l ON l.user_id = a.user_id AND l.description = '环保行动黑市出售·钻石'
		 JOIN eco_thefts t ON t.id = $3
		 WHERE a.user_id = $1`,
		thiefUserID,
		publicID,
		theftID,
	).Scan(&balance, &inventoryCount, &limitedCount, &lotCount, &publicCount, &globalStock, &ledgerAmount, &resolvedAt, &outcome); err != nil {
		t.Fatalf("query black market result failed: %v", err)
	}
	if balance != 15000 || inventoryCount != 0 || limitedCount != 0 || lotCount != 0 || publicCount != 0 || globalStock != 0 || ledgerAmount != 15000 || resolvedAt <= 0 || outcome != "escaped" {
		t.Fatalf("unexpected stored black market result: balance=%d inventory=%d limited=%d lots=%d public=%d stock=%d ledger=%d resolved=%d outcome=%s", balance, inventoryCount, limitedCount, lotCount, publicCount, globalStock, ledgerAmount, resolvedAt, outcome)
	}
}

func cleanupHTTPTestEcoUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM eco_trash_rankings WHERE user_id = $1`,
		`DELETE FROM eco_item_purchases WHERE user_id = $1`,
		`DELETE FROM eco_visible_prizes WHERE user_id = $1`,
		`DELETE FROM eco_prize_lots WHERE user_id = $1`,
		`DELETE FROM eco_prize_inventory WHERE user_id = $1`,
		`DELETE FROM eco_user_upgrades WHERE user_id = $1`,
		`DELETE FROM eco_states WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup eco http user %d failed: %v", userID, err)
		}
	}
}

func hasEcoUpgradeLevel(upgrades []struct {
	Key   string `json:"key"`
	Level int64  `json:"level"`
}, key string, level int64) bool {
	for _, upgrade := range upgrades {
		if upgrade.Key == key && upgrade.Level == level {
			return true
		}
	}
	return false
}

func hasEcoItemPurchase(items []struct {
	Key            string `json:"key"`
	PurchasedToday int64  `json:"purchasedToday"`
}, key string, purchased int64) bool {
	for _, item := range items {
		if item.Key == key && item.PurchasedToday == purchased {
			return true
		}
	}
	return false
}

func hasEcoPrizeInventory(prizes []struct {
	Key               string `json:"key"`
	Inventory         int64  `json:"inventory"`
	SellableInventory int64  `json:"sellableInventory"`
}, key string, inventory int64, sellable int64) bool {
	for _, prize := range prizes {
		if prize.Key == key && prize.Inventory == inventory && prize.SellableInventory == sellable {
			return true
		}
	}
	return false
}

func hasEcoClaimedPrize(prizes []struct {
	Key               string `json:"key"`
	Inventory         int64  `json:"inventory"`
	PublicInventory   int64  `json:"publicInventory"`
	SellableInventory int64  `json:"sellableInventory"`
}, key string, inventory int64, publicInventory int64, sellable int64) bool {
	for _, prize := range prizes {
		if prize.Key == key && prize.Inventory == inventory && prize.PublicInventory == publicInventory && prize.SellableInventory == sellable {
			return true
		}
	}
	return false
}

func hasEcoStolenPrize(prizes []struct {
	Key                       string `json:"key"`
	Inventory                 int64  `json:"inventory"`
	StolenInventory           int64  `json:"stolenInventory"`
	BlackMarketAvailableCount int64  `json:"blackMarketAvailableCount"`
}, key string, inventory int64, stolenInventory int64, blackMarketAvailableCount int64) bool {
	for _, prize := range prizes {
		if prize.Key == key && prize.Inventory == inventory && prize.StolenInventory == stolenInventory && prize.BlackMarketAvailableCount == blackMarketAvailableCount {
			return true
		}
	}
	return false
}
