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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/roguelite"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRogueliteHTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
	ctx := context.Background()
	databaseURL := testDatabaseURL(t)

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(50001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestRogueliteUser(t, ctx, db, userID)
	defer cleanupHTTPTestRogueliteUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performRogueliteJSONRequest(handler, userID, http.MethodPost, "/api/games/roguelite/start", `{}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool                  `json:"success"`
		Data    roguelite.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || startPayload.Data.State.Status != roguelite.StatusPlaying {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	stepBody := `{"sessionId":"` + startPayload.Data.SessionID + `","action":{"type":"move","to":{"row":0,"col":0}}}`
	stepResponse := performRogueliteJSONRequest(handler, userID, http.MethodPost, "/api/games/roguelite/step", stepBody)
	if stepResponse.Code != http.StatusOK {
		t.Fatalf("expected step 200, got %d body=%s", stepResponse.Code, stepResponse.Body.String())
	}
	var stepPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Session roguelite.SessionView   `json:"session"`
			Outcome roguelite.ActionOutcome `json:"outcome"`
		} `json:"data"`
	}
	if err := json.NewDecoder(stepResponse.Body).Decode(&stepPayload); err != nil {
		t.Fatalf("decode step response failed: %v", err)
	}
	if !stepPayload.Success || stepPayload.Data.Session.ActionsCount != 1 || stepPayload.Data.Outcome.Message == "" {
		t.Fatalf("unexpected step payload: %+v", stepPayload)
	}

	session := loadRogueliteSessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	session.StartedAt -= 2500
	session.State.Status = roguelite.StatusEscaped
	session.State.Floor = 4
	session.State.Player.FloorsCleared = 3
	session.State.Player.Stardust = 40
	session.State.Player.HP = 12
	saveRogueliteSessionForHTTPTest(t, ctx, db, session)

	submitBody := `{"sessionId":"` + session.ID + `"}`
	submitResponse := performRogueliteJSONRequest(handler, userID, http.MethodPost, "/api/games/roguelite/submit", submitBody)
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64            `json:"pointsEarned"`
			Record       roguelite.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Record.SessionID != session.ID || !submitPayload.Data.Record.Won {
		t.Fatalf("unexpected submit payload: %+v", submitPayload)
	}

	var duplicateSuccesses atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performRogueliteJSONRequest(handler, userID, http.MethodPost, "/api/games/roguelite/submit", submitBody)
			if duplicate.Code == http.StatusOK {
				duplicateSuccesses.Add(1)
				return
			}
			t.Errorf("unexpected duplicate submit response: status=%d body=%s", duplicate.Code, duplicate.Body.String())
		}()
	}
	waitGroup.Wait()
	if duplicateSuccesses.Load() != 20 {
		t.Fatalf("duplicate submit should replay settled record, successes=%d", duplicateSuccesses.Load())
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	if balance != submitPayload.Data.PointsEarned {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d points=%d", balance, submitPayload.Data.PointsEarned)
	}
}

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}
	return databaseURL
}

func performRogueliteJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "roguelite_http_"+strconv.FormatInt(userID, 10), "Roguelite HTTP User"))
	return performRequest(handler, request)
}

func loadRogueliteSessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) roguelite.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load roguelite session failed: %v", err)
	}
	var session roguelite.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode roguelite session failed: %v", err)
	}
	return session
}

func saveRogueliteSessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, session roguelite.Session) {
	t.Helper()
	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("marshal adjusted session failed: %v", err)
	}
	if _, err := db.Exec(ctx, `UPDATE game_sessions SET payload = $1, started_at = $2 WHERE id = $3`, raw, time.UnixMilli(session.StartedAt), session.ID); err != nil {
		t.Fatalf("adjust roguelite session failed: %v", err)
	}
}

func cleanupHTTPTestRogueliteUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	statements := []string{
		`DELETE FROM game_records WHERE user_id = $1`,
		`DELETE FROM active_game_sessions WHERE user_id = $1`,
		`DELETE FROM game_sessions WHERE user_id = $1`,
		`DELETE FROM game_cooldowns WHERE user_id = $1`,
		`DELETE FROM game_daily_stats WHERE user_id = $1`,
		`DELETE FROM daily_game_points WHERE user_id = $1`,
		`DELETE FROM point_ledger WHERE user_id = $1`,
		`DELETE FROM point_accounts WHERE user_id = $1`,
		`DELETE FROM users WHERE id = $1`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(ctx, statement, userID); err != nil {
			t.Fatalf("cleanup roguelite http user %d failed: %v", userID, err)
		}
	}
}
