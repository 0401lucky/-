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
	"redemption/backend/internal/game2048"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGame2048HTTPCheckpointSubmitAndReplayDuplicateSettlement(t *testing.T) {
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

	resetInMemoryRateLimitsForTest()
	userID := int64(62048 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestGame2048User(t, ctx, db, userID)
	defer cleanupHTTPTestGame2048User(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performGame2048JSONRequest(handler, userID, http.MethodPost, "/api/games/2048/start", `{}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool                 `json:"success"`
		Data    game2048.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || !game2048.IsValidGrid(startPayload.Data.InitialGrid) {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	session := loadGame2048SessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	session.StartedAt -= 6000
	session.CheckpointGrid = game2048.Grid{
		{1024, 1024, 0, 0, 0},
		{0, 0, 0, 0, 0},
		{0, 0, 0, 0, 0},
		{0, 0, 0, 0, 0},
		{0, 0, 0, 0, 0},
	}
	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("marshal adjusted session failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`UPDATE game_sessions SET payload = $1, started_at = $2 WHERE id = $3`,
		raw,
		time.UnixMilli(session.StartedAt),
		session.ID,
	); err != nil {
		t.Fatalf("adjust session failed: %v", err)
	}

	checkpointResponse := performGame2048JSONRequest(handler, userID, http.MethodPost, "/api/games/2048/checkpoint", `{"sessionId":"`+session.ID+`","moves":["left"]}`)
	if checkpointResponse.Code != http.StatusOK {
		t.Fatalf("expected checkpoint 200, got %d body=%s", checkpointResponse.Code, checkpointResponse.Body.String())
	}
	var checkpointPayload struct {
		Success bool                 `json:"success"`
		Data    game2048.SessionView `json:"data"`
	}
	if err := json.NewDecoder(checkpointResponse.Body).Decode(&checkpointPayload); err != nil {
		t.Fatalf("decode checkpoint response failed: %v", err)
	}
	if !checkpointPayload.Success || checkpointPayload.Data.BaseScore != 2048 || checkpointPayload.Data.BaseMoves != 1 || checkpointPayload.Data.BaseMovesSubmitted != 1 {
		t.Fatalf("unexpected checkpoint payload: %+v", checkpointPayload)
	}

	submitBody := `{"sessionId":"` + session.ID + `","moves":[]}`
	submitResponse := performGame2048JSONRequest(handler, userID, http.MethodPost, "/api/games/2048/submit", submitBody)
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64           `json:"pointsEarned"`
			Record       game2048.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || submitPayload.Data.Record.Score != 2048 || submitPayload.Data.Record.HighestTile != 2048 || submitPayload.Data.PointsEarned != 96 {
		t.Fatalf("unexpected submit payload: %+v", submitPayload)
	}

	var duplicateSuccesses atomic.Int64
	var duplicateFailures atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performGame2048JSONRequest(handler, userID, http.MethodPost, "/api/games/2048/submit", submitBody)
			if duplicate.Code == http.StatusOK {
				duplicateSuccesses.Add(1)
				return
			}
			if duplicate.Code == http.StatusBadRequest {
				duplicateFailures.Add(1)
				return
			}
			t.Errorf("unexpected duplicate submit response: status=%d body=%s", duplicate.Code, duplicate.Body.String())
		}()
	}
	waitGroup.Wait()
	if duplicateSuccesses.Load() != 20 || duplicateFailures.Load() != 0 {
		t.Fatalf("duplicate submit should replay settled record, successes=%d failures=%d", duplicateSuccesses.Load(), duplicateFailures.Load())
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query balance failed: %v", err)
	}
	if balance != submitPayload.Data.PointsEarned {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d points=%d", balance, submitPayload.Data.PointsEarned)
	}
	var recordCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = $2`, userID, game2048.GameType).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one 2048 record, got %d", recordCount)
	}
}

func performGame2048JSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "game2048_http_"+strconv.FormatInt(userID, 10), "2048 HTTP User"))
	return performRequest(handler, request)
}

func loadGame2048SessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) game2048.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load 2048 session failed: %v", err)
	}
	var session game2048.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode 2048 session failed: %v", err)
	}
	return session
}

func cleanupHTTPTestGame2048User(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup 2048 http user %d failed: %v", userID, err)
		}
	}
}
