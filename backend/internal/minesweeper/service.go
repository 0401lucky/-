package minesweeper

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sessionTTLSeconds      = int64(30 * 60)
	cooldownTTLSeconds     = int64(5)
	maxRecordsListSize     = 50
	defaultRecordsListSize = 10
	maxRetryableTxRetries  = 12
)

var ErrUnavailable = errors.New("minesweeper database unavailable")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) Start(ctx context.Context, user auth.User, input StartInput) (StartResult, error) {
	if service.db == nil {
		return StartResult{}, ErrUnavailable
	}
	difficulty := NormalizeDifficulty(input.Difficulty)

	var output StartResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		if remaining, err := cooldownRemaining(ctx, tx, user.ID, time.Now()); err != nil {
			return err
		} else if remaining > 0 {
			output = StartResult{Success: false, Message: fmt.Sprintf("请等待 %d 秒后再开始游戏", remaining)}
			return nil
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active != nil {
			if !input.Restart {
				output = StartResult{Success: false, Message: "你已有正在进行的游戏"}
				return nil
			}
			if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
				return err
			}
		}

		now := time.Now()
		nowMs := millis(now)
		seed := randomHex(16)
		session := Session{
			ID:         randomHex(16),
			UserID:     user.ID,
			GameType:   GameType,
			Difficulty: difficulty,
			Seed:       seed,
			StartedAt:  nowMs,
			ExpiresAt:  nowMs + sessionTTLSeconds*1000,
			Status:     "playing",
			State:      CreateInitialState(seed, difficulty),
			Actions:    []Action{},
		}
		if err := saveSession(ctx, tx, session); err != nil {
			return err
		}
		output = StartResult{Success: true, Session: &session}
		return nil
	})
	return output, err
}

func (service *Service) Status(ctx context.Context, user auth.User) (StatusData, error) {
	if service.db == nil {
		return StatusData{}, ErrUnavailable
	}

	var output StatusData
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		balance, err := getBalance(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		dailyStats, err := getDailyStats(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		remaining, err := cooldownRemaining(ctx, tx, user.ID, time.Now())
		if err != nil {
			return err
		}
		records, err := listRecords(ctx, tx, user.ID, defaultRecordsListSize)
		if err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		var activeView *SessionView
		if active != nil {
			view := BuildSessionView(*active, millis(time.Now()))
			activeView = &view
		}
		output = StatusData{
			Balance:            balance,
			DailyStats:         dailyStats,
			InCooldown:         remaining > 0,
			CooldownRemaining:  remaining,
			DailyLimit:         economy.DailyPointsLimit,
			PointsLimitReached: false,
			Records:            records,
			Difficulties:       DifficultyList(),
			ActiveSession:      activeView,
		}
		return nil
	})
	return output, err
}

func (service *Service) Step(ctx context.Context, user auth.User, input StepInput) (StepResult, error) {
	if service.db == nil {
		return StepResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	if input.SessionID == "" {
		return StepResult{Success: false, Message: "无效的会话ID"}, nil
	}
	isBatch := len(input.Actions) > 0
	if !isBatch && input.Action == nil {
		return StepResult{Success: false, Message: "无效的扫雷操作"}, nil
	}
	if isBatch && len(input.Actions) > MaxBatchActions {
		return StepResult{Success: false, Message: "单次操作过多"}, nil
	}

	var output StepResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := loadCurrentSession(ctx, tx, user.ID, input.SessionID)
		if err != nil {
			return err
		}
		if session == nil {
			output = StepResult{Success: false, Message: "游戏会话不存在或已过期"}
			return nil
		}
		if session.UserID != user.ID {
			output = StepResult{Success: false, Message: "会话不属于该用户"}
			return nil
		}
		if session.Status != "playing" || session.State.Status != StatusPlaying {
			output = StepResult{Success: false, Message: "游戏会话已结束"}
			return nil
		}
		now := time.Now()
		nowMs := millis(now)
		if nowMs > session.ExpiresAt {
			if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			output = StepResult{Success: false, Message: "游戏会话已过期"}
			return nil
		}
		if isBatch {
			if len(input.Actions) == 0 {
				output = StepResult{Success: false, Message: "操作不能为空"}
				return nil
			}
			if len(session.Actions)+len(input.Actions) > MaxActions {
				output = StepResult{Success: false, Message: "操作次数过多"}
				return nil
			}
			resolved := ResolveActions(session.State, input.Actions)
			if !resolved.OK {
				output = StepResult{Success: false, Message: resolved.Message}
				return nil
			}
			if resolved.State.Status != StatusPlaying && resolved.State.EndedAt == nil {
				resolved.State.EndedAt = &nowMs
			}
			if len(resolved.AppliedActions) > 0 {
				session.State = resolved.State
				session.Actions = append(session.Actions, resolved.AppliedActions...)
				if err := updateSession(ctx, tx, *session); err != nil {
					return err
				}
			}
			view := BuildSessionView(*session, nowMs)
			output = StepResult{Success: true, Session: &view, Outcomes: resolved.Outcomes, Skipped: resolved.Skipped}
			if len(resolved.Outcomes) > 0 {
				last := resolved.Outcomes[len(resolved.Outcomes)-1]
				output.Outcome = &last
			}
			return nil
		}

		if len(session.Actions)+1 > MaxActions {
			output = StepResult{Success: false, Message: "操作次数过多"}
			return nil
		}
		resolved := ResolveAction(session.State, *input.Action)
		if !resolved.OK {
			output = StepResult{Success: false, Message: resolved.Message}
			return nil
		}
		if resolved.State.Status != StatusPlaying && resolved.State.EndedAt == nil {
			resolved.State.EndedAt = &nowMs
		}
		session.State = resolved.State
		session.Actions = append(session.Actions, *input.Action)
		if err := updateSession(ctx, tx, *session); err != nil {
			return err
		}
		view := BuildSessionView(*session, nowMs)
		output = StepResult{Success: true, Session: &view, Outcome: &resolved.Outcome}
		return nil
	})
	return output, err
}

func (service *Service) Submit(ctx context.Context, user auth.User, input SubmitInput) (SubmitResult, error) {
	if service.db == nil {
		return SubmitResult{}, ErrUnavailable
	}
	input.SessionID = strings.TrimSpace(input.SessionID)
	if input.SessionID == "" {
		return SubmitResult{Success: false, Message: "无效的会话ID"}, nil
	}

	var output SubmitResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		session, err := getSessionForUpdate(ctx, tx, input.SessionID)
		if err != nil {
			return err
		}
		if session == nil {
			return service.settledRecordOrFailure(ctx, tx, user.ID, input.SessionID, "游戏会话不存在或已过期", &output)
		}
		if session.UserID != user.ID {
			output = SubmitResult{Success: false, Message: "会话不属于该用户"}
			return nil
		}
		if ok, err := isCurrentActiveSession(ctx, tx, user.ID, session.ID); err != nil {
			return err
		} else if !ok {
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已不是当前活跃局", &output)
		}
		if session.Status != "playing" {
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已结束", &output)
		}
		now := time.Now()
		nowMs := millis(now)
		if nowMs > session.ExpiresAt {
			if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
				return err
			}
			return service.settledRecordOrFailure(ctx, tx, user.ID, session.ID, "游戏会话已过期", &output)
		}
		if session.State.Status == StatusPlaying {
			output = SubmitResult{Success: false, Message: "请先完成本局再结算"}
			return nil
		}

		duration := sessionDuration(*session, nowMs)
		scoreBreakdown := CalculateScore(session.State, duration)
		pointReward := CalculatePointReward(scoreBreakdown.Total)
		pointsEarned, dailyEarned, err := addGamePointsWithLimit(
			ctx,
			tx,
			user,
			pointReward,
			economy.DailyPointsLimit,
			fmt.Sprintf("扫雷%s（%s）得分 %d，福利积分 %d", statusLabel(session.State.Status), DifficultyConfigFor(session.Difficulty).Label, scoreBreakdown.Total, pointReward),
		)
		if err != nil {
			return err
		}
		record := Record{
			ID:             randomHex(16),
			UserID:         user.ID,
			SessionID:      session.ID,
			GameType:       GameType,
			Difficulty:     session.Difficulty,
			Won:            session.State.Status == StatusWon,
			Score:          scoreBreakdown.Total,
			PointsEarned:   pointsEarned,
			Duration:       duration,
			Moves:          session.State.Moves,
			FlagsUsed:      session.State.FlagsUsed,
			RevealedSafe:   session.State.RevealedSafe,
			Mines:          session.State.Mines,
			ScoreBreakdown: scoreBreakdown,
			CreatedAt:      nowMs,
		}
		if err := insertRecord(ctx, tx, record); err != nil {
			return err
		}
		if err := incrementDailyStats(ctx, tx, user.ID, scoreBreakdown.Total, dailyEarned, now); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, session.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, now.Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SubmitResult{Success: true, Record: &record, PointsEarned: pointsEarned}
		return nil
	})
	return output, err
}

func (service *Service) Cancel(ctx context.Context, user auth.User) (SimpleResult, error) {
	if service.db == nil {
		return SimpleResult{}, ErrUnavailable
	}

	var output SimpleResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active == nil {
			output = SimpleResult{Success: false, Message: "没有正在进行的游戏"}
			return nil
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, time.Now().Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		output = SimpleResult{Success: true}
		return nil
	})
	return output, err
}

func (service *Service) settledRecordOrFailure(ctx context.Context, tx pgx.Tx, userID int64, sessionID string, message string, output *SubmitResult) error {
	record, err := findSettledRecord(ctx, tx, userID, sessionID)
	if err != nil {
		return err
	}
	if record != nil {
		*output = SubmitResult{Success: true, Record: record, PointsEarned: record.PointsEarned}
		return nil
	}
	*output = SubmitResult{Success: false, Message: message}
	return nil
}

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetryableTxRetries; attempt++ {
		tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}
		err = fn(tx)
		if err == nil {
			err = tx.Commit(ctx)
		}
		if err == nil {
			return nil
		}
		_ = tx.Rollback(ctx)
		lastErr = err
		if !isRetryableTxError(err) || attempt == maxRetryableTxRetries {
			return err
		}
		if err := sleepBeforeRetry(ctx, attempt); err != nil {
			return err
		}
	}
	return lastErr
}

func ensureUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID, user.Username, displayName,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func lockUserAccount(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance)
	return balance, err
}

func getBalance(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}

func cooldownRemaining(ctx context.Context, tx pgx.Tx, userID int64, now time.Time) (int64, error) {
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT expires_at FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`,
		userID, GameType,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if !expiresAt.After(now) {
		_, err := tx.Exec(ctx, `DELETE FROM game_cooldowns WHERE user_id = $1 AND game_type = $2`, userID, GameType)
		return 0, err
	}
	return int64(math.Ceil(expiresAt.Sub(now).Seconds())), nil
}

func getActiveSessionForUpdate(ctx context.Context, tx pgx.Tx, userID int64) (*Session, error) {
	var sessionID string
	var activeExpiresAt time.Time
	err := tx.QueryRow(ctx,
		`SELECT session_id, expires_at
		 FROM active_game_sessions
		 WHERE user_id = $1 AND game_type = $2
		 FOR UPDATE`,
		userID, GameType,
	).Scan(&sessionID, &activeExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !activeExpiresAt.After(time.Now()) {
		return nil, deleteSessionAndActive(ctx, tx, userID, sessionID)
	}
	return getSessionForUpdate(ctx, tx, sessionID)
}

func loadCurrentSession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Session, error) {
	active, err := getActiveSessionForUpdate(ctx, tx, userID)
	if err != nil || active == nil {
		return active, err
	}
	if active.ID != sessionID {
		return nil, nil
	}
	return active, nil
}

func getSessionForUpdate(ctx context.Context, tx pgx.Tx, sessionID string) (*Session, error) {
	var payload []byte
	err := tx.QueryRow(ctx,
		`SELECT payload
		 FROM game_sessions
		 WHERE id = $1 AND game_type = $2
		 FOR UPDATE`,
		sessionID, GameType,
	).Scan(&payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var session Session
	if err := json.Unmarshal(payload, &session); err != nil {
		return nil, err
	}
	session.Difficulty = NormalizeDifficulty(session.Difficulty)
	session.State.Difficulty = NormalizeDifficulty(session.State.Difficulty)
	if session.Actions == nil {
		session.Actions = []Action{}
	}
	return &session, nil
}

func saveSession(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	expiresAt := time.UnixMilli(session.ExpiresAt)
	if _, err := tx.Exec(ctx,
		`INSERT INTO game_sessions (id, user_id, game_type, status, payload, started_at, expires_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
		session.ID, session.UserID, session.GameType, session.Status, raw, time.UnixMilli(session.StartedAt), expiresAt,
	); err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO active_game_sessions (user_id, game_type, session_id, expires_at)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (user_id, game_type) DO UPDATE SET
		   session_id = excluded.session_id,
		   expires_at = excluded.expires_at`,
		session.UserID, session.GameType, session.ID, expiresAt,
	)
	return err
}

func updateSession(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE game_sessions
		 SET status = $1, payload = $2, updated_at = now()
		 WHERE id = $3 AND game_type = $4`,
		session.Status, raw, session.ID, GameType,
	)
	return err
}

func deleteSessionAndActive(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`, userID, GameType); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM game_sessions WHERE id = $1 AND game_type = $2`, sessionID, GameType)
	return err
}

func setCooldown(ctx context.Context, tx pgx.Tx, userID int64, expiresAt time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_cooldowns (user_id, game_type, expires_at, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, game_type) DO UPDATE SET
		   expires_at = excluded.expires_at,
		   updated_at = now()`,
		userID, GameType, expiresAt,
	)
	return err
}

func getDailyStats(ctx context.Context, tx pgx.Tx, userID int64) (DailyStats, error) {
	date := todayChina()
	var stats DailyStats
	var statDate time.Time
	var lastGameAt *time.Time
	err := tx.QueryRow(ctx,
		`SELECT user_id, stat_date, games_played, total_score, points_earned, last_game_at
		 FROM game_daily_stats
		 WHERE user_id = $1 AND stat_date = $2`,
		userID, date,
	).Scan(&stats.UserID, &statDate, &stats.GamesPlayed, &stats.TotalScore, &stats.PointsEarned, &lastGameAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return DailyStats{UserID: userID, Date: date}, nil
	}
	if err != nil {
		return DailyStats{}, err
	}
	stats.Date = statDate.Format("2006-01-02")
	if lastGameAt != nil {
		stats.LastGameAt = millis(*lastGameAt)
	}
	return stats, nil
}

func incrementDailyStats(ctx context.Context, tx pgx.Tx, userID int64, scoreDelta int64, cumulativePointsEarned int64, now time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO game_daily_stats (user_id, stat_date, games_played, total_score, points_earned, last_game_at, updated_at)
		 VALUES ($1, $2, 1, $3, $4, $5, now())
		 ON CONFLICT (user_id, stat_date) DO UPDATE SET
		   games_played = game_daily_stats.games_played + 1,
		   total_score = game_daily_stats.total_score + excluded.total_score,
		   points_earned = GREATEST(game_daily_stats.points_earned, excluded.points_earned),
		   last_game_at = excluded.last_game_at,
		   updated_at = now()`,
		userID, todayChina(), scoreDelta, cumulativePointsEarned, now,
	)
	return err
}

func addGamePointsWithLimit(ctx context.Context, tx pgx.Tx, user auth.User, points int64, dailyLimit int64, description string) (int64, int64, error) {
	if points < 0 {
		points = 0
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO daily_game_points (user_id, stat_date, earned_points, updated_at)
		 VALUES ($1, $2, 0, now())
		 ON CONFLICT (user_id, stat_date) DO NOTHING`,
		user.ID, todayChina(),
	); err != nil {
		return 0, 0, err
	}
	var dailyEarned int64
	if err := tx.QueryRow(ctx,
		`SELECT earned_points
		 FROM daily_game_points
		 WHERE user_id = $1 AND stat_date = $2
		 FOR UPDATE`,
		user.ID, todayChina(),
	).Scan(&dailyEarned); err != nil {
		return 0, 0, err
	}
	balance, err := lockUserAccount(ctx, tx, user.ID)
	if err != nil {
		return 0, 0, err
	}
	remaining := dailyLimit - dailyEarned
	if remaining < 0 {
		remaining = 0
	}
	grant := points
	if grant > remaining {
		grant = remaining
	}
	nextDaily := dailyEarned + grant
	nextBalance := balance + grant
	if grant > 0 {
		if _, err := tx.Exec(ctx, `UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`, nextBalance, user.ID); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE daily_game_points SET earned_points = $1, updated_at = now() WHERE user_id = $2 AND stat_date = $3`, nextDaily, user.ID, todayChina()); err != nil {
			return 0, 0, err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
			 VALUES ($1, $2, $3, 'game_play', $4, $5, now())`,
			randomHex(16), user.ID, grant, description, nextBalance,
		); err != nil {
			return 0, 0, err
		}
	}
	return grant, nextDaily, nil
}

func insertRecord(ctx context.Context, tx pgx.Tx, record Record) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`INSERT INTO game_records (id, user_id, session_id, game_type, difficulty, score, points_earned, payload, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		record.ID, record.UserID, record.SessionID, record.GameType, string(record.Difficulty), record.Score, record.PointsEarned, raw, time.UnixMilli(record.CreatedAt),
	)
	return err
}

func listRecords(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]Record, error) {
	rows, err := tx.Query(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3`,
		userID, GameType, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]Record, 0)
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func findSettledRecord(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Record, error) {
	rows, err := tx.Query(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3`,
		userID, GameType, maxRecordsListSize,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			return nil, err
		}
		if record.SessionID == sessionID {
			return &record, nil
		}
	}
	return nil, rows.Err()
}

func isCurrentActiveSession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (bool, error) {
	var activeID string
	err := tx.QueryRow(ctx, `SELECT session_id FROM active_game_sessions WHERE user_id = $1 AND game_type = $2`, userID, GameType).Scan(&activeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return activeID == sessionID, nil
}

func statusLabel(status Status) string {
	if status == StatusWon {
		return "成功"
	}
	return "失败"
}

func randomHex(size int) string {
	buffer := make([]byte, size)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

func millis(t time.Time) int64 {
	return t.UnixNano() / int64(time.Millisecond)
}

func todayChina() string {
	return time.Now().UTC().Add(8 * time.Hour).Format("2006-01-02")
}

func isRetryableTxError(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == "40001" || pgErr.Code == "40P01"
}

func sleepBeforeRetry(ctx context.Context, attempt int) error {
	step := int64(attempt)
	if step > 5 {
		step = 5
	}
	delay := (25 * time.Millisecond) << step
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
