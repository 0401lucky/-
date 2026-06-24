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
	"redemption/backend/internal/linkgame"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLinkgameHTTPCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(47001 + time.Now().UnixNano()%1_000_000_000)
	cleanupHTTPTestLinkgameUser(t, ctx, db, userID)
	defer cleanupHTTPTestLinkgameUser(t, ctx, db, userID)

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	startResponse := performLinkgameJSONRequest(handler, userID, http.MethodPost, "/api/games/linkgame/start", `{"difficulty":"easy"}`)
	if startResponse.Code != http.StatusOK {
		t.Fatalf("expected start 200, got %d body=%s", startResponse.Code, startResponse.Body.String())
	}
	var startPayload struct {
		Success bool                 `json:"success"`
		Data    linkgame.SessionView `json:"data"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&startPayload); err != nil {
		t.Fatalf("decode start response failed: %v", err)
	}
	if !startPayload.Success || startPayload.Data.SessionID == "" || len(startPayload.Data.TileLayout) != 64 {
		t.Fatalf("unexpected start payload: %+v", startPayload)
	}

	session := loadLinkgameSessionForHTTPTest(t, ctx, db, startPayload.Data.SessionID)
	session.StartedAt -= 6000
	session.TileLayout = linkgameTestTwoTileBoard()
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

	submitBody := `{"sessionId":"` + session.ID + `","moves":[{"type":"match","pos1":{"row":0,"col":0},"pos2":{"row":0,"col":1},"matched":true,"timestamp":1}],"completed":true,"duration":6000}`
	submitResponse := performLinkgameJSONRequest(handler, userID, http.MethodPost, "/api/games/linkgame/submit", submitBody)
	if submitResponse.Code != http.StatusOK {
		t.Fatalf("expected submit 200, got %d body=%s", submitResponse.Code, submitResponse.Body.String())
	}
	var submitPayload struct {
		Success bool `json:"success"`
		Data    struct {
			PointsEarned int64           `json:"pointsEarned"`
			Record       linkgame.Record `json:"record"`
		} `json:"data"`
	}
	if err := json.NewDecoder(submitResponse.Body).Decode(&submitPayload); err != nil {
		t.Fatalf("decode submit response failed: %v", err)
	}
	if !submitPayload.Success || !submitPayload.Data.Record.Completed || submitPayload.Data.Record.Score <= 0 || submitPayload.Data.PointsEarned != 1 {
		t.Fatalf("unexpected submit payload: %+v", submitPayload)
	}

	var duplicateSuccesses atomic.Int64
	var duplicateFailures atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate := performLinkgameJSONRequest(handler, userID, http.MethodPost, "/api/games/linkgame/submit", submitBody)
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
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = 'linkgame'`, userID).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one linkgame record, got %d", recordCount)
	}
}

func performLinkgameJSONRequest(handler http.Handler, userID int64, method string, path string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Host = "example.com"
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(testSessionCookieFor(userID, "linkgame_http_"+strconv.FormatInt(userID, 10), "Linkgame HTTP User"))
	return performRequest(handler, request)
}

func loadLinkgameSessionForHTTPTest(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) linkgame.Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load linkgame session failed: %v", err)
	}
	var session linkgame.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode linkgame session failed: %v", err)
	}
	return session
}

func linkgameTestTwoTileBoard() []*string {
	config := linkgame.DifficultyConfigFor(linkgame.DifficultyEasy)
	board := make([]*string, config.Rows*config.Cols)
	tile := "A"
	board[0] = &tile
	tile2 := "A"
	board[1] = &tile2
	return board
}

func cleanupHTTPTestLinkgameUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup linkgame http user %d failed: %v", userID, err)
		}
	}
}
