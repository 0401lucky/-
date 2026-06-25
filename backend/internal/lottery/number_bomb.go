package lottery

import (
	"context"
	cryptorand "crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
)

const (
	numberBombBaseTicketCost = int64(10)
	numberBombBetSource      = "number_bomb_bet"
	numberBombRefundSource   = "number_bomb_refund"
	numberBombRewardSource   = "number_bomb_reward"
)

var numberBombMultipliers = []NumberBombMultiplier{
	NumberBombMultiplier1,
	NumberBombMultiplier2,
	NumberBombMultiplier5,
	NumberBombMultiplier10,
}

var ErrNumberBombNotFound = errors.New("number bomb bet not found")

func (service *Service) NumberBombState(ctx context.Context, user auth.User) (NumberBombState, error) {
	if service.db == nil {
		return NumberBombState{}, ErrUnavailable
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return NumberBombState{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if err := ensureUser(ctx, tx, user); err != nil {
		return NumberBombState{}, err
	}

	today := todayChina()
	yesterday := today.AddDate(0, 0, -1)
	balance, err := balanceInTx(ctx, tx, user.ID)
	if err != nil {
		return NumberBombState{}, err
	}
	todayBet, err := getNumberBombBet(ctx, tx, today, user.ID, false)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return NumberBombState{}, err
	}
	yesterdayBet, err := getNumberBombBet(ctx, tx, yesterday, user.ID, false)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return NumberBombState{}, err
	}
	yesterdaySystemNumber, err := ensureNumberBombDraw(ctx, tx, yesterday)
	if err != nil {
		return NumberBombState{}, err
	}
	if todayBet != nil && todayBet.Status == NumberBombStatusPending {
		todayBet.SystemNumber = nil
		todayBet.RewardPoints = nil
	}
	if err := tx.Commit(ctx); err != nil {
		return NumberBombState{}, err
	}

	return NumberBombState{
		Date:                  formatDate(today),
		Yesterday:             formatDate(yesterday),
		Balance:               balance,
		BaseTicketCost:        numberBombBaseTicketCost,
		Multipliers:           append([]NumberBombMultiplier{}, numberBombMultipliers...),
		TodayBet:              todayBet,
		YesterdayBet:          yesterdayBet,
		TodaySystemNumber:     nil,
		YesterdaySystemNumber: &yesterdaySystemNumber,
	}, nil
}

func (service *Service) PlaceNumberBombBet(ctx context.Context, user auth.User, input NumberBombBetInput) (NumberBombBetResult, error) {
	if service.db == nil {
		return NumberBombBetResult{}, ErrUnavailable
	}
	selectedNumber, multiplier, err := validateNumberBombBetInput(input)
	if err != nil {
		return NumberBombBetResult{}, err
	}
	ticketCost := numberBombBaseTicketCost * int64(multiplier)

	tx, err := service.db.Begin(ctx)
	if err != nil {
		return NumberBombBetResult{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if err := ensureUser(ctx, tx, user); err != nil {
		return NumberBombBetResult{}, err
	}
	current, err := getNumberBombBet(ctx, tx, todayChina(), user.ID, true)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return NumberBombBetResult{}, err
	}
	if current != nil && current.Status == NumberBombStatusCancelled {
		return NumberBombBetResult{}, ValidationError{Message: "今日投注已取消，明日再来"}
	}
	if current != nil && current.Status != NumberBombStatusPending {
		return NumberBombBetResult{}, ValidationError{Message: "今日投注已结算，明日再来"}
	}

	previousCost := int64(0)
	if current != nil {
		previousCost = current.TicketCost
	}
	delta := previousCost - ticketCost
	balance, err := applyPointDelta(ctx, tx, user.ID, delta, numberBombBetLedgerSource(delta), numberBombBetLedgerDescription(delta, ticketCost))
	if err != nil {
		return NumberBombBetResult{}, err
	}

	nowMs := time.Now().UnixMilli()
	bet := NumberBombBet{
		ID:             "number_bomb_" + randomID(),
		UserID:         user.ID,
		Username:       user.Username,
		Date:           formatDate(todayChina()),
		SelectedNumber: selectedNumber,
		Multiplier:     multiplier,
		TicketCost:     ticketCost,
		Status:         NumberBombStatusPending,
		CreatedAt:      nowMs,
		UpdatedAt:      nowMs,
	}
	message := "投注成功"
	if current != nil {
		bet.ID = current.ID
		bet.CreatedAt = current.CreatedAt
		message = "投注已修改"
	}
	if err := upsertNumberBombBet(ctx, tx, bet); err != nil {
		return NumberBombBetResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NumberBombBetResult{}, err
	}
	return NumberBombBetResult{Message: message, Bet: bet, Balance: balance}, nil
}

func (service *Service) CancelNumberBombBet(ctx context.Context, user auth.User) (NumberBombBetResult, error) {
	if service.db == nil {
		return NumberBombBetResult{}, ErrUnavailable
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return NumberBombBetResult{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if err := ensureUser(ctx, tx, user); err != nil {
		return NumberBombBetResult{}, err
	}
	current, err := getNumberBombBet(ctx, tx, todayChina(), user.ID, true)
	if errors.Is(err, pgx.ErrNoRows) {
		return NumberBombBetResult{}, ErrNumberBombNotFound
	}
	if err != nil {
		return NumberBombBetResult{}, err
	}
	if current.Status != NumberBombStatusPending {
		return NumberBombBetResult{}, ValidationError{Message: "当前投注不能取消"}
	}
	balance, err := applyPointDelta(ctx, tx, user.ID, current.TicketCost, numberBombRefundSource, "数字炸弹：取消投注退还 "+strconv.FormatInt(current.TicketCost, 10)+" 积分")
	if err != nil {
		return NumberBombBetResult{}, err
	}
	nowMs := time.Now().UnixMilli()
	current.Status = NumberBombStatusCancelled
	current.UpdatedAt = nowMs
	if err := upsertNumberBombBet(ctx, tx, *current); err != nil {
		return NumberBombBetResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NumberBombBetResult{}, err
	}
	return NumberBombBetResult{Message: "投注已取消，门票已退还", Bet: *current, Balance: balance}, nil
}

func (service *Service) NumberBombAdminSnapshot(ctx context.Context, days int) (NumberBombAdminSnapshot, error) {
	if service.db == nil {
		return NumberBombAdminSnapshot{}, ErrUnavailable
	}
	if days < 1 || days > 30 {
		days = 7
	}
	tx, err := service.db.Begin(ctx)
	if err != nil {
		return NumberBombAdminSnapshot{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	today := todayChina()
	systemNumber, err := ensureNumberBombDraw(ctx, tx, today)
	if err != nil {
		return NumberBombAdminSnapshot{}, err
	}
	stats := make([]NumberBombDailyAdminStats, 0, days)
	for index := 0; index < days; index++ {
		date := today.AddDate(0, 0, -index)
		item, err := numberBombDailyStats(ctx, tx, date)
		if err != nil {
			return NumberBombAdminSnapshot{}, err
		}
		stats = append(stats, item)
	}
	if err := tx.Commit(ctx); err != nil {
		return NumberBombAdminSnapshot{}, err
	}
	return NumberBombAdminSnapshot{
		Date:         formatDate(today),
		SystemNumber: systemNumber,
		RecentStats:  stats,
	}, nil
}

func (service *Service) SettleNumberBombDate(ctx context.Context, date string) (NumberBombSettleResult, error) {
	if service.db == nil {
		return NumberBombSettleResult{}, ErrUnavailable
	}
	settleDate, err := normalizeNumberBombSettleDate(date)
	if err != nil {
		return NumberBombSettleResult{}, err
	}

	tx, err := service.db.Begin(ctx)
	if err != nil {
		return NumberBombSettleResult{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	systemNumber, err := ensureNumberBombDraw(ctx, tx, settleDate)
	if err != nil {
		return NumberBombSettleResult{}, err
	}
	if err := lockNumberBombDraw(ctx, tx, settleDate); err != nil {
		return NumberBombSettleResult{}, err
	}
	pendingBets, err := pendingNumberBombBets(ctx, tx, settleDate)
	if err != nil {
		return NumberBombSettleResult{}, err
	}

	nowMs := time.Now().UnixMilli()
	for _, bet := range pendingBets {
		if err := settleNumberBombBet(ctx, tx, bet, systemNumber, nowMs); err != nil {
			return NumberBombSettleResult{}, err
		}
	}
	result, err := refreshNumberBombDrawSettlement(ctx, tx, settleDate, systemNumber, nowMs)
	if err != nil {
		return NumberBombSettleResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NumberBombSettleResult{}, err
	}
	return result, nil
}

func validateNumberBombBetInput(input NumberBombBetInput) (int, NumberBombMultiplier, error) {
	if input.SelectedNumber < 0 || input.SelectedNumber > 9 {
		return 0, 0, ValidationError{Message: "请选择 0 到 9 之间的数字"}
	}
	multiplier := NumberBombMultiplier(input.Multiplier)
	for _, allowed := range numberBombMultipliers {
		if multiplier == allowed {
			return input.SelectedNumber, multiplier, nil
		}
	}
	return 0, 0, ValidationError{Message: "倍率不合法"}
}

func ensureNumberBombDraw(ctx context.Context, tx pgx.Tx, date time.Time) (int, error) {
	dateKey := formatDate(date)
	var systemNumber int
	err := tx.QueryRow(ctx,
		`SELECT system_number FROM number_bomb_draws WHERE draw_date = $1`,
		dateKey,
	).Scan(&systemNumber)
	if err == nil {
		return systemNumber, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	pick, err := cryptorand.Int(cryptorand.Reader, big.NewInt(10))
	if err != nil {
		return 0, err
	}
	systemNumber = int(pick.Int64())
	err = tx.QueryRow(ctx,
		`INSERT INTO number_bomb_draws (draw_date, system_number, created_at, updated_at)
		 VALUES ($1, $2, now(), now())
		 ON CONFLICT (draw_date) DO UPDATE SET updated_at = number_bomb_draws.updated_at
		 RETURNING system_number`,
		dateKey, systemNumber,
	).Scan(&systemNumber)
	return systemNumber, err
}

func lockNumberBombDraw(ctx context.Context, tx pgx.Tx, date time.Time) error {
	var systemNumber int
	return tx.QueryRow(ctx,
		`SELECT system_number FROM number_bomb_draws WHERE draw_date = $1 FOR UPDATE`,
		formatDate(date),
	).Scan(&systemNumber)
}

func getNumberBombDraw(ctx context.Context, tx pgx.Tx, date time.Time) (*int, error) {
	var systemNumber int
	err := tx.QueryRow(ctx,
		`SELECT system_number FROM number_bomb_draws WHERE draw_date = $1`,
		formatDate(date),
	).Scan(&systemNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &systemNumber, nil
}

func getNumberBombBet(ctx context.Context, tx pgx.Tx, date time.Time, userID int64, forUpdate bool) (*NumberBombBet, error) {
	query := `SELECT id, user_id, username, bet_date::text, selected_number, multiplier, ticket_cost, status,
	                 system_number, reward_points, created_at_ms, updated_at_ms, settled_at_ms
	            FROM number_bomb_bets
	           WHERE user_id = $1 AND bet_date = $2`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	row := tx.QueryRow(ctx, query, userID, formatDate(date))
	return scanNumberBombBet(row)
}

type rowScanner interface {
	Scan(...any) error
}

func scanNumberBombBet(row rowScanner) (*NumberBombBet, error) {
	var bet NumberBombBet
	var status string
	var multiplier int
	if err := row.Scan(
		&bet.ID,
		&bet.UserID,
		&bet.Username,
		&bet.Date,
		&bet.SelectedNumber,
		&multiplier,
		&bet.TicketCost,
		&status,
		&bet.SystemNumber,
		&bet.RewardPoints,
		&bet.CreatedAt,
		&bet.UpdatedAt,
		&bet.SettledAt,
	); err != nil {
		return nil, err
	}
	bet.Multiplier = NumberBombMultiplier(multiplier)
	bet.Status = NumberBombBetStatus(status)
	return &bet, nil
}

func upsertNumberBombBet(ctx context.Context, tx pgx.Tx, bet NumberBombBet) error {
	var systemNumber any
	if bet.SystemNumber != nil {
		systemNumber = *bet.SystemNumber
	}
	var rewardPoints any
	if bet.RewardPoints != nil {
		rewardPoints = *bet.RewardPoints
	}
	var settledAt any
	if bet.SettledAt != nil {
		settledAt = *bet.SettledAt
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO number_bomb_bets
		   (id, user_id, username, bet_date, selected_number, multiplier, ticket_cost, status,
		    system_number, reward_points, created_at_ms, updated_at_ms, settled_at_ms, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now())
		 ON CONFLICT (user_id, bet_date) DO UPDATE SET
		   username = excluded.username,
		   selected_number = excluded.selected_number,
		   multiplier = excluded.multiplier,
		   ticket_cost = excluded.ticket_cost,
		   status = excluded.status,
		   system_number = excluded.system_number,
		   reward_points = excluded.reward_points,
		   updated_at_ms = excluded.updated_at_ms,
		   settled_at_ms = excluded.settled_at_ms,
		   updated_at = now()`,
		bet.ID,
		bet.UserID,
		bet.Username,
		bet.Date,
		bet.SelectedNumber,
		int(bet.Multiplier),
		bet.TicketCost,
		string(bet.Status),
		systemNumber,
		rewardPoints,
		bet.CreatedAt,
		bet.UpdatedAt,
		settledAt,
	)
	return err
}

func pendingNumberBombBets(ctx context.Context, tx pgx.Tx, date time.Time) ([]NumberBombBet, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, user_id, username, bet_date::text, selected_number, multiplier, ticket_cost, status,
		        system_number, reward_points, created_at_ms, updated_at_ms, settled_at_ms
		   FROM number_bomb_bets
		  WHERE bet_date = $1 AND status = 'pending'
		  ORDER BY created_at_ms ASC, user_id ASC
		  FOR UPDATE`,
		formatDate(date),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	bets := []NumberBombBet{}
	for rows.Next() {
		bet, err := scanNumberBombBet(rows)
		if err != nil {
			return nil, err
		}
		bets = append(bets, *bet)
	}
	return bets, rows.Err()
}

func settleNumberBombBet(ctx context.Context, tx pgx.Tx, bet NumberBombBet, systemNumber int, settledAtMs int64) error {
	won := bet.SelectedNumber != systemNumber
	status := NumberBombStatusLost
	rewardPoints := int64(0)
	balanceAfter := int64(0)

	if won {
		status = NumberBombStatusWon
		rewardPoints = bet.TicketCost * 2
		var err error
		balanceAfter, err = applyPointDelta(ctx, tx, bet.UserID, rewardPoints, numberBombRewardSource, fmt.Sprintf("数字炸弹：猜中安全数字，奖励 %d 积分", rewardPoints))
		if err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx,
		`UPDATE number_bomb_bets
		    SET status = $3,
		        system_number = $4,
		        reward_points = $5,
		        updated_at_ms = $6,
		        settled_at_ms = $6,
		        updated_at = now()
		  WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
		bet.ID,
		bet.UserID,
		string(status),
		systemNumber,
		rewardPoints,
		settledAtMs,
	); err != nil {
		return err
	}

	return insertNumberBombNotification(ctx, tx, bet, systemNumber, status, rewardPoints, balanceAfter, settledAtMs)
}

func insertNumberBombNotification(
	ctx context.Context,
	tx pgx.Tx,
	bet NumberBombBet,
	systemNumber int,
	status NumberBombBetStatus,
	rewardPoints int64,
	balanceAfter int64,
	createdAtMs int64,
) error {
	notificationType := "system"
	content := fmt.Sprintf("未中奖：系统数字是 %d，你选择 %d，本次未获得奖励。", systemNumber, bet.SelectedNumber)
	if status == NumberBombStatusWon {
		notificationType = "lottery_win"
		content = fmt.Sprintf("中奖！系统数字是 %d，你选择 %d，获得 %d 积分，当前余额 %d。", systemNumber, bet.SelectedNumber, rewardPoints, balanceAfter)
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms, created_at, updated_at)
		 VALUES ($1, $2, $3, '数字炸弹开奖通知', $4,
		         jsonb_build_object(
		           'game', 'number_bomb',
		           'date', $5::text,
		           'betId', $6::text,
		           'selectedNumber', $7::bigint,
		           'systemNumber', $8::bigint,
		           'rewardPoints', $9::bigint,
		           'outcome', $10::text
		         ),
		         $11, now(), now())
		 ON CONFLICT (id) DO NOTHING`,
		"number_bomb:"+bet.Date+":"+bet.ID,
		bet.UserID,
		notificationType,
		content,
		bet.Date,
		bet.ID,
		bet.SelectedNumber,
		systemNumber,
		rewardPoints,
		string(status),
		createdAtMs,
	)
	return err
}

func refreshNumberBombDrawSettlement(ctx context.Context, tx pgx.Tx, date time.Time, systemNumber int, settledAtMs int64) (NumberBombSettleResult, error) {
	var result NumberBombSettleResult
	err := tx.QueryRow(ctx,
		`WITH stats AS (
		   SELECT
		     COUNT(*) FILTER (WHERE status IN ('won', 'lost'))::bigint AS processed,
		     COUNT(*) FILTER (WHERE status = 'won')::bigint AS won,
		     COUNT(*) FILTER (WHERE status = 'lost')::bigint AS lost,
		     COUNT(*) FILTER (WHERE status = 'cancelled')::bigint AS skipped
		     FROM number_bomb_bets
		    WHERE bet_date = $1
		 ),
		 updated AS (
		   UPDATE number_bomb_draws
		      SET processed = stats.processed,
		          won = stats.won,
		          lost = stats.lost,
		          skipped = stats.skipped,
		          system_number = $2,
		          settled_at_ms = $3,
		          updated_at = now()
		     FROM stats
		    WHERE draw_date = $1
		    RETURNING number_bomb_draws.draw_date::text,
		              number_bomb_draws.system_number,
		              number_bomb_draws.processed,
		              number_bomb_draws.won,
		              number_bomb_draws.lost,
		              number_bomb_draws.skipped
		 )
		 SELECT draw_date, system_number, processed, won, lost, skipped FROM updated`,
		formatDate(date),
		systemNumber,
		settledAtMs,
	).Scan(&result.Date, &result.SystemNumber, &result.Processed, &result.Won, &result.Lost, &result.Skipped)
	return result, err
}

func numberBombDailyStats(ctx context.Context, tx pgx.Tx, date time.Time) (NumberBombDailyAdminStats, error) {
	dateKey := formatDate(date)
	systemNumber, err := getNumberBombDraw(ctx, tx, date)
	if err != nil {
		return NumberBombDailyAdminStats{}, err
	}
	rows, err := tx.Query(ctx,
		`SELECT id, user_id, username, bet_date::text, selected_number, multiplier, ticket_cost, status,
		        system_number, reward_points, created_at_ms, updated_at_ms, settled_at_ms
		   FROM number_bomb_bets
		  WHERE bet_date = $1
		  ORDER BY created_at_ms ASC, user_id ASC`,
		dateKey,
	)
	if err != nil {
		return NumberBombDailyAdminStats{}, err
	}
	defer rows.Close()

	item := NumberBombDailyAdminStats{
		Date:           dateKey,
		SystemNumber:   systemNumber,
		SelectedCounts: buildEmptySelectedCounts(),
		Participants:   []NumberBombAdminParticipant{},
		Winners:        []NumberBombAdminParticipant{},
	}
	for rows.Next() {
		bet, err := scanNumberBombBet(rows)
		if err != nil {
			return NumberBombDailyAdminStats{}, err
		}
		item.TotalBetCount++
		if bet.Status == NumberBombStatusCancelled {
			item.CancelledCount++
			continue
		}
		item.ParticipantCount++
		item.SelectedCounts[strconv.Itoa(bet.SelectedNumber)]++
		participant := NumberBombAdminParticipant{
			UserID:         bet.UserID,
			Username:       bet.Username,
			SelectedNumber: bet.SelectedNumber,
			Status:         bet.Status,
			Multiplier:     bet.Multiplier,
			TicketCost:     bet.TicketCost,
			RewardPoints:   bet.RewardPoints,
			CreatedAt:      bet.CreatedAt,
			SettledAt:      bet.SettledAt,
		}
		item.Participants = append(item.Participants, participant)
		switch bet.Status {
		case NumberBombStatusWon:
			item.WonCount++
			item.Winners = append(item.Winners, participant)
		case NumberBombStatusLost:
			item.LostCount++
		case NumberBombStatusPending:
			item.PendingCount++
		}
	}
	return item, rows.Err()
}

func buildEmptySelectedCounts() map[string]int64 {
	counts := make(map[string]int64, 10)
	for index := 0; index < 10; index++ {
		counts[strconv.Itoa(index)] = 0
	}
	return counts
}

func normalizeNumberBombSettleDate(date string) (time.Time, error) {
	value := strings.TrimSpace(date)
	if value == "" {
		return todayChina().AddDate(0, 0, -1), nil
	}
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, ValidationError{Message: "日期格式不合法"}
	}
	return parsed, nil
}

func balanceInTx(ctx context.Context, tx pgx.Tx, userID int64) (int64, error) {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	return balance, err
}

func applyPointDelta(ctx context.Context, tx pgx.Tx, userID int64, delta int64, source string, description string) (int64, error) {
	var balance int64
	if err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`, userID).Scan(&balance); err != nil {
		return 0, err
	}
	if delta == 0 {
		return balance, nil
	}
	nextBalance := balance + delta
	if nextBalance < 0 {
		return balance, ValidationError{Message: "积分不足"}
	}
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance, userID,
	); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, now())`,
		randomID(), userID, delta, source, description, nextBalance,
	); err != nil {
		return 0, err
	}
	return nextBalance, nil
}

func numberBombBetLedgerSource(delta int64) string {
	if delta > 0 {
		return numberBombRefundSource
	}
	return numberBombBetSource
}

func numberBombBetLedgerDescription(delta int64, ticketCost int64) string {
	if delta > 0 {
		return "数字炸弹：修改投注退还 " + strconv.FormatInt(delta, 10) + " 积分"
	}
	return "数字炸弹：投注门票 " + strconv.FormatInt(ticketCost, 10) + " 积分"
}

func formatDate(date time.Time) string {
	return date.Format("2006-01-02")
}
