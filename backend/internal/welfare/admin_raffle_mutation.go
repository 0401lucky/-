package welfare

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (service *Service) CreateAdminRaffle(ctx context.Context, input CreateAdminRaffleInput) (AdminRaffle, error) {
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return AdminRaffle{}, errors.New("请填写活动标题")
	}
	description := strings.TrimSpace(input.Description)
	if description == "" {
		return AdminRaffle{}, errors.New("请填写活动描述")
	}

	mode := "draw"
	if input.Mode == "red_packet" {
		mode = "red_packet"
	}

	triggerType := "threshold"
	threshold := input.Threshold
	var scheduledDrawAt sql.NullInt64
	prizesRaw := []byte("[]")
	var redPacketTotalPoints sql.NullInt64
	var redPacketTotalSlots sql.NullInt64
	var redPacketRemainingPoints sql.NullInt64
	var redPacketRemainingSlots sql.NullInt64

	if mode == "red_packet" {
		totalPoints, totalSlots, err := normalizeRedPacketConfig(input.RedPacketTotalPoints, input.RedPacketTotalSlots)
		if err != nil {
			return AdminRaffle{}, err
		}
		triggerType = "manual"
		threshold = totalSlots
		redPacketTotalPoints = sql.NullInt64{Int64: totalPoints, Valid: true}
		redPacketTotalSlots = sql.NullInt64{Int64: totalSlots, Valid: true}
		redPacketRemainingPoints = sql.NullInt64{Int64: totalPoints, Valid: true}
		redPacketRemainingSlots = sql.NullInt64{Int64: totalSlots, Valid: true}
	} else {
		prizes, err := buildAdminRafflePrizes(input.Prizes)
		if err != nil {
			return AdminRaffle{}, err
		}
		prizesRaw, err = json.Marshal(prizes)
		if err != nil {
			return AdminRaffle{}, err
		}
		switch input.TriggerType {
		case "", "threshold":
			triggerType = "threshold"
		case "manual":
			triggerType = "manual"
		case "scheduled":
			triggerType = "scheduled"
			normalized, err := normalizeScheduledDrawAt(input.ScheduledDrawAt)
			if err != nil {
				return AdminRaffle{}, err
			}
			scheduledDrawAt = sql.NullInt64{Int64: normalized, Valid: true}
		default:
			return AdminRaffle{}, errors.New("开奖方式不支持")
		}
		if triggerType == "threshold" && threshold <= 0 {
			return AdminRaffle{}, errors.New("人数阈值必须为正整数")
		}
		if threshold <= 0 {
			threshold = 1
		}
	}

	id := newRaffleID(time.Now())
	now := millis(time.Now())
	_, err := service.db.Exec(ctx,
		`INSERT INTO raffles (
		   id, mode, title, description, cover_image, prizes, trigger_type,
		   threshold, scheduled_draw_at_ms, status, participants_count, winners_count, winners,
		   red_packet_total_points, red_packet_total_slots, red_packet_remaining_points,
		   red_packet_remaining_slots, red_packet_packets, created_by, created_at_ms, updated_at_ms
		 ) VALUES ($1, $2, $3, $4, NULLIF($5, ''), CAST($6 AS jsonb), $7,
		           $8, $9, 'draft', 0, 0, '[]'::jsonb,
		           $10, $11, $12, $13, '[]'::jsonb, $14, $15, $15)`,
		id,
		mode,
		title,
		description,
		strings.TrimSpace(input.CoverImage),
		string(prizesRaw),
		triggerType,
		threshold,
		scheduledDrawAt,
		redPacketTotalPoints,
		redPacketTotalSlots,
		redPacketRemainingPoints,
		redPacketRemainingSlots,
		input.CreatedBy,
		now,
	)
	if err != nil {
		return AdminRaffle{}, err
	}

	raffle, _, err := service.GetAdminRaffleDetail(ctx, id)
	return raffle, err
}

func (service *Service) UpdateAdminRaffle(ctx context.Context, id string, input UpdateAdminRaffleInput) (AdminRaffle, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return AdminRaffle{}, ErrRaffleNotFound
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return AdminRaffle{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentMode string
	var title string
	var description string
	var coverImage string
	var currentPrizesRaw []byte
	var triggerType string
	var threshold int64
	var scheduledDrawAt sql.NullInt64
	var status string
	var redPacketTotalPoints sql.NullInt64
	var redPacketTotalSlots sql.NullInt64
	err = tx.QueryRow(ctx,
		`SELECT mode, title, description, COALESCE(cover_image, ''), prizes,
		        trigger_type, threshold, scheduled_draw_at_ms, status, red_packet_total_points,
		        red_packet_total_slots
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		id,
	).Scan(
		&currentMode,
		&title,
		&description,
		&coverImage,
		&currentPrizesRaw,
		&triggerType,
		&threshold,
		&scheduledDrawAt,
		&status,
		&redPacketTotalPoints,
		&redPacketTotalSlots,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminRaffle{}, ErrRaffleNotFound
	}
	if err != nil {
		return AdminRaffle{}, err
	}
	if status != "draft" {
		return AdminRaffle{}, errors.New("只能修改草稿状态的活动")
	}

	if input.Title != nil {
		title = strings.TrimSpace(*input.Title)
	}
	if title == "" {
		return AdminRaffle{}, errors.New("请填写活动标题")
	}
	if input.Description != nil {
		description = strings.TrimSpace(*input.Description)
	}
	if description == "" {
		return AdminRaffle{}, errors.New("请填写活动描述")
	}
	if input.CoverImage != nil {
		coverImage = strings.TrimSpace(*input.CoverImage)
	}

	nextMode := currentMode
	if input.Mode != nil {
		switch *input.Mode {
		case "red_packet":
			nextMode = "red_packet"
		case "draw":
			nextMode = "draw"
		}
	}

	prizesRaw := []byte("[]")
	var nextRedPacketTotalPoints sql.NullInt64
	var nextRedPacketTotalSlots sql.NullInt64
	var nextRedPacketRemainingPoints sql.NullInt64
	var nextRedPacketRemainingSlots sql.NullInt64
	nextScheduledDrawAt := sql.NullInt64{}
	if currentMode == "draw" && scheduledDrawAt.Valid {
		nextScheduledDrawAt = scheduledDrawAt
	}

	if nextMode == "red_packet" {
		totalPoints, totalSlots, err := nextRedPacketConfig(
			redPacketTotalPoints,
			redPacketTotalSlots,
			input.RedPacketTotalPoints,
			input.RedPacketTotalSlots,
		)
		if err != nil {
			return AdminRaffle{}, err
		}
		triggerType = "manual"
		threshold = totalSlots
		nextScheduledDrawAt = sql.NullInt64{}
		nextRedPacketTotalPoints = sql.NullInt64{Int64: totalPoints, Valid: true}
		nextRedPacketTotalSlots = sql.NullInt64{Int64: totalSlots, Valid: true}
		nextRedPacketRemainingPoints = sql.NullInt64{Int64: totalPoints, Valid: true}
		nextRedPacketRemainingSlots = sql.NullInt64{Int64: totalSlots, Valid: true}
	} else {
		if input.Prizes != nil {
			prizes, err := buildAdminRafflePrizes(*input.Prizes)
			if err != nil {
				return AdminRaffle{}, err
			}
			prizesRaw, err = json.Marshal(prizes)
			if err != nil {
				return AdminRaffle{}, err
			}
		} else if currentMode == "draw" {
			prizesRaw = normalizeRawJSON(currentPrizesRaw)
		} else {
			return AdminRaffle{}, errors.New("请至少配置一个奖品")
		}

		if currentMode != "draw" || triggerType == "" {
			triggerType = "threshold"
		}
		if input.TriggerType != nil {
			switch *input.TriggerType {
			case "manual":
				triggerType = "manual"
				nextScheduledDrawAt = sql.NullInt64{}
			case "threshold":
				triggerType = "threshold"
				nextScheduledDrawAt = sql.NullInt64{}
			case "scheduled":
				triggerType = "scheduled"
				if input.ScheduledDrawAt == nil && !nextScheduledDrawAt.Valid {
					return AdminRaffle{}, errors.New("请设置定时开奖时间")
				}
			default:
				return AdminRaffle{}, errors.New("开奖方式不支持")
			}
		}
		if input.ScheduledDrawAt != nil {
			normalized, err := normalizeScheduledDrawAt(input.ScheduledDrawAt)
			if err != nil {
				return AdminRaffle{}, err
			}
			nextScheduledDrawAt = sql.NullInt64{Int64: normalized, Valid: true}
		}
		if currentMode != "draw" || threshold <= 0 {
			threshold = 1
		}
		if input.Threshold != nil {
			threshold = *input.Threshold
		}
		if triggerType == "threshold" && threshold <= 0 {
			return AdminRaffle{}, errors.New("人数阈值必须为正整数")
		}
		if triggerType == "scheduled" && !nextScheduledDrawAt.Valid {
			return AdminRaffle{}, errors.New("请设置定时开奖时间")
		}
		if triggerType != "scheduled" {
			nextScheduledDrawAt = sql.NullInt64{}
		}
		if threshold <= 0 {
			threshold = 1
		}
		nextMode = "draw"
	}

	now := millis(time.Now())
	_, err = tx.Exec(ctx,
		`UPDATE raffles
		 SET mode = $2,
		     title = $3,
		     description = $4,
		     cover_image = NULLIF($5, ''),
		     prizes = CAST($6 AS jsonb),
		     trigger_type = $7,
		     threshold = $8,
		     scheduled_draw_at_ms = $9,
		     red_packet_total_points = $10,
		     red_packet_total_slots = $11,
		     red_packet_remaining_points = $12,
		     red_packet_remaining_slots = $13,
		     red_packet_packets = '[]'::jsonb,
		     updated_at_ms = $14,
		     updated_at = now()
		 WHERE id = $1`,
		id,
		nextMode,
		title,
		description,
		coverImage,
		string(prizesRaw),
		triggerType,
		threshold,
		nextScheduledDrawAt,
		nextRedPacketTotalPoints,
		nextRedPacketTotalSlots,
		nextRedPacketRemainingPoints,
		nextRedPacketRemainingSlots,
		now,
	)
	if err != nil {
		return AdminRaffle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminRaffle{}, err
	}

	raffle, _, err := service.GetAdminRaffleDetail(ctx, id)
	return raffle, err
}

func (service *Service) PublishAdminRaffle(ctx context.Context, id string) (AdminRaffle, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return AdminRaffle{}, ErrRaffleNotFound
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return AdminRaffle{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var mode string
	var status string
	var prizesRaw []byte
	var triggerType string
	var scheduledDrawAt sql.NullInt64
	var redPacketTotalPoints sql.NullInt64
	var redPacketTotalSlots sql.NullInt64
	err = tx.QueryRow(ctx,
		`SELECT mode, status, prizes, trigger_type, scheduled_draw_at_ms, red_packet_total_points, red_packet_total_slots
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		id,
	).Scan(&mode, &status, &prizesRaw, &triggerType, &scheduledDrawAt, &redPacketTotalPoints, &redPacketTotalSlots)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminRaffle{}, ErrRaffleNotFound
	}
	if err != nil {
		return AdminRaffle{}, err
	}
	if status != "draft" {
		return AdminRaffle{}, errors.New("只能发布草稿状态的活动")
	}

	now := millis(time.Now())
	if mode == "red_packet" {
		if !redPacketTotalPoints.Valid || !redPacketTotalSlots.Valid {
			return AdminRaffle{}, errors.New("红包配置不正确")
		}
		totalPoints := redPacketTotalPoints.Int64
		totalSlots := redPacketTotalSlots.Int64
		if _, _, err := normalizeRedPacketConfig(&totalPoints, &totalSlots); err != nil {
			return AdminRaffle{}, err
		}
		packets, err := buildRedPacketPackets(totalPoints, totalSlots)
		if err != nil {
			return AdminRaffle{}, err
		}
		rawPackets, err := json.Marshal(packets)
		if err != nil {
			return AdminRaffle{}, err
		}
		if _, err := tx.Exec(ctx,
			`UPDATE raffles
			 SET mode = 'red_packet',
			     prizes = '[]'::jsonb,
			     trigger_type = 'manual',
			     threshold = $2,
			     status = 'active',
			     participants_count = 0,
			     winners_count = 0,
			     winners = '[]'::jsonb,
			     red_packet_total_points = $3,
			     red_packet_total_slots = $4,
			     red_packet_remaining_points = $3,
			     red_packet_remaining_slots = $4,
			     red_packet_packets = CAST($5 AS jsonb),
			     updated_at_ms = $6,
			     updated_at = now()
			 WHERE id = $1`,
			id,
			totalSlots,
			totalPoints,
			totalSlots,
			string(rawPackets),
			now,
		); err != nil {
			return AdminRaffle{}, err
		}
	} else {
		prizes, err := parseRafflePrizes(prizesRaw)
		if err != nil {
			return AdminRaffle{}, err
		}
		if len(prizes) == 0 {
			return AdminRaffle{}, errors.New("请至少配置一个奖品")
		}
		if totalRafflePrizeQuantity(prizes) <= 0 {
			return AdminRaffle{}, errors.New("奖品总数量必须大于0")
		}
		if triggerType == "scheduled" && !scheduledDrawAt.Valid {
			return AdminRaffle{}, errors.New("请设置定时开奖时间")
		}
		if _, err := tx.Exec(ctx,
			`UPDATE raffles
			 SET mode = 'draw',
			     status = 'active',
			     updated_at_ms = $2,
			     updated_at = now()
			 WHERE id = $1`,
			id,
			now,
		); err != nil {
			return AdminRaffle{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return AdminRaffle{}, err
	}

	raffle, _, err := service.GetAdminRaffleDetail(ctx, id)
	return raffle, err
}

func normalizeScheduledDrawAt(value *int64) (int64, error) {
	if value == nil || *value <= 0 {
		return 0, errors.New("请设置定时开奖时间")
	}
	return *value, nil
}

func (service *Service) CancelAdminRaffle(ctx context.Context, id string) (AdminRaffle, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return AdminRaffle{}, ErrRaffleNotFound
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return AdminRaffle{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		id,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminRaffle{}, ErrRaffleNotFound
	}
	if err != nil {
		return AdminRaffle{}, err
	}
	if status == "ended" {
		return AdminRaffle{}, errors.New("已结束的活动无法取消")
	}

	now := millis(time.Now())
	if _, err := tx.Exec(ctx,
		`UPDATE raffles
		 SET status = 'cancelled',
		     updated_at_ms = $2,
		     updated_at = now()
		 WHERE id = $1`,
		id,
		now,
	); err != nil {
		return AdminRaffle{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AdminRaffle{}, err
	}

	raffle, _, err := service.GetAdminRaffleDetail(ctx, id)
	return raffle, err
}

func (service *Service) DeleteAdminRaffle(ctx context.Context, id string) (bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return false, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		id,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if status != "draft" && status != "cancelled" {
		return false, errors.New("只能删除草稿或已取消的活动")
	}

	if _, err := tx.Exec(ctx, `DELETE FROM raffle_delivery_jobs WHERE raffle_id = $1`, id); err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM raffles WHERE id = $1`, id); err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

type adminRafflePrize struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Points   int64  `json:"points"`
	Quantity int64  `json:"quantity"`
}

func buildAdminRafflePrizes(inputs []AdminRafflePrizeInput) ([]adminRafflePrize, error) {
	if len(inputs) == 0 {
		return nil, errors.New("请至少配置一个奖品")
	}
	prizes := make([]adminRafflePrize, 0, len(inputs))
	for _, input := range inputs {
		name := strings.TrimSpace(input.Name)
		if name == "" {
			return nil, errors.New("奖品名称不能为空")
		}
		points := normalizeRewardPoints(input.Points, input.Dollars)
		if points <= 0 {
			return nil, errors.New("奖品积分必须大于0")
		}
		if input.Quantity <= 0 {
			return nil, errors.New("奖品数量必须为正整数")
		}
		prizes = append(prizes, adminRafflePrize{
			ID:       newShortRaffleID(time.Now()),
			Name:     name,
			Points:   points,
			Quantity: input.Quantity,
		})
	}
	return prizes, nil
}

func totalRafflePrizeQuantity(prizes []rawRafflePrize) int64 {
	var total int64
	for _, prize := range prizes {
		quantity, ok := positiveIntegerFromRaw(prize.Quantity)
		if ok {
			total += quantity
		}
	}
	return total
}

func normalizeRedPacketConfig(totalPointsValue *int64, totalSlotsValue *int64) (int64, int64, error) {
	if totalPointsValue == nil || *totalPointsValue <= 0 {
		return 0, 0, errors.New("红包总积分必须为正整数")
	}
	if totalSlotsValue == nil || *totalSlotsValue <= 0 {
		return 0, 0, errors.New("可参与人数必须为正整数")
	}
	totalPoints := *totalPointsValue
	totalSlots := *totalSlotsValue
	if totalPoints < totalSlots {
		return 0, 0, errors.New("红包总积分不能小于可参与人数")
	}
	return totalPoints, totalSlots, nil
}

func nextRedPacketConfig(currentTotalPoints sql.NullInt64, currentTotalSlots sql.NullInt64, inputTotalPoints *int64, inputTotalSlots *int64) (int64, int64, error) {
	var totalPoints *int64
	if inputTotalPoints != nil {
		totalPoints = inputTotalPoints
	} else if currentTotalPoints.Valid {
		value := currentTotalPoints.Int64
		totalPoints = &value
	}

	var totalSlots *int64
	if inputTotalSlots != nil {
		totalSlots = inputTotalSlots
	} else if currentTotalSlots.Valid {
		value := currentTotalSlots.Int64
		totalSlots = &value
	}

	return normalizeRedPacketConfig(totalPoints, totalSlots)
}

func newRaffleID(now time.Time) string {
	return "raffle_" + newRandomRaffleSuffix(now, 6)
}

func newShortRaffleID(now time.Time) string {
	return "prize_" + newRandomRaffleSuffix(now, 4)
}

func newRandomRaffleSuffix(now time.Time, randomBytes int) string {
	buffer := make([]byte, randomBytes)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("%d", now.UnixNano())
	}
	return fmt.Sprintf("%d_%s", millis(now), hex.EncodeToString(buffer))
}
