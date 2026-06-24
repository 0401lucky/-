package eco

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (service *Service) CollectTrash(ctx context.Context, input CollectInput) (CollectResult, error) {
	if input.UserID <= 0 {
		return CollectResult{}, errors.New("userID must be positive")
	}
	if input.Drags <= 0 {
		return CollectResult{}, errors.New("drags must be positive")
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}
	boundedDrags := minInt64(input.Drags, MaxDragsPerRequest)

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CollectResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return CollectResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return CollectResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return CollectResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return CollectResult{}, err
	}

	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return CollectResult{}, err
	}
	autoCredit, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收")
	if err != nil {
		return CollectResult{}, err
	}

	boostedDrags := minInt64(boundedDrags, maxInt64(0, next.GloveUsesRemaining))
	wanted := boundedDrags*BaseGrabSize + boostedDrags
	collectable := minInt64(maxInt64(0, next.Pending), wanted)
	next.Pending = maxInt64(0, next.Pending-collectable)
	if boostedDrags > 0 {
		next.GloveUsesRemaining = maxInt64(0, next.GloveUsesRemaining-boostedDrags)
	}
	manualCredit, err := service.creditTrash(ctx, tx, &next, collectable, input.NowMs, "手动回收")
	if err != nil {
		return CollectResult{}, err
	}

	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return CollectResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CollectResult{}, err
	}

	return CollectResult{
		Cleared:       tick.AutoCollected + collectable,
		PointsEarned:  autoCredit.points + manualCredit.points,
		Balance:       maxInt64(autoCredit.balance, manualCredit.balance),
		Pending:       next.Pending,
		PointBuffer:   next.PointBuffer,
		GloveUsesLeft: next.GloveUsesRemaining,
		AutoCollected: tick.AutoCollected,
	}, nil
}

type creditResult struct {
	points  int64
	balance int64
}

func (service *Service) creditTrash(ctx context.Context, tx pgx.Tx, snapshot *StateSnapshot, trash int64, nowMs int64, reason string) (creditResult, error) {
	if trash <= 0 {
		balance, err := getBalance(ctx, tx, snapshot.UserID)
		return creditResult{balance: balance}, err
	}

	snapshot.Exp += trash
	snapshot.LifetimeCleared += trash

	points, newBuffer := convertTrashBuffer(snapshot.PointBuffer+trash, PointMultiplier(*snapshot))
	snapshot.PointBuffer = newBuffer

	balance, err := getBalanceForUpdate(ctx, tx, snapshot.UserID)
	if err != nil {
		return creditResult{}, err
	}
	if points > 0 {
		balance += points
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			balance,
			snapshot.UserID,
		); err != nil {
			return creditResult{}, err
		}
		if err := insertPointLog(ctx, tx, snapshot.UserID, points, SourceGamePlay, "环保行动·"+reason, balance); err != nil {
			return creditResult{}, err
		}
		snapshot.PointsSnapshot = balance
		snapshot.LifetimePoints += points
		updateDailyTrashPoints(snapshot, nowMs, points)
	} else {
		snapshot.PointsSnapshot = balance
	}

	if err := incrementTrashRankings(ctx, tx, snapshot.UserID, trash, nowMs); err != nil {
		return creditResult{}, err
	}
	return creditResult{points: points, balance: balance}, nil
}

func (service *Service) loadCollectStateForUpdate(ctx context.Context, tx pgx.Tx, userID int64, nowMs int64) (StateSnapshot, error) {
	snapshot := NewInitialStateSnapshot(userID, nowMs)
	var dailyTrashDate sql.NullString
	err := tx.QueryRow(ctx,
		`SELECT pending, spawn_leftover_ms, auto_leftover_ms, point_buffer,
		        lucky_generations_remaining, glove_uses_remaining,
		        daily_trash_date::text, daily_trash_points, exp, lifetime_cleared,
		        lifetime_points, points_snapshot, last_tick_at_ms, created_at_ms,
		        updated_at_ms
		   FROM eco_states
		  WHERE user_id = $1
		  FOR UPDATE`,
		userID,
	).Scan(
		&snapshot.Pending,
		&snapshot.SpawnLeftoverMs,
		&snapshot.AutoLeftoverMs,
		&snapshot.PointBuffer,
		&snapshot.LuckyGenerationsRemaining,
		&snapshot.GloveUsesRemaining,
		&dailyTrashDate,
		&snapshot.DailyTrashPoints,
		&snapshot.Exp,
		&snapshot.LifetimeCleared,
		&snapshot.LifetimePoints,
		&snapshot.PointsSnapshot,
		&snapshot.LastTickAtMs,
		&snapshot.CreatedAtMs,
		&snapshot.UpdatedAtMs,
	)
	if err != nil {
		return StateSnapshot{}, err
	}
	snapshot.Exists = true
	if dailyTrashDate.Valid {
		snapshot.DailyTrashDate = dailyTrashDate.String
	}
	if err := loadUpgradesTx(ctx, tx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	if err := loadVisiblePrizesTx(ctx, tx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	return snapshot, nil
}

func loadUpgradesTx(ctx context.Context, tx pgx.Tx, snapshot *StateSnapshot) error {
	rows, err := tx.Query(ctx,
		`SELECT upgrade_key, level FROM eco_user_upgrades WHERE user_id = $1`,
		snapshot.UserID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		var level int64
		if err := rows.Scan(&key, &level); err != nil {
			return err
		}
		if isUpgradeKey(key) {
			snapshot.Upgrades[key] = maxInt64(0, level)
		}
	}
	return rows.Err()
}

func loadVisiblePrizesTx(ctx context.Context, tx pgx.Tx, snapshot *StateSnapshot) error {
	rows, err := tx.Query(ctx,
		`SELECT id, prize_key, created_at_ms, limited
		   FROM eco_visible_prizes
		  WHERE user_id = $1`,
		snapshot.UserID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var prize VisiblePrize
		if err := rows.Scan(&prize.ID, &prize.PrizeKey, &prize.CreatedAtMs, &prize.Limited); err != nil {
			return err
		}
		snapshot.VisiblePrizes = append(snapshot.VisiblePrizes, prize)
	}
	return rows.Err()
}

func saveEcoState(ctx context.Context, tx pgx.Tx, snapshot StateSnapshot) error {
	_, err := tx.Exec(ctx,
		`UPDATE eco_states
		    SET pending = $2,
		        spawn_leftover_ms = $3,
		        auto_leftover_ms = $4,
		        point_buffer = $5,
		        lucky_generations_remaining = $6,
		        glove_uses_remaining = $7,
		        daily_trash_date = $8::date,
		        daily_trash_points = $9,
		        exp = $10,
		        lifetime_cleared = $11,
		        lifetime_points = $12,
		        points_snapshot = $13,
		        last_tick_at_ms = $14,
		        updated_at_ms = $15,
		        updated_at = now()
		  WHERE user_id = $1`,
		snapshot.UserID,
		snapshot.Pending,
		snapshot.SpawnLeftoverMs,
		snapshot.AutoLeftoverMs,
		snapshot.PointBuffer,
		snapshot.LuckyGenerationsRemaining,
		snapshot.GloveUsesRemaining,
		nullableDate(snapshot.DailyTrashDate),
		snapshot.DailyTrashPoints,
		snapshot.Exp,
		snapshot.LifetimeCleared,
		snapshot.LifetimePoints,
		snapshot.PointsSnapshot,
		snapshot.LastTickAtMs,
		snapshot.UpdatedAtMs,
	)
	return err
}

func ensurePlaceholderUser(ctx context.Context, tx pgx.Tx, userID int64) error {
	username := fmt.Sprintf("user_%d", userID)
	_, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		userID,
		username,
	)
	return err
}

func ensurePointAccount(ctx context.Context, tx pgx.Tx, userID int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	)
	return err
}

func ensureEcoState(ctx context.Context, tx pgx.Tx, userID int64, nowMs int64) error {
	if nowMs <= 0 {
		nowMs = nowMillis()
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_states (
		   user_id, last_tick_at_ms, created_at_ms, updated_at_ms, raw_state
		 ) VALUES (
		   $1, $2, $2, $2, '{}'::jsonb
		 )
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
		nowMs,
	)
	return err
}

func getBalance(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}

func getBalanceForUpdate(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance)
	return balance, err
}

func insertPointLog(ctx context.Context, tx pgx.Tx, userID int64, amount int64, source string, description string, balanceAfter int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomID(),
		userID,
		amount,
		source,
		description,
		balanceAfter,
	)
	return err
}

func incrementTrashRankings(ctx context.Context, tx pgx.Tx, userID int64, trash int64, nowMs int64) error {
	if trash <= 0 {
		return nil
	}
	keys := map[string]string{
		"daily":   chinaDateKey(nowMs),
		"weekly":  chinaWeekKey(nowMs),
		"monthly": chinaMonthKey(nowMs),
	}
	for period, periodKey := range keys {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (period, period_key, user_id) DO UPDATE SET
			   trash_cleared = eco_trash_rankings.trash_cleared + excluded.trash_cleared,
			   updated_at = now()`,
			period,
			periodKey,
			userID,
			trash,
		); err != nil {
			return err
		}
	}
	return nil
}

func convertTrashBuffer(rawBuffer int64, multiplier int64) (int64, int64) {
	buffer := maxInt64(0, rawBuffer)
	multiplier = maxInt64(1, multiplier)
	batches := buffer / PointDivisor
	return batches * multiplier, buffer - batches*PointDivisor
}

func updateDailyTrashPoints(snapshot *StateSnapshot, nowMs int64, points int64) {
	if points <= 0 {
		return
	}
	dateKey := chinaDateKey(nowMs)
	if snapshot.DailyTrashDate != dateKey {
		snapshot.DailyTrashDate = dateKey
		snapshot.DailyTrashPoints = 0
	}
	snapshot.DailyTrashPoints += points
}

func chinaDateKey(nowMs int64) string {
	return chinaTime(nowMs).Format("2006-01-02")
}

func chinaMonthKey(nowMs int64) string {
	return chinaTime(nowMs).Format("2006-01")
}

func chinaWeekKey(nowMs int64) string {
	china := chinaTime(nowMs)
	year, month, day := china.Date()
	monday := time.Date(year, month, day, 0, 0, 0, 0, china.Location())
	offset := int(monday.Weekday()) - int(time.Monday)
	if offset < 0 {
		offset = 6
	}
	return monday.AddDate(0, 0, -offset).Format("2006-01-02")
}

func chinaTime(nowMs int64) time.Time {
	if nowMs <= 0 {
		nowMs = nowMillis()
	}
	return time.UnixMilli(nowMs).UTC().Add(8 * time.Hour)
}

func nullableDate(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func randomID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}
