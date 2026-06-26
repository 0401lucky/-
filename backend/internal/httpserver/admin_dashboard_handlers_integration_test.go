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
	"testing"
	"time"

	"redemption/backend/internal/admindashboard"
	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAdminDashboardRouteAggregatesPostgresData(t *testing.T) {
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

	suffix := time.Now().UnixNano() % 1_000_000_000
	userID := int64(92001 + suffix)
	otherUserID := userID + 1
	inactiveUserID := userID + 2
	raffleID := "admin-dashboard-raffle-" + strconv.FormatInt(suffix, 10)
	alertID := "admin-dashboard-alert-" + strconv.FormatInt(suffix, 10)
	cleanupAdminDashboardHTTPTest(t, ctx, db, userID, otherUserID, inactiveUserID, raffleID, alertID)
	defer cleanupAdminDashboardHTTPTest(t, ctx, db, userID, otherUserID, inactiveUserID, raffleID, alertID)

	baseline, err := admindashboard.NewService(db).Get(ctx, true, time.Now(), "")
	if err != nil {
		t.Fatalf("query baseline dashboard failed: %v", err)
	}

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES
		   ($1, 'admin_dashboard_user_1', 'Dashboard User 1', now(), now()),
		   ($2, 'admin_dashboard_user_2', 'Dashboard User 2', now(), now()),
		   ($3, 'admin_dashboard_user_3', 'Dashboard User 3', now() - interval '40 days', now())`,
		userID,
		otherUserID,
		inactiveUserID,
	); err != nil {
		t.Fatalf("seed users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES
		   ($1, $3, 100, 'admin_adjust', 'in', 100, now()),
		   ($2, $3, -30, 'exchange', 'out', 70, now())`,
		"admin-dashboard-ledger-in-"+strconv.FormatInt(suffix, 10),
		"admin-dashboard-ledger-out-"+strconv.FormatInt(suffix, 10),
		userID,
	); err != nil {
		t.Fatalf("seed point ledger failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO exchange_logs (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
		 VALUES ($1, $2, 'dashboard-item', 'Dashboard 兑换项', 30, 1, 'lottery_spin', 1, now())`,
		"admin-dashboard-exchange-"+strconv.FormatInt(suffix, 10),
		userID,
	); err != nil {
		t.Fatalf("seed exchange log failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, prizes, trigger_type, threshold, status,
		   participants_count, winners_count, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, 'draw', 'Dashboard 抽奖', 'Dashboard 测试', '[]'::jsonb, 'manual', 1, 'active', 1, 0, 1, $2, $2)`,
		raffleID,
		nowMs,
	); err != nil {
		t.Fatalf("seed raffle failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, 'admin_dashboard_user_2', 1, $4)`,
		"admin-dashboard-entry-"+strconv.FormatInt(suffix, 10),
		raffleID,
		otherUserID,
		nowMs,
	); err != nil {
		t.Fatalf("seed raffle entry failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, 'admin-dashboard-session', 'memory', 'normal', 120, 10, '{}'::jsonb, now())`,
		"admin-dashboard-game-"+strconv.FormatInt(suffix, 10),
		otherUserID,
	); err != nil {
		t.Fatalf("seed game record failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO admin_alerts (id, level, name, message, tags, source_key, occurred_at_ms)
		 VALUES ($1, 'warning', 'dashboard_warning', 'Dashboard 测试告警', '{"scope":"integration"}'::jsonb, $2, $3)`,
		alertID,
		alertID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed admin alert failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	request := httptest.NewRequest(http.MethodGet, "/api/admin/dashboard?detect=1&refresh=1", nil)
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected dashboard 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Dashboard struct {
				Users struct {
					Total int64 `json:"total"`
					DAU   int64 `json:"dau"`
					MAU   int64 `json:"mau"`
				} `json:"users"`
				Redemption struct {
					TodayClaims       int64 `json:"todayClaims"`
					TodayLotterySpins int64 `json:"todayLotterySpins"`
				} `json:"redemption"`
				PointsFlow struct {
					TodayIn  int64 `json:"todayIn"`
					TodayOut int64 `json:"todayOut"`
					TodayNet int64 `json:"todayNet"`
				} `json:"pointsFlow"`
				Games struct {
					Participants      int64   `json:"participants"`
					ParticipationRate float64 `json:"participationRate"`
				} `json:"games"`
				Alerts struct {
					Active   int64 `json:"active"`
					Warning  int64 `json:"warning"`
					Critical int64 `json:"critical"`
				} `json:"alerts"`
			} `json:"dashboard"`
			Alerts struct {
				Active []struct {
					ID    string `json:"id"`
					Level string `json:"level"`
					Name  string `json:"name"`
				} `json:"active"`
				History []struct {
					ID       string `json:"id"`
					Resolved bool   `json:"resolved"`
				} `json:"history"`
			} `json:"alerts"`
			Detection *struct {
				ScannedUsers    int64 `json:"scannedUsers"`
				TriggeredAlerts int64 `json:"triggeredAlerts"`
			} `json:"detection"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode dashboard response failed: %v", err)
	}
	if !payload.Success {
		t.Fatalf("dashboard response should be successful: %+v", payload)
	}
	dashboard := payload.Data.Dashboard
	if dashboard.Users.Total != baseline.Dashboard.Users.Total+3 ||
		dashboard.Users.DAU != baseline.Dashboard.Users.DAU+2 ||
		dashboard.Users.MAU != baseline.Dashboard.Users.MAU+2 {
		t.Fatalf("unexpected user overview: %+v", dashboard.Users)
	}
	if dashboard.Redemption.TodayClaims != baseline.Dashboard.Redemption.TodayClaims+1 ||
		dashboard.Redemption.TodayLotterySpins != baseline.Dashboard.Redemption.TodayLotterySpins+1 {
		t.Fatalf("unexpected redemption overview: %+v", dashboard.Redemption)
	}
	if dashboard.PointsFlow.TodayIn != baseline.Dashboard.PointsFlow.TodayIn+100 ||
		dashboard.PointsFlow.TodayOut != baseline.Dashboard.PointsFlow.TodayOut+30 ||
		dashboard.PointsFlow.TodayNet != baseline.Dashboard.PointsFlow.TodayNet+70 {
		t.Fatalf("unexpected points flow: %+v", dashboard.PointsFlow)
	}
	expectedParticipants := baseline.Dashboard.Games.Participants + 1
	expectedRate := float64(0)
	if dashboard.Users.Total > 0 {
		expectedRate = float64(expectedParticipants) / float64(dashboard.Users.Total) * 100
		expectedRate = float64(int64(expectedRate*100+0.5)) / 100
	}
	if dashboard.Games.Participants != expectedParticipants || dashboard.Games.ParticipationRate != expectedRate {
		t.Fatalf("unexpected games overview: %+v", dashboard.Games)
	}
	if dashboard.Alerts.Active != 1 || dashboard.Alerts.Warning != 1 || dashboard.Alerts.Critical != 0 {
		t.Fatalf("unexpected alert overview: %+v", dashboard.Alerts)
	}
	if len(payload.Data.Alerts.Active) == 0 || payload.Data.Alerts.Active[0].ID != alertID || payload.Data.Alerts.Active[0].Level != "warning" {
		t.Fatalf("expected active alert in dashboard response: %+v", payload.Data.Alerts.Active)
	}
	if len(payload.Data.Alerts.History) == 0 || payload.Data.Alerts.History[0].ID != alertID {
		t.Fatalf("expected alert history in dashboard response: %+v", payload.Data.Alerts.History)
	}
	expectedScannedUsers := dashboard.Users.Total
	if expectedScannedUsers > 300 {
		expectedScannedUsers = 300
	}
	if payload.Data.Detection == nil || payload.Data.Detection.ScannedUsers != expectedScannedUsers || payload.Data.Detection.TriggeredAlerts != 0 {
		t.Fatalf("unexpected detection summary: %+v", payload.Data.Detection)
	}

	resolveRequest := httptest.NewRequest(http.MethodPost, "/api/admin/alerts/"+alertID+"/resolve", nil)
	resolveRequest.Header.Set("Origin", "http://example.com")
	resolveRequest.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	resolveResponse := performRequest(handler, resolveRequest)
	if resolveResponse.Code != http.StatusOK {
		t.Fatalf("expected resolve 200, got %d body=%s", resolveResponse.Code, resolveResponse.Body.String())
	}
	var resolved bool
	var resolvedBy *string
	if err := db.QueryRow(ctx, `SELECT resolved, resolved_by FROM admin_alerts WHERE id = $1`, alertID).Scan(&resolved, &resolvedBy); err != nil {
		t.Fatalf("query resolved alert failed: %v", err)
	}
	if !resolved || resolvedBy == nil || *resolvedBy != "admin" {
		t.Fatalf("alert should be resolved by admin, resolved=%v resolvedBy=%v", resolved, resolvedBy)
	}
}

func cleanupAdminDashboardHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, otherUserID int64, inactiveUserID int64, raffleID string, alertID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM admin_alerts WHERE id = $1 OR source_key = $1`, alertID)
	_, _ = db.Exec(ctx, `DELETE FROM admin_alert_point_baselines WHERE user_id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
	_, _ = db.Exec(ctx, `DELETE FROM game_records WHERE user_id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
	_, _ = db.Exec(ctx, `DELETE FROM exchange_logs WHERE user_id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
	_, _ = db.Exec(ctx, `DELETE FROM raffle_entries WHERE raffle_id = $1`, raffleID)
	_, _ = db.Exec(ctx, `DELETE FROM raffles WHERE id = $1`, raffleID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id IN ($1, $2, $3)`, userID, otherUserID, inactiveUserID)
}
