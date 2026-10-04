// Storage and point settlement follow the existing 2048 game conventions.
package gamewatermelon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"math"
	"redemption/backend/internal/auth"
	"strings"
	"time"
)

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxRetryableTxRetries; attempt++ {
		tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
		if err != nil {
			return err
		}
		err = fn(tx)
		var checkpointErr checkpointFailure
		if errors.As(err, &checkpointErr) {
			_ = tx.Rollback(ctx)
			return err
		}
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

func updateSessionPayload(ctx context.Context, tx pgx.Tx, session Session) error {
	raw, err := json.Marshal(session)
	if err != nil {
		return err
	}
	expiresAt := time.UnixMilli(session.ExpiresAt)
	if _, err := tx.Exec(ctx,
		`UPDATE game_sessions
		 SET status = $2, payload = $3, expires_at = $4, updated_at = now()
		 WHERE id = $1 AND game_type = $5`,
		session.ID, session.Status, raw, expiresAt, GameType,
	); err != nil {
		return err
	}
	_, err = tx.Exec(ctx,
		`UPDATE active_game_sessions
		 SET expires_at = $3
		 WHERE user_id = $1 AND game_type = $2`,
		session.UserID, GameType, expiresAt,
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

func getDailyGamePointsEarned(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var earned int64
	err := tx.QueryRow(ctx,
		`SELECT earned_points
		 FROM daily_game_points
		 WHERE user_id = $1 AND stat_date = $2`,
		userID, todayChina(),
	).Scan(&earned)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return earned, err
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

func listRecords(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]Record, error) {
	if limit <= 0 || limit > maxRecordsListSize {
		limit = defaultRecordsListSize
	}
	rows, err := tx.Query(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2
		   AND COALESCE((payload->>'pending')::boolean, false) = false
		 ORDER BY created_at DESC, id DESC
		 LIMIT $3`,
		userID, GameType, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []Record{}
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

func findRecordForUpdateBySession(ctx context.Context, tx pgx.Tx, userID int64, sessionID string) (*Record, error) {
	var raw []byte
	err := tx.QueryRow(ctx,
		`SELECT payload
		 FROM game_records
		 WHERE user_id = $1 AND game_type = $2 AND session_id = $3
		 ORDER BY created_at DESC, id DESC
		 LIMIT 1
		 FOR UPDATE`,
		userID, GameType, sessionID,
	).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var record Record
	if err := json.Unmarshal(raw, &record); err != nil {
		return nil, err
	}
	return &record, nil
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
