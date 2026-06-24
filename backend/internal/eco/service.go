package eco

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) GetStateSnapshot(ctx context.Context, userID int64, nowMs int64) (StateSnapshot, error) {
	if userID <= 0 {
		return StateSnapshot{}, errors.New("userID must be positive")
	}
	if nowMs <= 0 {
		nowMs = nowMillis()
	}

	snapshot, err := service.loadBaseState(ctx, userID, nowMs)
	if err != nil {
		return StateSnapshot{}, err
	}
	if !snapshot.Exists {
		return snapshot, nil
	}
	if err := service.loadUpgrades(ctx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	if err := service.loadPrizeInventory(ctx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	if err := service.loadPrizeLots(ctx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	if err := service.loadVisiblePrizes(ctx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	if err := service.loadItemPurchases(ctx, &snapshot); err != nil {
		return StateSnapshot{}, err
	}
	return snapshot, nil
}

func (service *Service) loadBaseState(ctx context.Context, userID int64, nowMs int64) (StateSnapshot, error) {
	snapshot := NewInitialStateSnapshot(userID, nowMs)
	var dailyTrashDate sql.NullString
	err := service.db.QueryRow(ctx,
		`SELECT pending, spawn_leftover_ms, auto_leftover_ms, point_buffer,
		        lucky_generations_remaining, glove_uses_remaining,
		        daily_trash_date::text, daily_trash_points, exp, lifetime_cleared,
		        lifetime_points, points_snapshot, last_tick_at_ms, created_at_ms,
		        updated_at_ms
		   FROM eco_states
		  WHERE user_id = $1`,
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
	if errors.Is(err, pgx.ErrNoRows) {
		return snapshot, nil
	}
	if err != nil {
		return StateSnapshot{}, err
	}
	snapshot.Exists = true
	if dailyTrashDate.Valid {
		snapshot.DailyTrashDate = dailyTrashDate.String
	}
	return snapshot, nil
}

func (service *Service) loadUpgrades(ctx context.Context, snapshot *StateSnapshot) error {
	rows, err := service.db.Query(ctx,
		`SELECT upgrade_key, level
		   FROM eco_user_upgrades
		  WHERE user_id = $1`,
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

func (service *Service) loadPrizeInventory(ctx context.Context, snapshot *StateSnapshot) error {
	rows, err := service.db.Query(ctx,
		`SELECT prize_key, inventory_count, limited_count, lifetime_claim_count
		   FROM eco_prize_inventory
		  WHERE user_id = $1`,
		snapshot.UserID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var key string
		var inventory PrizeInventory
		if err := rows.Scan(&key, &inventory.InventoryCount, &inventory.LimitedCount, &inventory.LifetimeClaimCount); err != nil {
			return err
		}
		if isPrizeKey(key) {
			inventory.InventoryCount = maxInt64(0, inventory.InventoryCount)
			inventory.LimitedCount = minInt64(maxInt64(0, inventory.LimitedCount), inventory.InventoryCount)
			inventory.LifetimeClaimCount = maxInt64(maxInt64(0, inventory.LifetimeClaimCount), inventory.InventoryCount)
			snapshot.PrizeInventory[key] = inventory
		}
	}
	return rows.Err()
}

func (service *Service) loadPrizeLots(ctx context.Context, snapshot *StateSnapshot) error {
	rows, err := service.db.Query(ctx,
		`SELECT id, prize_key, acquired_at_ms, available_at_ms, limited, source,
		        public_entry_id, publicly_listed_at_ms, merchant_available_at_ms,
		        stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms
		   FROM eco_prize_lots
		  WHERE user_id = $1
		  ORDER BY acquired_at_ms, id`,
		snapshot.UserID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var lot PrizeLot
		var publicEntryID sql.NullString
		var publiclyListedAt sql.NullInt64
		var merchantAvailableAt sql.NullInt64
		var stolenFromUserID sql.NullInt64
		var stolenAt sql.NullInt64
		var theftID sql.NullString
		var blackMarketAvailableAt sql.NullInt64
		if err := rows.Scan(
			&lot.ID,
			&lot.PrizeKey,
			&lot.AcquiredAtMs,
			&lot.AvailableAtMs,
			&lot.Limited,
			&lot.Source,
			&publicEntryID,
			&publiclyListedAt,
			&merchantAvailableAt,
			&stolenFromUserID,
			&stolenAt,
			&theftID,
			&blackMarketAvailableAt,
		); err != nil {
			return err
		}
		if publicEntryID.Valid {
			lot.PublicEntryID = ptrString(publicEntryID.String)
		}
		if publiclyListedAt.Valid {
			lot.PubliclyListedAtMs = ptrInt64(publiclyListedAt.Int64)
		}
		if merchantAvailableAt.Valid {
			lot.MerchantAvailableAtMs = ptrInt64(merchantAvailableAt.Int64)
		}
		if stolenFromUserID.Valid {
			lot.StolenFromUserID = ptrInt64(stolenFromUserID.Int64)
		}
		if stolenAt.Valid {
			lot.StolenAtMs = ptrInt64(stolenAt.Int64)
		}
		if theftID.Valid {
			lot.TheftID = ptrString(theftID.String)
		}
		if blackMarketAvailableAt.Valid {
			lot.BlackMarketAvailableAtMs = ptrInt64(blackMarketAvailableAt.Int64)
		}
		snapshot.PrizeLots = append(snapshot.PrizeLots, lot)
	}
	return rows.Err()
}

func (service *Service) loadVisiblePrizes(ctx context.Context, snapshot *StateSnapshot) error {
	rows, err := service.db.Query(ctx,
		`SELECT id, prize_key, created_at_ms, limited
		   FROM eco_visible_prizes
		  WHERE user_id = $1
		  ORDER BY created_at_ms, id`,
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

func (service *Service) loadItemPurchases(ctx context.Context, snapshot *StateSnapshot) error {
	rows, err := service.db.Query(ctx,
		`SELECT item_key, purchase_date::text, purchase_count
		   FROM eco_item_purchases
		  WHERE user_id = $1
		  ORDER BY purchase_date DESC, item_key`,
		snapshot.UserID,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var purchase ItemPurchase
		if err := rows.Scan(&purchase.ItemKey, &purchase.PurchaseDate, &purchase.PurchaseCount); err != nil {
			return err
		}
		snapshot.ItemPurchases = append(snapshot.ItemPurchases, purchase)
	}
	return rows.Err()
}

func NewInitialStateSnapshot(userID int64, nowMs int64) StateSnapshot {
	if nowMs <= 0 {
		nowMs = nowMillis()
	}
	return StateSnapshot{
		Exists:         false,
		UserID:         userID,
		LastTickAtMs:   nowMs,
		CreatedAtMs:    nowMs,
		UpdatedAtMs:    nowMs,
		Upgrades:       defaultUpgrades(),
		PrizeInventory: defaultPrizeInventory(),
		PrizeLots:      []PrizeLot{},
		VisiblePrizes:  []VisiblePrize{},
		ItemPurchases:  []ItemPurchase{},
	}
}

func defaultUpgrades() map[string]int64 {
	values := make(map[string]int64, len(UpgradeKeys))
	for _, key := range UpgradeKeys {
		values[key] = 0
	}
	return values
}

func defaultPrizeInventory() map[string]PrizeInventory {
	values := make(map[string]PrizeInventory, len(PrizeKeys))
	for _, key := range PrizeKeys {
		values[key] = PrizeInventory{}
	}
	return values
}

func isUpgradeKey(key string) bool {
	for _, candidate := range UpgradeKeys {
		if key == candidate {
			return true
		}
	}
	return false
}

func isPrizeKey(key string) bool {
	for _, candidate := range PrizeKeys {
		if key == candidate {
			return true
		}
	}
	return false
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func ptrInt64(value int64) *int64 {
	return &value
}

func ptrString(value string) *string {
	return &value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func minInt64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}
