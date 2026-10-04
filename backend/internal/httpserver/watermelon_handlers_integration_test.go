//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/gamesummary"
	"redemption/backend/internal/gamewatermelon"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestWatermelonHTTPReplaySettlementAndSharedCap(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL 未设置")
	}
	ctx := context.Background()
	db, err := dbpostgres.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatal(err)
	}
	resetInMemoryRateLimitsForTest()
	userID := int64(95000 + time.Now().UnixNano()%1_000_000_000)
	defer cleanupHTTPTestGame2048User(t, ctx, db, userID)
	handler := New(Dependencies{Config: config.Config{SessionSecret: testSessionSecret}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), DB: db})
	call := func(action string, body any, target any, code int) {
		t.Helper()
		method, raw := http.MethodGet, []byte(nil)
		if body != nil {
			method = http.MethodPost
			raw, _ = json.Marshal(body)
		}
		response := performGame2048JSONRequest(handler, userID, method, "/api/games/watermelon/"+action, string(raw))
		if response.Code != code {
			t.Fatalf("%s got %d want %d: %s", action, response.Code, code, response.Body.String())
		}
		if target != nil {
			var envelope struct {
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(envelope.Data, target); err != nil {
				t.Fatal(err)
			}
		}
	}
	var start, duplicate gamewatermelon.SessionView
	call("start", map[string]any{}, &start, 200)
	call("start", map[string]any{}, &duplicate, 200)
	if start.SessionID == "" || duplicate.SessionID != start.SessionID {
		t.Fatal("start is not recoverable")
	}
	// A fresh round may not fast-forward more than the 2-second clock allowance.
	call("checkpoint", gamewatermelon.SubmitInput{SessionID: start.SessionID, ToTick: 600, Drops: []gamewatermelon.Drop{}}, nil, 400)
	// Use a deterministic seed and elapsed clock, never a forged reward/score.
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id=$1`, start.SessionID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var session gamewatermelon.Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatal(err)
	}
	session.Seed = "0123456789abcdef0123456789abcdef"
	session.State = gamewatermelon.Initial(session.Seed)
	session.StartedAt -= 60000
	raw, _ = json.Marshal(session)
	if _, err := db.Exec(ctx, `UPDATE game_sessions SET payload=$1 WHERE id=$2`, raw, session.ID); err != nil {
		t.Fatal(err)
	}
	var status gamewatermelon.StatusData
	call("status", nil, &status, 200)
	if status.ActiveSession == nil || status.ActiveSession.Seed != session.Seed {
		t.Fatal("missing recovery state")
	}
	state := session.State
	for end := 600; end <= 2400; end += 600 {
		drops := []gamewatermelon.Drop{}
		for tick := state.Tick; tick < end; tick += 120 {
			drops = append(drops, gamewatermelon.Drop{Tick: tick, X: 180})
		}
		segment := gamewatermelon.SubmitInput{SessionID: session.ID, BaseTick: state.Tick, BaseMoves: state.Drops, ToTick: end, Drops: drops}
		expected, err := gamewatermelon.Replay(session.Seed, state, end, drops)
		if err != nil {
			t.Fatal(err)
		}
		var view gamewatermelon.SessionView
		call("checkpoint", segment, &view, 200)
		if view.State.Score != expected.Score || view.BaseTick != end || view.BaseMoves != expected.Drops {
			t.Fatal("checkpoint diverged from real physics")
		}
		call("checkpoint", segment, nil, 400) // old token cannot consume drops twice
		state = expected
	}
	if gamewatermelon.CalculatePointReward(state.Score) < 3 {
		t.Fatalf("fixture needs a payable score, got %d", state.Score)
	}
	day := time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
	if _, err := db.Exec(ctx, `INSERT INTO daily_game_points(user_id,stat_date,earned_points) VALUES($1,$2,$3)`, userID, day, status.DailyLimit-2); err != nil {
		t.Fatal(err)
	}
	final := gamewatermelon.SubmitInput{SessionID: session.ID, BaseTick: state.Tick, BaseMoves: state.Drops, ToTick: state.Tick, Drops: []gamewatermelon.Drop{}}
	forged := map[string]any{"session_id": session.ID, "base_tick": state.Tick, "base_moves": state.Drops, "to_tick": state.Tick, "drops": []any{}, "score": 999999}
	call("submit", forged, nil, 400)
	raw, _ = json.Marshal(final)
	foreign := performGame2048JSONRequest(handler, userID+1, http.MethodPost, "/api/games/watermelon/submit", string(raw))
	if foreign.Code != 400 {
		t.Fatalf("another user can submit: %d", foreign.Code)
	}
	defer cleanupHTTPTestGame2048User(t, ctx, db, userID+1)
	// Simulate a lost response and retries arriving concurrently.
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			response := performGame2048JSONRequest(handler, userID, http.MethodPost, "/api/games/watermelon/submit", string(raw))
			if response.Code != 200 {
				t.Errorf("duplicate settle: %d %s", response.Code, response.Body.String())
				return
			}
			var result struct {
				Data gamewatermelon.SubmitResult `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Error(err)
				return
			}
			if result.Data.Record == nil || result.Data.PointsEarned != 2 || result.Data.Record.Score != state.Score {
				t.Errorf("wrong receipt: %+v", result.Data)
			}
		}()
	}
	wg.Wait()
	var balance, ledgerCount, recordCount int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id=$1`, userID).Scan(&balance); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM point_ledger WHERE user_id=$1`, userID).Scan(&ledgerCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id=$1`, userID).Scan(&recordCount); err != nil {
		t.Fatal(err)
	}
	if balance != 2 || ledgerCount != 1 || recordCount != 1 {
		t.Fatalf("duplicate payout: balance=%d ledger=%d records=%d", balance, ledgerCount, recordCount)
	}
	call("status", nil, &status, 200)
	if status.ActiveSession != nil || !status.PointsLimitReached || status.DailyRemaining != 0 || status.DailyStats.GamesPlayed != 1 {
		t.Fatalf("wrong status: %+v", status)
	}
	response := performGame2048JSONRequest(handler, userID, http.MethodGet, "/api/games/profile", "")
	var summary struct {
		Data gamesummary.ProfileData `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || summary.Data.PerGame["watermelon"].TotalPointsEarned != 2 || summary.Data.PerGame["watermelon"].TotalPlays != 1 {
		t.Fatal("game center does not include settled watermelon records")
	}
	if _, err := db.Exec(ctx, `DELETE FROM game_cooldowns WHERE user_id=$1`, userID); err != nil {
		t.Fatal(err)
	}
	call("start", map[string]any{}, &start, 200)
	call("cancel", map[string]any{"session_id": session.ID}, nil, 400)
	call("cancel", map[string]any{"session_id": start.SessionID}, nil, 200)
	call("cancel", map[string]any{"session_id": start.SessionID}, nil, 200)
}
