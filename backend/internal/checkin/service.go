package checkin

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	sourceCheckinBonus = "checkin_bonus"
	maxTxRetries       = 12
)

type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, now: time.Now}
}

func NewServiceWithNow(db *pgxpool.Pool, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

func (service *Service) Snapshot(ctx context.Context, user auth.User) (Snapshot, error) {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Snapshot{}, err
	}
	defer rollbackSilently(ctx, tx)

	if err := ensureUser(ctx, tx, user); err != nil {
		return Snapshot{}, err
	}
	if err := ensureUserAssets(ctx, tx, user.ID); err != nil {
		return Snapshot{}, err
	}

	todayKey := todayChina(service.now())
	history, err := listHistory(ctx, tx, user.ID, 400)
	if err != nil {
		return Snapshot{}, err
	}
	signedSet := dateSet(history)
	_, checkedIn := signedSet[todayKey]

	var extraSpins int64
	var makeupCards int64
	if err := tx.QueryRow(ctx,
		`SELECT extra_spins, makeup_cards FROM user_assets WHERE user_id = $1`,
		user.ID,
	).Scan(&extraSpins, &makeupCards); err != nil {
		return Snapshot{}, err
	}

	weekday := weekdayMon0(todayKey)
	withoutToday := dateSet(history)
	delete(withoutToday, todayKey)
	weekBroken := hasBrokenBeforeToday(todayKey, withoutToday)
	monThruSatAllSigned := isMonThruSatAllSigned(todayKey, signedSet)
	weekStatus := &WeekStatus{
		WeekdayMon0:         weekday,
		WeekBroken:          weekBroken,
		MonThruSatAllSigned: monThruSatAllSigned,
		PreviewPoints:       calcCheckinPoints(weekday, weekBroken),
		PreviewSpins:        calcCheckinSpins(weekday, monThruSatAllSigned),
	}

	var todayResult *TodayResult
	if checkedIn {
		record, err := getRecord(ctx, tx, user.ID, todayKey)
		if err != nil {
			return Snapshot{}, err
		}
		todayResult = &TodayResult{
			PointsAwarded:     record.pointsAwarded,
			ExtraSpinsAwarded: record.extraSpinsAwarded,
			WeekBroken:        record.weekBroken,
			WeekdayLabel:      weekdayLabel(weekday),
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Snapshot{}, err
	}

	return Snapshot{
		CheckedIn:          checkedIn,
		ExtraSpins:         extraSpins,
		DailyFreeAvailable: true,
		MakeupCards:        makeupCards,
		History:            history,
		WeekStatus:         weekStatus,
		TodayCheckinResult: todayResult,
	}, nil
}

func (service *Service) Checkin(ctx context.Context, user auth.User) (CheckinResult, error) {
	todayKey := todayChina(service.now())
	weekday := weekdayMon0(todayKey)

	var output CheckinResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if err := ensureUserAssets(ctx, tx, user.ID); err != nil {
			return err
		}

		exists, err := recordExists(ctx, tx, user.ID, todayKey)
		if err != nil {
			return err
		}
		if exists {
			output = CheckinResult{Success: false, Message: "今天已经签到过了"}
			return nil
		}

		history, err := listHistory(ctx, tx, user.ID, 400)
		if err != nil {
			return err
		}
		signedSet := dateSet(history)
		delete(signedSet, todayKey)
		weekBroken := hasBrokenBeforeToday(todayKey, signedSet)
		points := calcCheckinPoints(weekday, weekBroken)
		spins := calcCheckinSpins(weekday, isMonThruSatAllSigned(todayKey, signedSet))

		if err := insertRecord(ctx, tx, user.ID, todayKey, SourceDaily, points, spins, weekBroken); err != nil {
			if isUniqueViolation(err) {
				output = CheckinResult{Success: false, Message: "今天已经签到过了"}
				return nil
			}
			return err
		}
		extraSpins, err := incrementExtraSpins(ctx, tx, user.ID, spins)
		if err != nil {
			return err
		}
		balance, err := addPoints(ctx, tx, user.ID, points, dailyDescription(weekday, weekBroken, points))
		if err != nil {
			return err
		}

		output = CheckinResult{
			Success:           true,
			Message:           fmt.Sprintf("签到成功！获得 %d 积分%s与 %d 次额外抽奖", points, brokenHint(weekBroken), spins),
			PointsAwarded:     points,
			PointsBalance:     balance,
			ExtraSpinsAwarded: spins,
			ExtraSpins:        extraSpins,
			WeekBroken:        weekBroken,
			WeekdayLabel:      weekdayLabel(weekday),
		}
		return nil
	})
	return output, err
}

func (service *Service) Makeup(ctx context.Context, user auth.User, targetKey string) (MakeupResult, error) {
	targetKey = strings.TrimSpace(targetKey)
	if _, ok := parseDateKey(targetKey); !ok {
		return MakeupResult{Success: false, Message: "日期格式不合法，应为 YYYY-MM-DD"}, nil
	}

	todayKey := todayChina(service.now())
	if !isInCurrentWeek(targetKey, todayKey) {
		return MakeupResult{Success: false, Message: "补签卡只能补本周内的漏签"}, nil
	}
	if targetKey >= todayKey {
		return MakeupResult{Success: false, Message: "只能补已经过去的漏签日，不能补今天或未来"}, nil
	}

	targetWeekday := weekdayMon0(targetKey)
	var output MakeupResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if err := ensureUserAssets(ctx, tx, user.ID); err != nil {
			return err
		}

		history, err := listHistory(ctx, tx, user.ID, 400)
		if err != nil {
			return err
		}
		signedSet := dateSet(history)
		if _, ok := signedSet[targetKey]; ok {
			output = MakeupResult{Success: false, Message: "该日期已签到，无需补签"}
			return nil
		}

		makeupCards, err := lockMakeupCards(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if makeupCards <= 0 {
			output = MakeupResult{Success: false, Message: "补签卡数量不足，请先在福利兑换中购买"}
			return nil
		}

		signedSet[targetKey] = struct{}{}
		spins := calcCheckinSpins(targetWeekday, isMonThruSatAllSigned(targetKey, signedSet))
		targetBroken := hasBrokenBeforeDate(targetKey, signedSet)
		points := calcCheckinPoints(targetWeekday, targetBroken)

		if err := insertRecord(ctx, tx, user.ID, targetKey, SourceMakeup, points, spins, targetBroken); err != nil {
			if isUniqueViolation(err) {
				output = MakeupResult{Success: false, Message: "该日期已签到，无需补签"}
				return nil
			}
			return err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE user_assets
			 SET makeup_cards = makeup_cards - 1,
			     extra_spins = extra_spins + $2,
			     updated_at = now()
			 WHERE user_id = $1`,
			user.ID, spins,
		); err != nil {
			return err
		}
		assets, err := getAssets(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		balance, err := addPoints(ctx, tx, user.ID, points, makeupDescription(targetWeekday, targetKey, points, targetBroken))
		if err != nil {
			return err
		}

		output = MakeupResult{
			Success:           true,
			Message:           fmt.Sprintf("补签 %s 成功，获得 %d 积分与 %d 次额外抽奖", weekdayLabel(targetWeekday), points, spins),
			Date:              targetKey,
			PointsAwarded:     points,
			PointsBalance:     balance,
			ExtraSpinsAwarded: spins,
			ExtraSpins:        assets.extraSpins,
			MakeupCards:       assets.makeupCards,
			StillMissing:      stillMissingThisWeek(todayKey, signedSet),
		}
		return nil
	})
	return output, err
}

func (service *Service) withRetryableTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	var lastErr error
	for attempt := 0; attempt <= maxTxRetries; attempt++ {
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
		rollbackSilently(ctx, tx)
		lastErr = err
		if !isRetryableTxError(err) || attempt == maxTxRetries {
			return err
		}
		if err := sleepBeforeRetry(ctx, attempt); err != nil {
			return err
		}
	}
	return lastErr
}

type recordRow struct {
	pointsAwarded     int64
	extraSpinsAwarded int64
	weekBroken        bool
}

type assetsRow struct {
	extraSpins  int64
	makeupCards int64
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

func ensureUserAssets(ctx context.Context, tx pgx.Tx, userID int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards, updated_at)
		 VALUES ($1, 0, 0, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		userID,
	)
	return err
}

func listHistory(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]string, error) {
	if limit <= 0 || limit > 400 {
		limit = 400
	}
	rows, err := tx.Query(ctx,
		`SELECT checkin_date::text
		 FROM checkin_records
		 WHERE user_id = $1
		 ORDER BY checkin_date DESC
		 LIMIT $2`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	history := make([]string, 0)
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return nil, err
		}
		history = append(history, date)
	}
	return history, rows.Err()
}

func getRecord(ctx context.Context, tx pgx.Tx, userID int64, date string) (recordRow, error) {
	var record recordRow
	err := tx.QueryRow(ctx,
		`SELECT points_awarded, extra_spins_awarded, week_broken
		 FROM checkin_records
		 WHERE user_id = $1 AND checkin_date = $2`,
		userID, date,
	).Scan(&record.pointsAwarded, &record.extraSpinsAwarded, &record.weekBroken)
	return record, err
}

func recordExists(ctx context.Context, tx pgx.Tx, userID int64, date string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM checkin_records WHERE user_id = $1 AND checkin_date = $2)`,
		userID, date,
	).Scan(&exists)
	return exists, err
}

func insertRecord(ctx context.Context, tx pgx.Tx, userID int64, date string, source string, points int64, spins int64, weekBroken bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO checkin_records
		   (user_id, checkin_date, source, points_awarded, extra_spins_awarded, week_broken, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		userID, date, source, points, spins, weekBroken,
	)
	return err
}

func incrementExtraSpins(ctx context.Context, tx pgx.Tx, userID int64, amount int64) (int64, error) {
	var next int64
	err := tx.QueryRow(ctx,
		`UPDATE user_assets
		 SET extra_spins = extra_spins + $2,
		     updated_at = now()
		 WHERE user_id = $1
		 RETURNING extra_spins`,
		userID, amount,
	).Scan(&next)
	return next, err
}

func lockMakeupCards(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var count int64
	err := tx.QueryRow(ctx,
		`SELECT makeup_cards FROM user_assets WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&count)
	return count, err
}

func getAssets(ctx context.Context, tx pgx.Tx, userID int64) (assetsRow, error) {
	var assets assetsRow
	err := tx.QueryRow(ctx,
		`SELECT extra_spins, makeup_cards FROM user_assets WHERE user_id = $1`,
		userID,
	).Scan(&assets.extraSpins, &assets.makeupCards)
	return assets, err
}

func addPoints(ctx context.Context, tx pgx.Tx, userID int64, amount int64, description string) (int64, error) {
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return 0, err
	}
	nextBalance := balance + amount
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance, userID,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomID(), userID, amount, sourceCheckinBonus, description, nextBalance,
	); err != nil {
		return 0, err
	}
	return nextBalance, nil
}

func dateSet(history []string) map[string]struct{} {
	set := make(map[string]struct{}, len(history))
	for _, item := range history {
		set[item] = struct{}{}
	}
	return set
}

func stillMissingThisWeek(todayKey string, signedSet map[string]struct{}) []string {
	monday := mondayOfWeek(todayKey)
	missing := make([]string, 0)
	for index := 0; index < 7; index++ {
		key := addDays(monday, index)
		if key >= todayKey {
			break
		}
		if _, ok := signedSet[key]; !ok {
			missing = append(missing, key)
		}
	}
	return missing
}

func dailyDescription(weekday int, weekBroken bool, points int64) string {
	label := weekdayLabel(weekday)
	if weekBroken {
		return fmt.Sprintf("签到积分（%s，本周已断签 %d 分）", label, points)
	}
	return fmt.Sprintf("签到积分（%s +%d）", label, points)
}

func makeupDescription(weekday int, date string, points int64, weekBroken bool) string {
	label := weekdayLabel(weekday)
	if weekBroken {
		return fmt.Sprintf("补签积分（%s %s，本周存在更早漏签 %d 分）", label, date, points)
	}
	return fmt.Sprintf("补签积分（%s %s +%d）", label, date, points)
}

func brokenHint(weekBroken bool) string {
	if weekBroken {
		return "（本周已断签，仅发放保底积分）"
	}
	return ""
}

func rollbackSilently(ctx context.Context, tx pgx.Tx) {
	_ = tx.Rollback(ctx)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isRetryableTxError(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && (pgErr.Code == "40001" || pgErr.Code == "40P01")
}

func sleepBeforeRetry(ctx context.Context, attempt int) error {
	delay := (25 * time.Millisecond) << minInt(attempt, 5)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func randomID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
