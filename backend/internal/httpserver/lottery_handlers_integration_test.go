//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestLotteryHandlersReadOnlyRoutes(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票 HTTP 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}
	resetLotteryHTTPConfig(t, ctx, db)
	defer resetLotteryHTTPConfig(t, ctx, db)

	userID := int64(99801 + time.Now().UnixNano()%1_000_000_000)
	recordID := "lottery_http_" + strconv.FormatInt(userID, 10)
	cleanupLotteryHTTPUser(t, ctx, db, userID, recordID)
	defer cleanupLotteryHTTPUser(t, ctx, db, userID, recordID)
	seedLotteryHTTPUser(t, ctx, db, userID, recordID)

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	anonymous := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/lottery", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous lottery 401, got %d body=%s", anonymous.Code, anonymous.Body.String())
	}

	pageRequest := httptest.NewRequest(http.MethodGet, "/api/lottery", nil)
	pageRequest.AddCookie(testSessionCookieFor(userID, "lottery_http_user", "Lottery HTTP User"))
	pageResponse := performRequest(handler, pageRequest)
	if pageResponse.Code != http.StatusOK {
		t.Fatalf("expected lottery page 200, got %d body=%s", pageResponse.Code, pageResponse.Body.String())
	}
	var pagePayload struct {
		Success            bool  `json:"success"`
		CanSpin            bool  `json:"canSpin"`
		HasSpunToday       bool  `json:"hasSpunToday"`
		ExtraSpins         int64 `json:"extraSpins"`
		DailySpinUsed      int64 `json:"dailySpinUsed"`
		DailySpinRemaining int64 `json:"dailySpinRemaining"`
		Records            []struct {
			ID            string `json:"id"`
			PointsAwarded *int64 `json:"pointsAwarded"`
		} `json:"records"`
	}
	if err := json.NewDecoder(pageResponse.Body).Decode(&pagePayload); err != nil {
		t.Fatalf("decode lottery page failed: %v", err)
	}
	if !pagePayload.Success || !pagePayload.CanSpin || !pagePayload.HasSpunToday || pagePayload.ExtraSpins != 1 || pagePayload.DailySpinUsed != 1 || pagePayload.DailySpinRemaining != 9 {
		t.Fatalf("unexpected lottery page payload: %+v", pagePayload)
	}
	if len(pagePayload.Records) != 1 || pagePayload.Records[0].ID != recordID || pagePayload.Records[0].PointsAwarded == nil || *pagePayload.Records[0].PointsAwarded != 30 {
		t.Fatalf("unexpected lottery page records: %+v", pagePayload.Records)
	}

	recordsRequest := httptest.NewRequest(http.MethodGet, "/api/lottery/records", nil)
	recordsRequest.AddCookie(testSessionCookieFor(userID, "lottery_http_user", "Lottery HTTP User"))
	recordsResponse := performRequest(handler, recordsRequest)
	if recordsResponse.Code != http.StatusOK {
		t.Fatalf("expected lottery records 200, got %d body=%s", recordsResponse.Code, recordsResponse.Body.String())
	}
	var recordsPayload struct {
		Success bool `json:"success"`
		Records []struct {
			ID           string `json:"id"`
			TierName     string `json:"tierName"`
			TierValue    int64  `json:"tierValue"`
			DirectCredit bool   `json:"directCredit"`
			CreatedAt    int64  `json:"createdAt"`
		} `json:"records"`
	}
	if err := json.NewDecoder(recordsResponse.Body).Decode(&recordsPayload); err != nil {
		t.Fatalf("decode lottery records failed: %v", err)
	}
	if !recordsPayload.Success || len(recordsPayload.Records) != 1 || recordsPayload.Records[0].ID != recordID || recordsPayload.Records[0].TierValue != 30 || recordsPayload.Records[0].DirectCredit {
		t.Fatalf("unexpected lottery records payload: %+v", recordsPayload)
	}

	rankingResponse := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/rankings/lottery?period=daily&limit=10", nil))
	if rankingResponse.Code != http.StatusOK {
		t.Fatalf("expected lottery period ranking 200, got %d body=%s", rankingResponse.Code, rankingResponse.Body.String())
	}
	var rankingPayload struct {
		Success           bool   `json:"success"`
		Period            string `json:"period"`
		PeriodKey         string `json:"periodKey"`
		TotalParticipants int64  `json:"totalParticipants"`
		Data              struct {
			Period            string `json:"period"`
			PeriodKey         string `json:"periodKey"`
			TotalParticipants int64  `json:"totalParticipants"`
			Ranking           []struct {
				UserID     string `json:"userId"`
				TotalValue int64  `json:"totalValue"`
				BestPrize  string `json:"bestPrize"`
				Count      int64  `json:"count"`
			} `json:"ranking"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rankingResponse.Body).Decode(&rankingPayload); err != nil {
		t.Fatalf("decode lottery period ranking failed: %v", err)
	}
	if !rankingPayload.Success || rankingPayload.Period != "daily" || rankingPayload.PeriodKey == "" || rankingPayload.TotalParticipants < 1 || len(rankingPayload.Data.Ranking) < 1 {
		t.Fatalf("unexpected lottery period ranking payload: %+v", rankingPayload)
	}

	dailyRankingResponse := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/lottery/ranking?limit=10", nil))
	if dailyRankingResponse.Code != http.StatusOK {
		t.Fatalf("expected lottery daily ranking 200, got %d body=%s", dailyRankingResponse.Code, dailyRankingResponse.Body.String())
	}
	var dailyRankingPayload struct {
		Success           bool  `json:"success"`
		TotalParticipants int64 `json:"totalParticipants"`
		Ranking           []struct {
			UserID     string `json:"userId"`
			TotalValue int64  `json:"totalValue"`
		} `json:"ranking"`
	}
	if err := json.NewDecoder(dailyRankingResponse.Body).Decode(&dailyRankingPayload); err != nil {
		t.Fatalf("decode lottery daily ranking failed: %v", err)
	}
	if !dailyRankingPayload.Success || dailyRankingPayload.TotalParticipants < 1 || len(dailyRankingPayload.Ranking) < 1 {
		t.Fatalf("unexpected lottery daily ranking payload: %+v", dailyRankingPayload)
	}

	nonAdminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/lottery", nil)
	nonAdminRequest.AddCookie(testSessionCookieFor(userID, "lottery_http_user", "Lottery HTTP User"))
	nonAdmin := performRequest(handler, nonAdminRequest)
	if nonAdmin.Code != http.StatusForbidden {
		t.Fatalf("expected non-admin lottery 403, got %d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}

	adminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/lottery?page=1&limit=50", nil)
	adminRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	adminResponse := performRequest(handler, adminRequest)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("expected admin lottery 200, got %d body=%s", adminResponse.Code, adminResponse.Body.String())
	}
	var adminPayload struct {
		Success bool `json:"success"`
		Config  struct {
			Mode           string `json:"mode"`
			DailySpinLimit int64  `json:"dailySpinLimit"`
		} `json:"config"`
		Tiers []struct {
			ID          string  `json:"id"`
			Probability float64 `json:"probability"`
		} `json:"tiers"`
		Stats struct {
			TotalCodes int64 `json:"totalCodes"`
		} `json:"stats"`
		Records []struct {
			ID string `json:"id"`
		} `json:"records"`
	}
	if err := json.NewDecoder(adminResponse.Body).Decode(&adminPayload); err != nil {
		t.Fatalf("decode admin lottery failed: %v", err)
	}
	if !adminPayload.Success || adminPayload.Config.Mode != "points" || adminPayload.Config.DailySpinLimit != 10 || len(adminPayload.Tiers) != 7 {
		t.Fatalf("unexpected admin lottery payload: %+v", adminPayload)
	}
	if len(adminPayload.Records) == 0 || adminPayload.Records[0].ID != recordID {
		t.Fatalf("expected seeded lottery record first, got %+v", adminPayload.Records)
	}
}

func TestLotterySpinHandlerWritesPointsMode(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票 HTTP 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	resetLotteryHTTPConfig(t, ctx, db)
	defer resetLotteryHTTPConfig(t, ctx, db)
	seedLotteryHTTPConfig(t, ctx, db, "pts_50", "星星 50积分", 50, 1)

	userID := int64(99851 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryHTTPUser(t, ctx, db, userID, "")
	defer cleanupLotteryHTTPUser(t, ctx, db, userID, "")

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	spinRequest := httptest.NewRequest(http.MethodPost, "/api/lottery/spin", nil)
	spinRequest.Header.Set("Origin", "http://example.com")
	spinRequest.AddCookie(testSessionCookieFor(userID, "lottery_spin_http", "Lottery Spin HTTP"))
	spinResponse := performRequest(handler, spinRequest)
	if spinResponse.Code != http.StatusOK {
		t.Fatalf("expected lottery spin 200, got %d body=%s", spinResponse.Code, spinResponse.Body.String())
	}
	var spinPayload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Record  struct {
			ID            string `json:"id"`
			TierValue     int64  `json:"tierValue"`
			PointsAwarded *int64 `json:"pointsAwarded"`
		} `json:"record"`
	}
	if err := json.NewDecoder(spinResponse.Body).Decode(&spinPayload); err != nil {
		t.Fatalf("decode lottery spin failed: %v", err)
	}
	if !spinPayload.Success || spinPayload.Record.ID == "" || spinPayload.Record.TierValue != 50 || spinPayload.Record.PointsAwarded == nil || *spinPayload.Record.PointsAwarded != 50 {
		t.Fatalf("unexpected lottery spin payload: %+v", spinPayload)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/api/lottery/spin", nil)
	secondRequest.Header.Set("Origin", "http://example.com")
	secondRequest.AddCookie(testSessionCookieFor(userID, "lottery_spin_http", "Lottery Spin HTTP"))
	secondResponse := performRequest(handler, secondRequest)
	if secondResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected second lottery spin 400, got %d body=%s", secondResponse.Code, secondResponse.Body.String())
	}

	var balance, usedCount, ledgerCount, recordCount, notificationCount int64
	var dailyFreeClaimed bool
	if err := db.QueryRow(ctx,
		`SELECT p.balance, d.used_count, d.daily_free_claimed,
		        (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'lottery_win'),
		        (SELECT COUNT(*) FROM lottery_records WHERE user_id = $1),
		        (SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND type = 'lottery_win')
		   FROM point_accounts p
		   JOIN lottery_daily_spins d ON d.user_id = p.user_id
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &usedCount, &dailyFreeClaimed, &ledgerCount, &recordCount, &notificationCount); err != nil {
		t.Fatalf("query lottery spin db facts failed: %v", err)
	}
	if balance != 50 || usedCount != 1 || !dailyFreeClaimed || ledgerCount != 1 || recordCount != 1 || notificationCount != 1 {
		t.Fatalf("unexpected lottery spin db facts balance=%d used=%d claimed=%v ledger=%d record=%d notification=%d",
			balance, usedCount, dailyFreeClaimed, ledgerCount, recordCount, notificationCount)
	}
}

func TestLotteryAdminConfigPatchPersistsPointsConfig(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票 HTTP 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	resetLotteryHTTPConfig(t, ctx, db)
	defer resetLotteryHTTPConfig(t, ctx, db)

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	request := httptest.NewRequest(http.MethodPatch, "/api/admin/lottery/config", strings.NewReader(lotteryConfigPatchBody(70, 30)))
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected lottery config patch 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Config  struct {
			Enabled        bool  `json:"enabled"`
			DailySpinLimit int64 `json:"dailySpinLimit"`
			Tiers          []struct {
				ID          string  `json:"id"`
				Probability float64 `json:"probability"`
				Enabled     bool    `json:"enabled"`
			} `json:"tiers"`
		} `json:"config"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode lottery config patch failed: %v", err)
	}
	if !payload.Success || payload.Config.Enabled || payload.Config.DailySpinLimit != 8 || len(payload.Config.Tiers) != 7 {
		t.Fatalf("unexpected lottery config patch payload: %+v", payload)
	}

	var storedLimit int64
	var storedEnabled bool
	var enabledTierCount int64
	if err := db.QueryRow(ctx,
		`SELECT c.daily_spin_limit, c.enabled,
		        (SELECT COUNT(*) FROM lottery_tiers WHERE enabled = true)
		   FROM lottery_configs c
		  WHERE c.id = 'default'`,
	).Scan(&storedLimit, &storedEnabled, &enabledTierCount); err != nil {
		t.Fatalf("query patched config failed: %v", err)
	}
	if storedLimit != 8 || storedEnabled || enabledTierCount != 2 {
		t.Fatalf("unexpected patched config limit=%d enabled=%v enabledTiers=%d", storedLimit, storedEnabled, enabledTierCount)
	}

	invalid := httptest.NewRequest(http.MethodPatch, "/api/admin/lottery/config", strings.NewReader(lotteryConfigPatchBody(70, 20)))
	invalid.Header.Set("Origin", "http://example.com")
	invalid.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	invalidResponse := performRequest(handler, invalid)
	if invalidResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected invalid lottery config 400, got %d body=%s", invalidResponse.Code, invalidResponse.Body.String())
	}
}

func TestNumberBombHandlersBetStateAdminAndCancel(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过彩票 HTTP 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(99871 + time.Now().UnixNano()%1_000_000_000)
	cleanupLotteryHTTPUser(t, ctx, db, userID, "")
	defer cleanupLotteryHTTPUser(t, ctx, db, userID, "")
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "number_bomb_http", "Number Bomb HTTP",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 100)`, userID); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards) VALUES ($1, 0, 0, 0)`, userID); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	betRequest := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/bet", strings.NewReader(`{"selectedNumber":4,"multiplier":2}`))
	betRequest.Header.Set("Origin", "http://example.com")
	betRequest.AddCookie(testSessionCookieFor(userID, "number_bomb_http", "Number Bomb HTTP"))
	betResponse := performRequest(handler, betRequest)
	if betResponse.Code != http.StatusOK {
		t.Fatalf("expected number bomb bet 200, got %d body=%s", betResponse.Code, betResponse.Body.String())
	}
	var betPayload struct {
		Success bool  `json:"success"`
		Balance int64 `json:"balance"`
		Bet     struct {
			ID             string `json:"id"`
			SelectedNumber int    `json:"selectedNumber"`
			Multiplier     int    `json:"multiplier"`
			TicketCost     int64  `json:"ticketCost"`
			Status         string `json:"status"`
		} `json:"bet"`
	}
	if err := json.NewDecoder(betResponse.Body).Decode(&betPayload); err != nil {
		t.Fatalf("decode number bomb bet failed: %v", err)
	}
	if !betPayload.Success || betPayload.Balance != 80 || betPayload.Bet.SelectedNumber != 4 || betPayload.Bet.Multiplier != 2 || betPayload.Bet.Status != "pending" {
		t.Fatalf("unexpected number bomb bet payload: %+v", betPayload)
	}

	stateRequest := httptest.NewRequest(http.MethodGet, "/api/lottery/number-bomb", nil)
	stateRequest.AddCookie(testSessionCookieFor(userID, "number_bomb_http", "Number Bomb HTTP"))
	stateResponse := performRequest(handler, stateRequest)
	if stateResponse.Code != http.StatusOK {
		t.Fatalf("expected number bomb state 200, got %d body=%s", stateResponse.Code, stateResponse.Body.String())
	}
	var statePayload struct {
		Success bool `json:"success"`
		Data    struct {
			Balance  int64 `json:"balance"`
			TodayBet *struct {
				ID           string `json:"id"`
				SystemNumber *int   `json:"systemNumber"`
			} `json:"todayBet"`
			YesterdaySystemNumber *int `json:"yesterdaySystemNumber"`
		} `json:"data"`
	}
	if err := json.NewDecoder(stateResponse.Body).Decode(&statePayload); err != nil {
		t.Fatalf("decode number bomb state failed: %v", err)
	}
	if !statePayload.Success || statePayload.Data.Balance != 80 || statePayload.Data.TodayBet == nil || statePayload.Data.TodayBet.SystemNumber != nil || statePayload.Data.YesterdaySystemNumber == nil {
		t.Fatalf("unexpected number bomb state payload: %+v", statePayload)
	}

	adminRequest := httptest.NewRequest(http.MethodGet, "/api/admin/lottery/number-bomb", nil)
	adminRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	adminResponse := performRequest(handler, adminRequest)
	if adminResponse.Code != http.StatusOK {
		t.Fatalf("expected admin number bomb 200, got %d body=%s", adminResponse.Code, adminResponse.Body.String())
	}
	var adminPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Date         string `json:"date"`
			SystemNumber int    `json:"systemNumber"`
			RecentStats  []struct {
				ParticipantCount int64            `json:"participantCount"`
				PendingCount     int64            `json:"pendingCount"`
				SelectedCounts   map[string]int64 `json:"selectedCounts"`
			} `json:"recentStats"`
		} `json:"data"`
	}
	if err := json.NewDecoder(adminResponse.Body).Decode(&adminPayload); err != nil {
		t.Fatalf("decode admin number bomb failed: %v", err)
	}
	if !adminPayload.Success || adminPayload.Data.Date == "" || adminPayload.Data.SystemNumber < 0 || len(adminPayload.Data.RecentStats) != 7 || adminPayload.Data.RecentStats[0].ParticipantCount < 1 || adminPayload.Data.RecentStats[0].PendingCount < 1 || adminPayload.Data.RecentStats[0].SelectedCounts["4"] < 1 {
		t.Fatalf("unexpected admin number bomb payload: %+v", adminPayload)
	}

	cancelRequest := httptest.NewRequest(http.MethodPost, "/api/lottery/number-bomb/cancel", nil)
	cancelRequest.Header.Set("Origin", "http://example.com")
	cancelRequest.AddCookie(testSessionCookieFor(userID, "number_bomb_http", "Number Bomb HTTP"))
	cancelResponse := performRequest(handler, cancelRequest)
	if cancelResponse.Code != http.StatusOK {
		t.Fatalf("expected number bomb cancel 200, got %d body=%s", cancelResponse.Code, cancelResponse.Body.String())
	}

	var balance int64
	var status string
	if err := db.QueryRow(ctx,
		`SELECT p.balance, b.status
		   FROM point_accounts p
		   JOIN number_bomb_bets b ON b.user_id = p.user_id
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &status); err != nil {
		t.Fatalf("query number bomb final facts failed: %v", err)
	}
	if balance != 100 || status != "cancelled" {
		t.Fatalf("unexpected number bomb final facts balance=%d status=%s", balance, status)
	}
}

func seedLotteryHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, recordID string) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())`,
		userID, "lottery_http_user", "Lottery HTTP User",
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)`, userID); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards)
		 VALUES ($1, 1, 0, 0)`,
		userID,
	); err != nil {
		t.Fatalf("seed user assets failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_daily_spins (user_id, spin_date, used_count, daily_free_claimed)
		 VALUES ($1, $2, 1, true)`,
		userID, time.Now().UTC().Add(8*time.Hour).Format("2006-01-02"),
	); err != nil {
		t.Fatalf("seed daily spin failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_records (id, user_id, username, tier_id, tier_name, tier_value, code, points_awarded, created_at_ms)
		 VALUES ($1, $2, $3, 'pts_30', '小狗 30积分', 30, '', 30, $4)`,
		recordID, userID, "lottery_http_user", time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed lottery record failed: %v", err)
	}
}

func lotteryConfigPatchBody(firstProbability float64, secondProbability float64) string {
	return fmt.Sprintf(`{
  "enabled": false,
  "mode": "points",
  "dailySpinLimit": 8,
  "tiers": [
    {"id":"pts_200","name":"橙子 200积分","value":200,"color":"#fb923c","probability":%.2f,"enabled":true},
    {"id":"pts_150","name":"钻石 150积分","value":150,"color":"#8b5cf6","probability":%.2f,"enabled":true},
    {"id":"pts_100","name":"金币 100积分","value":100,"color":"#facc15","probability":0,"enabled":false},
    {"id":"pts_50","name":"星星 50积分","value":50,"color":"#3b82f6","probability":0,"enabled":false},
    {"id":"pts_30","name":"小狗 30积分","value":30,"color":"#10b981","probability":0,"enabled":false},
    {"id":"pts_10","name":"小猫 10积分","value":10,"color":"#06b6d4","probability":0,"enabled":false},
    {"id":"pts_0","name":"谢谢惠顾","value":0,"color":"#ec4899","probability":0,"enabled":false}
  ]
}`, firstProbability, secondProbability)
}

func cleanupLotteryHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, recordID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1 OR data->>'lotteryRecordId' = $2`, userID, recordID)
	_, _ = db.Exec(ctx, `DELETE FROM game_records WHERE user_id = $1 OR session_id = $2`, userID, recordID)
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM number_bomb_bets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM lottery_daily_spins WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM lottery_records WHERE id = $1 OR user_id = $2`, recordID, userID)
	_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}

func resetLotteryHTTPConfig(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM lottery_tiers`); err != nil {
		t.Fatalf("reset lottery tiers failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM lottery_configs`); err != nil {
		t.Fatalf("reset lottery config failed: %v", err)
	}
}

func seedLotteryHTTPConfig(t *testing.T, ctx context.Context, db *pgxpool.Pool, tierID string, tierName string, tierValue int64, dailyLimit int64) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_configs (id, enabled, mode, daily_spin_limit, daily_direct_limit)
		 VALUES ('default', true, 'points', $1, 2000)`,
		dailyLimit,
	); err != nil {
		t.Fatalf("seed lottery config failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO lottery_tiers (id, name, value, probability, color, codes_count, used_count, enabled, sort_order)
		 VALUES ($1, $2, $3, 100, '#3b82f6', 0, 0, true, 1)`,
		tierID, tierName, tierValue,
	); err != nil {
		t.Fatalf("seed lottery tier failed: %v", err)
	}
}
