package welfare

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type rawRafflePrize struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Points   json.RawMessage `json:"points"`
	Dollars  json.RawMessage `json:"dollars"`
	Quantity json.RawMessage `json:"quantity"`
}

func (service *Service) ExecuteRaffleDraw(ctx context.Context, raffleID string) (DrawRaffleResult, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" {
		return DrawRaffleResult{Success: false, Message: "参数错误"}, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return DrawRaffleResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var mode string
	var status string
	var prizesRaw []byte
	err = tx.QueryRow(ctx,
		`SELECT mode, status, prizes
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		raffleID,
	).Scan(&mode, &status, &prizesRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return DrawRaffleResult{}, ErrRaffleNotFound
	}
	if err != nil {
		return DrawRaffleResult{}, err
	}

	if mode == "red_packet" {
		return DrawRaffleResult{Success: false, Message: "抢红包活动无需开奖"}, tx.Commit(ctx)
	}
	if status != "active" {
		return DrawRaffleResult{Success: false, Message: "活动状态不是进行中"}, tx.Commit(ctx)
	}

	entries, err := service.listAllRaffleEntriesTx(ctx, tx, raffleID)
	if err != nil {
		return DrawRaffleResult{}, err
	}

	now := time.Now()
	nowMillis := millis(now)
	if len(entries) == 0 {
		if err := updateRaffleDrawResult(ctx, tx, raffleID, nil, nowMillis); err != nil {
			return DrawRaffleResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DrawRaffleResult{}, err
		}
		return DrawRaffleResult{Success: true, Message: "无人参与，活动已结束", Winners: []RaffleWinner{}}, nil
	}

	prizes, err := parseRafflePrizes(prizesRaw)
	if err != nil {
		return DrawRaffleResult{}, err
	}

	shuffled, err := shuffledRaffleEntries(entries)
	if err != nil {
		return DrawRaffleResult{}, err
	}
	winners := buildRaffleWinners(shuffled, prizes)
	if err := updateRaffleDrawResult(ctx, tx, raffleID, winners, nowMillis); err != nil {
		return DrawRaffleResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return DrawRaffleResult{}, err
	}
	return DrawRaffleResult{
		Success: true,
		Message: fmt.Sprintf("开奖成功，共 %d 人中奖", len(winners)),
		Winners: winners,
	}, nil
}

func (service *Service) listAllRaffleEntriesTx(ctx context.Context, tx pgx.Tx, raffleID string) ([]RaffleEntry, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, raffle_id, user_id, username, entry_number, created_at_ms
		 FROM raffle_entries
		 WHERE raffle_id = $1
		 ORDER BY entry_number ASC`,
		raffleID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]RaffleEntry, 0)
	for rows.Next() {
		var entry RaffleEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.RaffleID,
			&entry.UserID,
			&entry.Username,
			&entry.EntryNumber,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func parseRafflePrizes(raw []byte) ([]rawRafflePrize, error) {
	if len(raw) == 0 {
		return nil, nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var prizes []rawRafflePrize
	if err := decoder.Decode(&prizes); err != nil {
		return nil, fmt.Errorf("解析抽奖奖品失败: %w", err)
	}
	return prizes, nil
}

func shuffledRaffleEntries(entries []RaffleEntry) ([]RaffleEntry, error) {
	shuffled := append([]RaffleEntry(nil), entries...)
	for index := len(shuffled) - 1; index > 0; index-- {
		randomIndex, err := secureRandomInt(index + 1)
		if err != nil {
			return nil, err
		}
		shuffled[index], shuffled[randomIndex] = shuffled[randomIndex], shuffled[index]
	}
	return shuffled, nil
}

func secureRandomInt(limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	value, err := rand.Int(rand.Reader, big.NewInt(int64(limit)))
	if err != nil {
		return 0, err
	}
	return int(value.Int64()), nil
}

func buildRaffleWinners(entries []RaffleEntry, prizes []rawRafflePrize) []RaffleWinner {
	winners := make([]RaffleWinner, 0)
	winnerIndex := 0
	for _, prize := range prizes {
		quantity, ok := positiveIntegerFromRaw(prize.Quantity)
		if !ok {
			continue
		}
		points := normalizeRewardPoints(prize.Points, prize.Dollars)
		for index := int64(0); index < quantity && winnerIndex < len(entries); index++ {
			entry := entries[winnerIndex]
			winners = append(winners, RaffleWinner{
				EntryID:      entry.ID,
				UserID:       entry.UserID,
				Username:     entry.Username,
				PrizeID:      fallbackString(prize.ID, fmt.Sprintf("prize-%d", len(winners)+1)),
				PrizeName:    fallbackString(prize.Name, "抽奖奖励"),
				Points:       points,
				RewardStatus: "pending",
			})
			winnerIndex++
		}
	}
	return winners
}

func updateRaffleDrawResult(ctx context.Context, tx pgx.Tx, raffleID string, winners []RaffleWinner, drawnAt int64) error {
	if winners == nil {
		winners = []RaffleWinner{}
	}
	rawWinners, err := json.Marshal(winners)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE raffles
		 SET status = 'ended',
		     winners = CAST($2 AS jsonb),
		     winners_count = $3,
		     drawn_at_ms = $4,
		     updated_at_ms = $4,
		     updated_at = now()
		 WHERE id = $1`,
		raffleID,
		string(rawWinners),
		len(winners),
		drawnAt,
	)
	return err
}

func positiveIntegerFromRaw(raw json.RawMessage) (int64, bool) {
	value, ok := float64FromRaw(raw)
	if !ok {
		return 0, false
	}
	if !isWholeNumber(value) || value <= 0 || value > float64(math.MaxInt64) {
		return 0, false
	}
	return int64(value), true
}

func normalizeRewardPoints(pointsRaw json.RawMessage, dollarsRaw json.RawMessage) int64 {
	if points, ok := positiveRoundedInt64FromRaw(pointsRaw); ok {
		return points
	}
	if points, ok := positiveRoundedInt64FromRaw(dollarsRaw); ok {
		return points
	}
	return 0
}

func positiveRoundedInt64FromRaw(raw json.RawMessage) (int64, bool) {
	value, ok := float64FromRaw(raw)
	if !ok || value <= 0 || value > float64(math.MaxInt64) {
		return 0, false
	}
	rounded := int64(math.Round(value))
	if rounded <= 0 {
		return 0, false
	}
	return rounded, true
}

func float64FromRaw(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return 0, false
	}

	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return number, err == nil
	default:
		return 0, false
	}
}

func isWholeNumber(value float64) bool {
	return math.Abs(value-math.Round(value)) < 0.0000001
}
