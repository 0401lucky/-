//go:build integration

package roguelite

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceCompleteGameAndReplayDuplicateSettlement(t *testing.T) {
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

	userID := int64(49001 + time.Now().UnixNano()%1_000_000_000)
	cleanupIntegrationUser(t, ctx, db, userID)
	defer cleanupIntegrationUser(t, ctx, db, userID)

	service := NewService(db)
	user := auth.User{ID: userID, Username: "roguelite_integration", DisplayName: "Roguelite Integration"}
	started, err := service.Start(ctx, user)
	if err != nil {
		t.Fatalf("start failed: %v", err)
	}
	if !started.Success || started.Session == nil || started.Session.ID == "" {
		t.Fatalf("unexpected start result: %+v", started)
	}

	session := loadIntegrationSession(t, ctx, db, started.Session.ID)
	session.StartedAt -= minFinishDurationMs + 500
	session.State.Status = StatusEscaped
	session.State.Floor = 4
	session.State.Player.FloorsCleared = 3
	session.State.Player.Stardust = 40
	session.State.Player.HP = 12
	session.State.Player.ExploredCells = 18
	session.State.Player.Relics = []RelicType{RelicBattleCharm, RelicStarCompass}
	session.ActionCount = MaxActions
	session.MoveCount = MaxActions
	session.Actions = repeatedServiceActions(retainedActionLogLimit)
	saveAdjustedIntegrationSession(t, ctx, db, session)

	submitted, err := service.Submit(ctx, user, SubmitInput{SessionID: session.ID})
	if err != nil {
		t.Fatalf("submit failed: %v", err)
	}
	if !submitted.Success || submitted.Record == nil || submitted.Record.SessionID != session.ID || !submitted.Record.Won {
		t.Fatalf("unexpected submit result: %+v", submitted)
	}
	if submitted.Record.StepsUsed != MaxActions {
		t.Fatalf("expected persisted move count %d, got %d", MaxActions, submitted.Record.StepsUsed)
	}

	var duplicateSuccesses atomic.Int64
	var waitGroup sync.WaitGroup
	for index := 0; index < 20; index++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			duplicate, err := service.Submit(ctx, user, SubmitInput{SessionID: session.ID})
			if err != nil {
				t.Errorf("duplicate submit failed: %v", err)
				return
			}
			if duplicate.Success && duplicate.Record != nil && duplicate.Record.ID == submitted.Record.ID {
				duplicateSuccesses.Add(1)
				return
			}
			t.Errorf("unexpected duplicate result: %+v", duplicate)
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
	if balance != submitted.PointsEarned {
		t.Fatalf("duplicate submit should not grant points twice, balance=%d points=%d", balance, submitted.PointsEarned)
	}
	var recordCount int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM game_records WHERE user_id = $1 AND game_type = $2`, userID, GameType).Scan(&recordCount); err != nil {
		t.Fatalf("query record count failed: %v", err)
	}
	if recordCount != 1 {
		t.Fatalf("expected exactly one roguelite record, got %d", recordCount)
	}
}

func repeatedServiceActions(count int) []Action {
	actions := make([]Action, 0, count)
	for index := 0; index < count; index++ {
		actions = append(actions, Action{Type: "move", To: StartPosition})
	}
	return actions
}

func loadIntegrationSession(t *testing.T, ctx context.Context, db *pgxpool.Pool, sessionID string) Session {
	t.Helper()
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT payload FROM game_sessions WHERE id = $1`, sessionID).Scan(&raw); err != nil {
		t.Fatalf("load session failed: %v", err)
	}
	var session Session
	if err := json.Unmarshal(raw, &session); err != nil {
		t.Fatalf("decode session failed: %v", err)
	}
	return session
}

func saveAdjustedIntegrationSession(t *testing.T, ctx context.Context, db *pgxpool.Pool, session Session) {
	t.Helper()
	raw, err := json.Marshal(session)
	if err != nil {
		t.Fatalf("marshal session failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`UPDATE game_sessions SET payload = $1, started_at = $2 WHERE id = $3`,
		raw,
		time.UnixMilli(session.StartedAt),
		session.ID,
	); err != nil {
		t.Fatalf("update session failed: %v", err)
	}
}

func cleanupIntegrationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
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
			t.Fatalf("cleanup user %d failed: %v", userID, err)
		}
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
