package welfare

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"

	"github.com/jackc/pgx/v5"
)

func (service *Service) GrabRedPacket(ctx context.Context, raffleID string, user auth.User) (JoinRaffleResult, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" || user.ID <= 0 {
		return JoinRaffleResult{Success: false, Message: "参数错误"}, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return JoinRaffleResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var mode string
	var status string
	var winnersRaw []byte
	var packetsRaw []byte
	var remainingPoints sql.NullInt64
	var remainingSlots sql.NullInt64
	var currentParticipantsCount int64
	err = tx.QueryRow(ctx,
		`SELECT mode, status, participants_count, winners,
		        red_packet_remaining_points, red_packet_remaining_slots, red_packet_packets
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		raffleID,
	).Scan(
		&mode,
		&status,
		&currentParticipantsCount,
		&winnersRaw,
		&remainingPoints,
		&remainingSlots,
		&packetsRaw,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return JoinRaffleResult{}, ErrRaffleNotFound
	}
	if err != nil {
		return JoinRaffleResult{}, err
	}

	if mode != "red_packet" {
		return JoinRaffleResult{Success: false, Message: "当前活动不是抢红包"}, tx.Commit(ctx)
	}
	switch status {
	case "active":
	case "draft":
		return JoinRaffleResult{Success: false, Message: "活动尚未开始"}, tx.Commit(ctx)
	case "ended":
		return JoinRaffleResult{Success: false, Message: "红包已抢完"}, tx.Commit(ctx)
	case "cancelled":
		return JoinRaffleResult{Success: false, Message: "活动已取消"}, tx.Commit(ctx)
	default:
		return JoinRaffleResult{Success: false, Message: "活动状态异常"}, tx.Commit(ctx)
	}

	existing, err := service.getRaffleEntryForUserTx(ctx, tx, raffleID, user.ID)
	if err == nil {
		return JoinRaffleResult{
			Success: false,
			Message: "您已经抢过红包了",
			Entry:   &existing,
		}, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return JoinRaffleResult{}, err
	}

	packets, err := normalizeRemainingRedPacketPackets(packetsRaw, remainingPoints, remainingSlots)
	if err != nil {
		return JoinRaffleResult{}, err
	}
	packetAmount, ok := shiftRedPacket(packets)
	now := time.Now()
	nowMillis := millis(now)
	if !ok {
		if err := markRedPacketEndedTx(ctx, tx, raffleID, nowMillis); err != nil {
			return JoinRaffleResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return JoinRaffleResult{}, err
		}
		return JoinRaffleResult{Success: false, Message: "红包已抢完"}, nil
	}
	packets = packets[1:]

	entryNumber, err := nextRaffleEntryNumber(ctx, tx, raffleID, currentParticipantsCount)
	if err != nil {
		return JoinRaffleResult{}, err
	}

	entry := RaffleEntry{
		ID:          newRaffleEntryID(now),
		RaffleID:    raffleID,
		UserID:      user.ID,
		Username:    fallbackString(user.Username, fmt.Sprintf("user-%d", user.ID)),
		EntryNumber: entryNumber,
		CreatedAt:   nowMillis,
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		entry.ID,
		entry.RaffleID,
		entry.UserID,
		entry.Username,
		entry.EntryNumber,
		entry.CreatedAt,
	); err != nil {
		return JoinRaffleResult{}, err
	}

	winners, err := decodeRaffleWinners(winnersRaw)
	if err != nil {
		return JoinRaffleResult{}, err
	}
	winner := RaffleWinner{
		EntryID:      entry.ID,
		UserID:       entry.UserID,
		Username:     entry.Username,
		PrizeID:      "red_packet",
		PrizeName:    "抢红包",
		Points:       packetAmount,
		RewardStatus: "pending",
	}
	winners = append(winners, winner)

	nextStatus := "active"
	if len(packets) == 0 {
		nextStatus = "ended"
	}
	rawWinners, err := json.Marshal(winners)
	if err != nil {
		return JoinRaffleResult{}, err
	}
	rawPackets, err := json.Marshal(packets)
	if err != nil {
		return JoinRaffleResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE raffles
		 SET participants_count = GREATEST(
		       participants_count + 1,
		       (SELECT COUNT(*) FROM raffle_entries WHERE raffle_id = $1)
		     ),
		     winners = CAST($2 AS jsonb),
		     winners_count = $3,
		     status = $4,
		     drawn_at_ms = CASE WHEN $4 = 'ended' THEN COALESCE(drawn_at_ms, $5) ELSE drawn_at_ms END,
		     red_packet_remaining_points = $6,
		     red_packet_remaining_slots = $7,
		     red_packet_packets = CAST($8 AS jsonb),
		     updated_at_ms = $5,
		     updated_at = now()
		 WHERE id = $1`,
		raffleID,
		string(rawWinners),
		int64(len(winners)),
		nextStatus,
		nowMillis,
		sumRedPacketPackets(packets),
		int64(len(packets)),
		string(rawPackets),
	); err != nil {
		return JoinRaffleResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return JoinRaffleResult{}, err
	}

	result := JoinRaffleResult{
		Success: true,
		Message: fmt.Sprintf("抢到 %d 积分，发放确认中", packetAmount),
		Entry:   &entry,
		Reward:  &winner,
	}
	deliveredWinner, delivered, err := service.deliverSingleRaffleWinner(ctx, raffleID, entry.ID)
	if err == nil {
		result.Reward = &deliveredWinner
		if delivered {
			result.Message = fmt.Sprintf("抢到 %d 积分，已到账", packetAmount)
		}
	}
	return result, nil
}

func (service *Service) deliverSingleRaffleWinner(ctx context.Context, raffleID string, entryID string) (RaffleWinner, bool, error) {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return RaffleWinner{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var title string
	var winnersRaw []byte
	err = tx.QueryRow(ctx,
		`SELECT title, winners
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		raffleID,
	).Scan(&title, &winnersRaw)
	if errors.Is(err, pgx.ErrNoRows) {
		return RaffleWinner{}, false, ErrRaffleNotFound
	}
	if err != nil {
		return RaffleWinner{}, false, err
	}

	winners, err := decodeRaffleWinners(winnersRaw)
	if err != nil {
		return RaffleWinner{}, false, err
	}
	winnerIndex := -1
	for index := range winners {
		if winners[index].EntryID == entryID {
			winnerIndex = index
			break
		}
	}
	if winnerIndex < 0 {
		return RaffleWinner{}, false, errors.New("raffle winner not found")
	}

	pointsService := economy.NewService(service.db)
	now := millis(time.Now())
	delivery := service.deliverRaffleWinnerPoints(ctx, pointsService, title, raffleID, &winners[winnerIndex], now)

	rawWinners, err := json.Marshal(winners)
	if err != nil {
		return RaffleWinner{}, false, err
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
		return RaffleWinner{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RaffleWinner{}, false, err
	}
	return winners[winnerIndex], delivery.Success && winners[winnerIndex].RewardStatus == "delivered", nil
}

func normalizeRemainingRedPacketPackets(raw []byte, remainingPoints sql.NullInt64, remainingSlots sql.NullInt64) ([]int64, error) {
	packets, err := decodeRedPacketPackets(raw)
	if err != nil {
		return nil, err
	}
	fallbackSlots := int64(len(packets))
	if remainingSlots.Valid {
		fallbackSlots = remainingSlots.Int64
	}
	fallbackPoints := sumRedPacketPackets(packets)
	if remainingPoints.Valid {
		fallbackPoints = remainingPoints.Int64
	}

	if len(packets) > 0 && int64(len(packets)) == fallbackSlots && sumRedPacketPackets(packets) == fallbackPoints {
		return append([]int64(nil), packets...), nil
	}
	if fallbackSlots > 0 && fallbackPoints >= fallbackSlots {
		return buildRedPacketPackets(fallbackPoints, fallbackSlots)
	}
	return []int64{}, nil
}

func decodeRedPacketPackets(raw []byte) ([]int64, error) {
	if len(raw) == 0 || !json.Valid(raw) {
		return []int64{}, nil
	}
	var values []json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("解析红包队列失败: %w", err)
	}
	packets := make([]int64, 0, len(values))
	for _, value := range values {
		packet, ok := positiveIntegerFromRaw(value)
		if ok {
			packets = append(packets, packet)
		}
	}
	return packets, nil
}

func buildRedPacketPackets(totalPoints int64, totalSlots int64) ([]int64, error) {
	if totalPoints <= 0 || totalSlots <= 0 {
		return nil, errors.New("红包配置必须为正整数")
	}
	if totalPoints < totalSlots {
		return nil, errors.New("红包总积分不能小于可参与人数")
	}
	if totalSlots == 1 {
		return []int64{totalPoints}, nil
	}

	packets := make([]int64, 0, totalSlots)
	remainingPoints := totalPoints
	remainingSlots := totalSlots
	for remainingSlots > 1 {
		maxValue := remainingPoints - remainingSlots + 1
		average := remainingPoints / remainingSlots
		capValue := average * 2
		if capValue < 1 {
			capValue = 1
		}
		if capValue > maxValue {
			capValue = maxValue
		}
		value, err := secureRandomInt(int(capValue))
		if err != nil {
			return nil, err
		}
		packet := int64(value + 1)
		packets = append(packets, packet)
		remainingPoints -= packet
		remainingSlots--
	}
	packets = append(packets, remainingPoints)
	return shuffleRedPacketPackets(packets)
}

func shuffleRedPacketPackets(packets []int64) ([]int64, error) {
	shuffled := append([]int64(nil), packets...)
	for index := len(shuffled) - 1; index > 0; index-- {
		randomIndex, err := secureRandomInt(index + 1)
		if err != nil {
			return nil, err
		}
		shuffled[index], shuffled[randomIndex] = shuffled[randomIndex], shuffled[index]
	}
	return shuffled, nil
}

func shiftRedPacket(packets []int64) (int64, bool) {
	if len(packets) == 0 || packets[0] <= 0 {
		return 0, false
	}
	return packets[0], true
}

func sumRedPacketPackets(packets []int64) int64 {
	var sum int64
	for _, packet := range packets {
		if packet > 0 {
			sum += packet
		}
	}
	return sum
}

func markRedPacketEndedTx(ctx context.Context, tx pgx.Tx, raffleID string, now int64) error {
	_, err := tx.Exec(ctx,
		`UPDATE raffles
		 SET status = 'ended',
		     drawn_at_ms = COALESCE(drawn_at_ms, $2),
		     red_packet_remaining_points = 0,
		     red_packet_remaining_slots = 0,
		     red_packet_packets = '[]'::jsonb,
		     updated_at_ms = $2,
		     updated_at = now()
		 WHERE id = $1`,
		raffleID,
		now,
	)
	return err
}
