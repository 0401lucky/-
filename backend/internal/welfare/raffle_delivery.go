package welfare

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"

	"github.com/jackc/pgx/v5"
)

func (service *Service) DeliverRaffleRewards(ctx context.Context, raffleID string) (DeliverRaffleRewardsResult, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" {
		return DeliverRaffleRewardsResult{Success: false, Message: "参数错误"}, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return DeliverRaffleRewardsResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var title string
	var status string
	var winnersRaw []byte
	err = tx.QueryRow(ctx,
		`SELECT title, status, winners
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		raffleID,
	).Scan(&title, &status, &winnersRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return DeliverRaffleRewardsResult{}, ErrRaffleNotFound
	}
	if err != nil {
		return DeliverRaffleRewardsResult{}, err
	}
	if status != "ended" {
		return DeliverRaffleRewardsResult{Success: false, Message: "活动尚未开奖"}, tx.Commit(ctx)
	}

	winners, err := decodeRaffleWinners(winnersRaw)
	if err != nil {
		return DeliverRaffleRewardsResult{}, err
	}
	if len(winners) == 0 {
		return DeliverRaffleRewardsResult{Success: true, Message: "没有需要发放的奖励", Results: []RaffleRewardDeliveryItem{}}, tx.Commit(ctx)
	}

	pointsService := economy.NewService(service.db)
	results := make([]RaffleRewardDeliveryItem, 0, len(winners))
	now := millis(time.Now())
	for index := range winners {
		results = append(results, service.deliverRaffleWinnerPoints(ctx, pointsService, title, raffleID, &winners[index], now))
	}

	rawWinners, err := json.Marshal(winners)
	if err != nil {
		return DeliverRaffleRewardsResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE raffles
		 SET winners = CAST($2 AS jsonb),
		     updated_at_ms = $3,
		     updated_at = now()
		 WHERE id = $1`,
		raffleID,
		string(rawWinners),
		now,
	); err != nil {
		return DeliverRaffleRewardsResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DeliverRaffleRewardsResult{}, err
	}

	deliveredCount := 0
	for _, result := range results {
		if result.Success {
			deliveredCount++
		}
	}
	return DeliverRaffleRewardsResult{
		Success: true,
		Message: fmt.Sprintf("奖励发放完成：%d/%d", deliveredCount, len(results)),
		Results: results,
	}, nil
}

func decodeRaffleWinners(raw []byte) ([]RaffleWinner, error) {
	if len(raw) == 0 || !json.Valid(raw) {
		return []RaffleWinner{}, nil
	}
	var winners []RaffleWinner
	if err := json.Unmarshal(raw, &winners); err != nil {
		return nil, fmt.Errorf("解析抽奖 winners 失败: %w", err)
	}
	return winners, nil
}

func (service *Service) deliverRaffleWinnerPoints(
	ctx context.Context,
	pointsService *economy.Service,
	title string,
	raffleID string,
	winner *RaffleWinner,
	now int64,
) RaffleRewardDeliveryItem {
	if winner.RewardStatus == "delivered" {
		return RaffleRewardDeliveryItem{
			UserID:    winner.UserID,
			Username:  winner.Username,
			PrizeName: winner.PrizeName,
			Success:   true,
			Message:   fallbackString(winner.RewardMessage, "奖励已发放（幂等跳过）"),
		}
	}

	winner.RewardAttemptedAt = now
	winner.RewardAttempts++
	if winner.Points <= 0 {
		message := "奖品积分配置异常"
		winner.RewardStatus = "pending"
		winner.RewardMessage = message
		return RaffleRewardDeliveryItem{
			UserID:    winner.UserID,
			Username:  winner.Username,
			PrizeName: winner.PrizeName,
			Success:   false,
			Message:   message,
		}
	}

	pointsResult, err := pointsService.ApplyPointsDelta(ctx, auth.User{
		ID:          winner.UserID,
		Username:    fallbackString(winner.Username, fmt.Sprintf("user_%d", winner.UserID)),
		DisplayName: fallbackString(winner.Username, fmt.Sprintf("user_%d", winner.UserID)),
	}, economy.PointMutationInput{
		Delta:          winner.Points,
		Source:         economy.SourceRaffleWin,
		Description:    fmt.Sprintf("多人抽奖：%s - %s", title, winner.PrizeName),
		IdempotencyKey: raffleDeliveryIdempotencyKey(raffleID, winner.EntryID),
	})
	if err != nil {
		message := err.Error()
		winner.RewardStatus = "pending"
		winner.RewardMessage = message
		return RaffleRewardDeliveryItem{
			UserID:    winner.UserID,
			Username:  winner.Username,
			PrizeName: winner.PrizeName,
			Success:   false,
			Message:   message,
		}
	}
	if !pointsResult.Success {
		message := fallbackString(pointsResult.Message, "奖励发放失败")
		winner.RewardStatus = "pending"
		winner.RewardMessage = message
		return RaffleRewardDeliveryItem{
			UserID:    winner.UserID,
			Username:  winner.Username,
			PrizeName: winner.PrizeName,
			Success:   false,
			Message:   message,
		}
	}

	message := fmt.Sprintf("已发放 %d 积分，当前余额 %d", winner.Points, pointsResult.Balance)
	winner.RewardStatus = "delivered"
	winner.RewardMessage = message
	winner.DeliveredAt = now
	_ = service.recordUserRaffleWin(ctx, title, raffleID, *winner, now)
	_ = service.recordRaffleWinNotification(ctx, title, raffleID, *winner, now)
	return RaffleRewardDeliveryItem{
		UserID:    winner.UserID,
		Username:  winner.Username,
		PrizeName: winner.PrizeName,
		Success:   true,
		Message:   message,
	}
}

func (service *Service) recordUserRaffleWin(ctx context.Context, title string, raffleID string, winner RaffleWinner, deliveredAt int64) error {
	if winner.EntryID == "" || winner.UserID <= 0 || winner.Points <= 0 {
		return nil
	}
	_, err := service.db.Exec(ctx,
		`INSERT INTO user_raffle_wins (
		   entry_id, raffle_id, user_id, username, raffle_title, prize_id,
		   prize_name, points, reward_message, delivered_at_ms
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (entry_id) DO UPDATE
		 SET raffle_id = excluded.raffle_id,
		     user_id = excluded.user_id,
		     username = excluded.username,
		     raffle_title = excluded.raffle_title,
		     prize_id = excluded.prize_id,
		     prize_name = excluded.prize_name,
		     points = excluded.points,
		     reward_message = excluded.reward_message,
		     delivered_at_ms = excluded.delivered_at_ms,
		     updated_at = now()`,
		winner.EntryID,
		raffleID,
		winner.UserID,
		fallbackString(winner.Username, fmt.Sprintf("user_%d", winner.UserID)),
		title,
		fallbackString(winner.PrizeID, "prize"),
		fallbackString(winner.PrizeName, "抽奖奖励"),
		winner.Points,
		winner.RewardMessage,
		deliveredAt,
	)
	return err
}

func (service *Service) recordRaffleWinNotification(ctx context.Context, title string, raffleID string, winner RaffleWinner, createdAt int64) error {
	if winner.EntryID == "" || winner.UserID <= 0 || winner.Points <= 0 {
		return nil
	}
	data, err := json.Marshal(map[string]any{
		"raffleId":  raffleID,
		"prizeName": winner.PrizeName,
		"points":    winner.Points,
		"entryId":   winner.EntryID,
	})
	if err != nil {
		return err
	}

	_, err = service.db.Exec(ctx,
		`INSERT INTO notifications (
		   id, user_id, type, title, content, data, created_at_ms
		 ) VALUES ($1, $2, 'raffle_win', $3, $4, CAST($5 AS jsonb), $6)
		 ON CONFLICT (id) DO NOTHING`,
		"raffle_win:"+winner.EntryID,
		winner.UserID,
		"多人抽奖中奖："+title,
		fmt.Sprintf("恭喜获得 %s（%d 积分）", fallbackString(winner.PrizeName, "抽奖奖励"), winner.Points),
		string(data),
		createdAt,
	)
	return err
}

func raffleDeliveryIdempotencyKey(raffleID string, entryID string) string {
	return "raffle-delivery:" + raffleID + ":" + entryID
}
