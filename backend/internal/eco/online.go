package eco

import (
	"context"
	"math"
	"math/rand"

	"github.com/jackc/pgx/v5"
)

const (
	maxVisiblePrizes        = int64(12)
	ecoLuckyPrizeMultiplier = float64(5)
)

var ecoPrizeRollFloat = rand.Float64

func (service *Service) advanceStateForUpdate(ctx context.Context, tx pgx.Tx, snapshot StateSnapshot, nowMs int64, allowOnlinePrizes bool) (StateSnapshot, TickResult, error) {
	if err := service.pruneExpiredVisiblePrizes(ctx, tx, &snapshot, nowMs); err != nil {
		return StateSnapshot{}, TickResult{}, err
	}
	if !allowOnlinePrizes {
		next, tick := AdvanceState(snapshot, nowMs)
		return next, tick, nil
	}

	stock, err := loadGlobalPrizeStockForUpdate(ctx, tx)
	if err != nil {
		return StateSnapshot{}, TickResult{}, err
	}
	rates, err := loadPrizeRateSettingsTx(ctx, tx)
	if err != nil {
		return StateSnapshot{}, TickResult{}, err
	}
	visibleSlots := int64(len(snapshot.VisiblePrizes))
	reserved := defaultPrizeCountMap()
	rollPrize := func() (string, bool) {
		if visibleSlots >= maxVisiblePrizes {
			return "", false
		}
		boosted := snapshot.LuckyGenerationsRemaining > 0
		if boosted {
			snapshot.LuckyGenerationsRemaining = maxInt64(0, snapshot.LuckyGenerationsRemaining-1)
		}
		multiplier := float64(1)
		if boosted {
			multiplier = ecoLuckyPrizeMultiplier
		}
		prizeKey, ok := rollEcoGeneratedPrize(multiplier, rates)
		if !ok {
			return "", false
		}
		if stock[prizeKey] >= ecoPrizeDefinitions[prizeKey].GlobalLimit {
			return "", false
		}
		stock[prizeKey]++
		reserved[prizeKey]++
		visibleSlots++
		return prizeKey, true
	}

	next, tick := AdvanceStateWithPrizeRoll(snapshot, nowMs, rollPrize)
	next.LuckyGenerationsRemaining = snapshot.LuckyGenerationsRemaining
	for _, prizeKey := range tick.PrizeKeys {
		prizeID := randomID()
		if err := insertVisiblePrize(ctx, tx, next.UserID, prizeID, prizeKey, nowMs, true); err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
		next.VisiblePrizes = append(next.VisiblePrizes, VisiblePrize{
			ID:          prizeID,
			PrizeKey:    prizeKey,
			CreatedAtMs: nowMs,
			Limited:     true,
		})
	}
	for _, prizeKey := range PrizeKeys {
		if reserved[prizeKey] <= 0 {
			continue
		}
		if err := adjustGlobalPrizeStock(ctx, tx, prizeKey, reserved[prizeKey]); err != nil {
			return StateSnapshot{}, TickResult{}, err
		}
	}
	return next, tick, nil
}

func (service *Service) pruneExpiredVisiblePrizes(ctx context.Context, tx pgx.Tx, snapshot *StateSnapshot, nowMs int64) error {
	active := make([]VisiblePrize, 0, len(snapshot.VisiblePrizes))
	expiredIDs := []string{}
	expiredLimited := defaultPrizeCountMap()
	for _, prize := range snapshot.VisiblePrizes {
		alive := prize.CreatedAtMs > 0 && prize.CreatedAtMs <= nowMs && nowMs-prize.CreatedAtMs <= ecoPrizeTTLMS
		if alive {
			active = append(active, prize)
			continue
		}
		expiredIDs = append(expiredIDs, prize.ID)
		if prize.Limited && isPrizeKey(prize.PrizeKey) {
			expiredLimited[prize.PrizeKey]++
		}
	}
	if len(expiredIDs) > 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_visible_prizes WHERE user_id = $1 AND id = ANY($2)`, snapshot.UserID, expiredIDs); err != nil {
			return err
		}
	}
	for _, prizeKey := range PrizeKeys {
		if expiredLimited[prizeKey] <= 0 {
			continue
		}
		if err := adjustGlobalPrizeStock(ctx, tx, prizeKey, -expiredLimited[prizeKey]); err != nil {
			return err
		}
	}
	snapshot.VisiblePrizes = active
	return nil
}

func rollEcoGeneratedPrize(multiplier float64, rates map[string]float64) (string, bool) {
	if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier < 0 {
		multiplier = 1
	}
	if rates == nil {
		rates = defaultPrizeRates()
	}
	roll := ecoPrizeRollFloat()
	cursor := float64(0)
	for _, prizeKey := range PrizeKeys {
		cursor += math.Min(1, rates[prizeKey]*multiplier)
		if roll < cursor {
			return prizeKey, true
		}
	}
	return "", false
}

func loadGlobalPrizeStockForUpdate(ctx context.Context, tx pgx.Tx) (map[string]int64, error) {
	stock := defaultPrizeCountMap()
	for _, prizeKey := range PrizeKeys {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_global_prize_stock (prize_key, claimed_count, updated_at)
			 VALUES ($1, 0, now())
			 ON CONFLICT (prize_key) DO NOTHING`,
			prizeKey,
		); err != nil {
			return nil, err
		}
	}
	rows, err := tx.Query(ctx, `SELECT prize_key, claimed_count FROM eco_global_prize_stock FOR UPDATE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var prizeKey string
		var count int64
		if err := rows.Scan(&prizeKey, &count); err != nil {
			return nil, err
		}
		if isPrizeKey(prizeKey) {
			stock[prizeKey] = maxInt64(0, count)
		}
	}
	return stock, rows.Err()
}

func adjustGlobalPrizeStock(ctx context.Context, tx pgx.Tx, prizeKey string, delta int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_global_prize_stock (prize_key, claimed_count, updated_at)
		 VALUES ($1, GREATEST(0, $2), now())
		 ON CONFLICT (prize_key) DO UPDATE SET
		   claimed_count = GREATEST(0, eco_global_prize_stock.claimed_count + $2),
		   updated_at = now()`,
		prizeKey,
		delta,
	)
	return err
}

func insertVisiblePrize(ctx context.Context, tx pgx.Tx, userID int64, prizeID string, prizeKey string, createdAtMs int64, limited bool) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
		 VALUES ($1, $2, $3, $4, $5)`,
		prizeID,
		userID,
		prizeKey,
		createdAtMs,
		limited,
	)
	return err
}
