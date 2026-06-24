package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ecoUpgradeKeys = []string{"spawn", "storage", "value", "auto"}
	ecoUpgradeMax  = map[string]int64{
		"spawn":   8,
		"storage": 8,
		"value":   5,
		"auto":    6,
	}
	ecoPrizeKeys = []string{"diamond", "coin", "necklace", "trophy", "photo"}
	ecoItemKeys  = map[string]struct{}{
		"clear_truck":      {},
		"lucky_flashlight": {},
		"recycle_glove":    {},
	}
)

type EcoStateImportPlan struct {
	Users            []UserImportRecord
	States           []EcoStateImportRecord
	Upgrades         []EcoUserUpgradeImportRecord
	PrizeInventories []EcoPrizeInventoryImportRecord
	PrizeLots        []EcoPrizeLotImportRecord
	VisiblePrizes    []EcoVisiblePrizeImportRecord
	ItemPurchases    []EcoItemPurchaseImportRecord
	Warnings         []string
}

type EcoStateImportResult struct {
	UsersUpserted            int
	StatesUpserted           int
	UpgradesUpserted         int
	PrizeInventoriesUpserted int
	PrizeLotsUpserted        int
	VisiblePrizesUpserted    int
	ItemPurchasesUpserted    int
	Warnings                 []string
}

type EcoStateImportRecord struct {
	UserID                    int64
	Pending                   int64
	SpawnLeftoverMs           int64
	AutoLeftoverMs            int64
	PointBuffer               int64
	LuckyGenerationsRemaining int64
	GloveUsesRemaining        int64
	DailyTrashDate            *string
	DailyTrashPoints          int64
	Exp                       int64
	LifetimeCleared           int64
	LifetimePoints            int64
	PointsSnapshot            int64
	LastTickAtMs              int64
	CreatedAtMs               int64
	UpdatedAtMs               int64
	RawState                  json.RawMessage
}

type EcoUserUpgradeImportRecord struct {
	UserID     int64
	UpgradeKey string
	Level      int64
}

type EcoPrizeInventoryImportRecord struct {
	UserID             int64
	PrizeKey           string
	InventoryCount     int64
	LimitedCount       int64
	LifetimeClaimCount int64
}

type EcoPrizeLotImportRecord struct {
	ID                       string
	UserID                   int64
	PrizeKey                 string
	AcquiredAtMs             int64
	AvailableAtMs            int64
	Limited                  bool
	Source                   string
	PublicEntryID            *string
	PubliclyListedAtMs       *int64
	MerchantAvailableAtMs    *int64
	StolenFromUserID         *int64
	StolenAtMs               *int64
	TheftID                  *string
	BlackMarketAvailableAtMs *int64
}

type EcoVisiblePrizeImportRecord struct {
	ID          string
	UserID      int64
	PrizeKey    string
	CreatedAtMs int64
	Limited     bool
}

type EcoItemPurchaseImportRecord struct {
	UserID        int64
	ItemKey       string
	PurchaseDate  string
	PurchaseCount int64
}

type parsedEcoState struct {
	State            EcoStateImportRecord
	Upgrades         []EcoUserUpgradeImportRecord
	PrizeInventories []EcoPrizeInventoryImportRecord
	PrizeLots        []EcoPrizeLotImportRecord
	VisiblePrizes    []EcoVisiblePrizeImportRecord
	ItemPurchases    []EcoItemPurchaseImportRecord
}

type rawEcoState struct {
	UserID                    json.RawMessage               `json:"userId"`
	Pending                   json.RawMessage               `json:"pending"`
	SpawnLeftoverMs           json.RawMessage               `json:"spawnLeftoverMs"`
	AutoLeftoverMs            json.RawMessage               `json:"autoLeftoverMs"`
	PointBuffer               json.RawMessage               `json:"pointBuffer"`
	Upgrades                  map[string]json.RawMessage    `json:"upgrades"`
	Inventory                 map[string]json.RawMessage    `json:"inventory"`
	PrizeLots                 []rawEcoPrizeLot              `json:"prizeLots"`
	LimitedPrizeInventory     map[string]json.RawMessage    `json:"limitedPrizeInventory"`
	LifetimePrizeClaimCounts  map[string]json.RawMessage    `json:"lifetimePrizeClaimCounts"`
	VisiblePrizes             []rawEcoVisiblePrize          `json:"visiblePrizes"`
	LuckyGenerationsRemaining json.RawMessage               `json:"luckyGenerationsRemaining"`
	GloveUsesRemaining        json.RawMessage               `json:"gloveUsesRemaining"`
	ItemPurchases             map[string]rawEcoItemPurchase `json:"itemPurchases"`
	DailyTrashPoints          rawEcoDailyTrashPoints        `json:"dailyTrashPoints"`
	Exp                       json.RawMessage               `json:"exp"`
	LifetimeCleared           json.RawMessage               `json:"lifetimeCleared"`
	LifetimePoints            json.RawMessage               `json:"lifetimePoints"`
	Points                    json.RawMessage               `json:"points"`
	LastTickAt                json.RawMessage               `json:"lastTickAt"`
	CreatedAt                 json.RawMessage               `json:"createdAt"`
	UpdatedAt                 json.RawMessage               `json:"updatedAt"`
}

type rawEcoPrizeLot struct {
	ID                     string          `json:"id"`
	Key                    string          `json:"key"`
	AcquiredAt             json.RawMessage `json:"acquiredAt"`
	AvailableAt            json.RawMessage `json:"availableAt"`
	Limited                json.RawMessage `json:"limited"`
	Source                 string          `json:"source"`
	PublicEntryID          *string         `json:"publicEntryId"`
	PubliclyListedAt       json.RawMessage `json:"publiclyListedAt"`
	MerchantAvailableAt    json.RawMessage `json:"merchantAvailableAt"`
	StolenFromUserID       json.RawMessage `json:"stolenFromUserId"`
	StolenAt               json.RawMessage `json:"stolenAt"`
	TheftID                *string         `json:"theftId"`
	BlackMarketAvailableAt json.RawMessage `json:"blackMarketAvailableAt"`
}

type rawEcoVisiblePrize struct {
	ID        string          `json:"id"`
	Key       string          `json:"key"`
	CreatedAt json.RawMessage `json:"createdAt"`
	Limited   json.RawMessage `json:"limited"`
}

type rawEcoItemPurchase struct {
	Date  string          `json:"date"`
	Count json.RawMessage `json:"count"`
}

type rawEcoDailyTrashPoints struct {
	Date   string          `json:"date"`
	Points json.RawMessage `json:"points"`
}

func PlanEcoStateImport(reader io.Reader) (EcoStateImportPlan, error) {
	plan := EcoStateImportPlan{}
	users := map[int64]UserImportRecord{}
	records := map[int64]parsedEcoState{}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statement, ok := parseInsertStatement(line)
		if !ok || statement.Table != "kv_data" {
			continue
		}
		key, ok := kvKey(statement)
		if !ok || !matchKeyPattern(key, "eco:state:*") {
			continue
		}
		value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}
		parsed, warnings, ok := parseLegacyEcoState(key, value)
		plan.Warnings = append(plan.Warnings, warnings...)
		if !ok {
			continue
		}
		records[parsed.State.UserID] = parsed
		ensurePlanUser(users, parsed.State.UserID, millisToTime(parsed.State.CreatedAtMs))
		for _, lot := range parsed.PrizeLots {
			if lot.StolenFromUserID != nil {
				ensurePlanUser(users, *lot.StolenFromUserID, millisToTime(parsed.State.CreatedAtMs))
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, record := range records {
		plan.States = append(plan.States, record.State)
		plan.Upgrades = append(plan.Upgrades, record.Upgrades...)
		plan.PrizeInventories = append(plan.PrizeInventories, record.PrizeInventories...)
		plan.PrizeLots = append(plan.PrizeLots, record.PrizeLots...)
		plan.VisiblePrizes = append(plan.VisiblePrizes, record.VisiblePrizes...)
		plan.ItemPurchases = append(plan.ItemPurchases, record.ItemPurchases...)
	}
	return plan, nil
}

func ApplyEcoStateImport(ctx context.Context, db *pgxpool.Pool, plan EcoStateImportPlan) (EcoStateImportResult, error) {
	result := EcoStateImportResult{Warnings: append([]string{}, plan.Warnings...)}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, user := range plan.Users {
		if _, err := tx.Exec(ctx,
			`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO NOTHING`,
			user.ID,
			user.Username,
			user.DisplayName,
			user.FirstSeenAt,
			user.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert placeholder user %d failed: %w", user.ID, err)
		}
		result.UsersUpserted++
	}

	for _, state := range plan.States {
		if err := deleteEcoUserChildRows(ctx, tx, state.UserID); err != nil {
			return result, err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_states (
			   user_id, pending, spawn_leftover_ms, auto_leftover_ms, point_buffer,
			   lucky_generations_remaining, glove_uses_remaining, daily_trash_date,
			   daily_trash_points, exp, lifetime_cleared, lifetime_points,
			   points_snapshot, last_tick_at_ms, created_at_ms, updated_at_ms,
			   raw_state, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13,
			   $14, $15, $16, $17::jsonb, $18, $19
			 )
			 ON CONFLICT (user_id) DO UPDATE SET
			   pending = excluded.pending,
			   spawn_leftover_ms = excluded.spawn_leftover_ms,
			   auto_leftover_ms = excluded.auto_leftover_ms,
			   point_buffer = excluded.point_buffer,
			   lucky_generations_remaining = excluded.lucky_generations_remaining,
			   glove_uses_remaining = excluded.glove_uses_remaining,
			   daily_trash_date = excluded.daily_trash_date,
			   daily_trash_points = excluded.daily_trash_points,
			   exp = excluded.exp,
			   lifetime_cleared = excluded.lifetime_cleared,
			   lifetime_points = excluded.lifetime_points,
			   points_snapshot = excluded.points_snapshot,
			   last_tick_at_ms = excluded.last_tick_at_ms,
			   created_at_ms = excluded.created_at_ms,
			   updated_at_ms = excluded.updated_at_ms,
			   raw_state = excluded.raw_state,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			state.UserID,
			state.Pending,
			state.SpawnLeftoverMs,
			state.AutoLeftoverMs,
			state.PointBuffer,
			state.LuckyGenerationsRemaining,
			state.GloveUsesRemaining,
			nullableStringPtr(state.DailyTrashDate),
			state.DailyTrashPoints,
			state.Exp,
			state.LifetimeCleared,
			state.LifetimePoints,
			state.PointsSnapshot,
			state.LastTickAtMs,
			state.CreatedAtMs,
			state.UpdatedAtMs,
			string(state.RawState),
			millisToTime(state.CreatedAtMs),
			millisToTime(state.UpdatedAtMs),
		); err != nil {
			return result, fmt.Errorf("upsert eco state %d failed: %w", state.UserID, err)
		}
		result.StatesUpserted++
	}

	for _, upgrade := range plan.Upgrades {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, upgrade_key) DO UPDATE SET
			   level = excluded.level,
			   updated_at = now()`,
			upgrade.UserID,
			upgrade.UpgradeKey,
			upgrade.Level,
		); err != nil {
			return result, fmt.Errorf("upsert eco upgrade %d/%s failed: %w", upgrade.UserID, upgrade.UpgradeKey, err)
		}
		result.UpgradesUpserted++
	}

	for _, inventory := range plan.PrizeInventories {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_prize_inventory
			   (user_id, prize_key, inventory_count, limited_count, lifetime_claim_count)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id, prize_key) DO UPDATE SET
			   inventory_count = excluded.inventory_count,
			   limited_count = excluded.limited_count,
			   lifetime_claim_count = excluded.lifetime_claim_count,
			   updated_at = now()`,
			inventory.UserID,
			inventory.PrizeKey,
			inventory.InventoryCount,
			inventory.LimitedCount,
			inventory.LifetimeClaimCount,
		); err != nil {
			return result, fmt.Errorf("upsert eco prize inventory %d/%s failed: %w", inventory.UserID, inventory.PrizeKey, err)
		}
		result.PrizeInventoriesUpserted++
	}

	for _, lot := range plan.PrizeLots {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_prize_lots (
			   id, user_id, prize_key, acquired_at_ms, available_at_ms, limited, source,
			   public_entry_id, publicly_listed_at_ms, merchant_available_at_ms,
			   stolen_from_user_id, stolen_at_ms, theft_id, black_market_available_at_ms
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   prize_key = excluded.prize_key,
			   acquired_at_ms = excluded.acquired_at_ms,
			   available_at_ms = excluded.available_at_ms,
			   limited = excluded.limited,
			   source = excluded.source,
			   public_entry_id = excluded.public_entry_id,
			   publicly_listed_at_ms = excluded.publicly_listed_at_ms,
			   merchant_available_at_ms = excluded.merchant_available_at_ms,
			   stolen_from_user_id = excluded.stolen_from_user_id,
			   stolen_at_ms = excluded.stolen_at_ms,
			   theft_id = excluded.theft_id,
			   black_market_available_at_ms = excluded.black_market_available_at_ms,
			   updated_at = now()`,
			lot.ID,
			lot.UserID,
			lot.PrizeKey,
			lot.AcquiredAtMs,
			lot.AvailableAtMs,
			lot.Limited,
			lot.Source,
			nullableStringPtr(lot.PublicEntryID),
			nullableInt64Ptr(lot.PubliclyListedAtMs),
			nullableInt64Ptr(lot.MerchantAvailableAtMs),
			nullableInt64Ptr(lot.StolenFromUserID),
			nullableInt64Ptr(lot.StolenAtMs),
			nullableStringPtr(lot.TheftID),
			nullableInt64Ptr(lot.BlackMarketAvailableAtMs),
		); err != nil {
			return result, fmt.Errorf("upsert eco prize lot %s failed: %w", lot.ID, err)
		}
		result.PrizeLotsUpserted++
	}

	for _, prize := range plan.VisiblePrizes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_visible_prizes (id, user_id, prize_key, created_at_ms, limited)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   prize_key = excluded.prize_key,
			   created_at_ms = excluded.created_at_ms,
			   limited = excluded.limited`,
			prize.ID,
			prize.UserID,
			prize.PrizeKey,
			prize.CreatedAtMs,
			prize.Limited,
		); err != nil {
			return result, fmt.Errorf("upsert eco visible prize %s failed: %w", prize.ID, err)
		}
		result.VisiblePrizesUpserted++
	}

	for _, purchase := range plan.ItemPurchases {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_item_purchases (user_id, item_key, purchase_date, purchase_count)
			 VALUES ($1, $2, $3::date, $4)
			 ON CONFLICT (user_id, item_key, purchase_date) DO UPDATE SET
			   purchase_count = excluded.purchase_count,
			   updated_at = now()`,
			purchase.UserID,
			purchase.ItemKey,
			purchase.PurchaseDate,
			purchase.PurchaseCount,
		); err != nil {
			return result, fmt.Errorf("upsert eco item purchase %d/%s/%s failed: %w", purchase.UserID, purchase.ItemKey, purchase.PurchaseDate, err)
		}
		result.ItemPurchasesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func deleteEcoUserChildRows(ctx context.Context, tx pgx.Tx, userID int64) error {
	statements := []string{
		`DELETE FROM eco_user_upgrades WHERE user_id = $1`,
		`DELETE FROM eco_prize_inventory WHERE user_id = $1`,
		`DELETE FROM eco_prize_lots WHERE user_id = $1`,
		`DELETE FROM eco_visible_prizes WHERE user_id = $1`,
		`DELETE FROM eco_item_purchases WHERE user_id = $1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return fmt.Errorf("delete eco child rows %d failed: %w", userID, err)
		}
	}
	return nil
}

func parseLegacyEcoState(key string, rawValue string) (parsedEcoState, []string, bool) {
	userID := userIDFromPrefixedKey(key, "eco:state:")
	if userID <= 0 {
		return parsedEcoState{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	var raw rawEcoState
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return parsedEcoState{}, []string{fmt.Sprintf("跳过 %s：环保状态 JSON 解析失败：%v", key, err)}, false
	}

	warnings := []string{}
	if rawUserID := int64FromRaw(raw.UserID, userID); rawUserID > 0 && rawUserID != userID {
		warnings = append(warnings, fmt.Sprintf("%s 的 JSON userId=%d 与 key 用户 ID=%d 不一致，按 key 导入", key, rawUserID, userID))
	}

	now := nowMillis()
	createdAtMs := positiveInt64Or(raw.CreatedAt, now)
	updatedAtMs := positiveInt64Or(raw.UpdatedAt, createdAtMs)
	lastTickAtMs := positiveInt64Or(raw.LastTickAt, updatedAtMs)
	dailyDate, dailyWarnings := parseEcoDailyTrashDate(key, raw.DailyTrashPoints.Date)
	warnings = append(warnings, dailyWarnings...)

	state := EcoStateImportRecord{
		UserID:                    userID,
		Pending:                   nonNegativeInt64OrZero(raw.Pending),
		SpawnLeftoverMs:           nonNegativeInt64OrZero(raw.SpawnLeftoverMs),
		AutoLeftoverMs:            nonNegativeInt64OrZero(raw.AutoLeftoverMs),
		PointBuffer:               nonNegativeInt64OrZero(raw.PointBuffer),
		LuckyGenerationsRemaining: nonNegativeInt64OrZero(raw.LuckyGenerationsRemaining),
		GloveUsesRemaining:        nonNegativeInt64OrZero(raw.GloveUsesRemaining),
		DailyTrashDate:            dailyDate,
		DailyTrashPoints:          nonNegativeInt64OrZero(raw.DailyTrashPoints.Points),
		Exp:                       nonNegativeInt64OrZero(raw.Exp),
		LifetimeCleared:           nonNegativeInt64OrZero(raw.LifetimeCleared),
		LifetimePoints:            nonNegativeInt64OrZero(raw.LifetimePoints),
		PointsSnapshot:            nonNegativeInt64OrZero(raw.Points),
		LastTickAtMs:              lastTickAtMs,
		CreatedAtMs:               createdAtMs,
		UpdatedAtMs:               updatedAtMs,
		RawState:                  json.RawMessage(rawValue),
	}

	parsed := parsedEcoState{
		State:            state,
		Upgrades:         parseEcoUpgrades(userID, raw.Upgrades),
		PrizeInventories: parseEcoPrizeInventories(userID, raw.Inventory, raw.LimitedPrizeInventory, raw.LifetimePrizeClaimCounts),
	}

	lots, lotWarnings := parseEcoPrizeLots(userID, raw.PrizeLots)
	warnings = append(warnings, lotWarnings...)
	parsed.PrizeLots = lots

	visible, visibleWarnings := parseEcoVisiblePrizes(userID, raw.VisiblePrizes)
	warnings = append(warnings, visibleWarnings...)
	parsed.VisiblePrizes = visible

	purchases, purchaseWarnings := parseEcoItemPurchases(userID, raw.ItemPurchases)
	warnings = append(warnings, purchaseWarnings...)
	parsed.ItemPurchases = purchases

	return parsed, warnings, true
}

func parseEcoUpgrades(userID int64, raw map[string]json.RawMessage) []EcoUserUpgradeImportRecord {
	records := make([]EcoUserUpgradeImportRecord, 0, len(ecoUpgradeKeys))
	for _, key := range ecoUpgradeKeys {
		level := nonNegativeInt64OrZero(raw[key])
		if maxLevel, ok := ecoUpgradeMax[key]; ok && level > maxLevel {
			level = maxLevel
		}
		records = append(records, EcoUserUpgradeImportRecord{
			UserID:     userID,
			UpgradeKey: key,
			Level:      level,
		})
	}
	return records
}

func parseEcoPrizeInventories(userID int64, inventory map[string]json.RawMessage, limited map[string]json.RawMessage, lifetime map[string]json.RawMessage) []EcoPrizeInventoryImportRecord {
	records := make([]EcoPrizeInventoryImportRecord, 0, len(ecoPrizeKeys))
	for _, key := range ecoPrizeKeys {
		inventoryCount := nonNegativeInt64OrZero(inventory[key])
		limitedCount := nonNegativeInt64OrZero(limited[key])
		if limitedCount > inventoryCount {
			limitedCount = inventoryCount
		}
		lifetimeClaimCount := nonNegativeInt64OrZero(lifetime[key])
		if lifetimeClaimCount < inventoryCount {
			lifetimeClaimCount = inventoryCount
		}
		records = append(records, EcoPrizeInventoryImportRecord{
			UserID:             userID,
			PrizeKey:           key,
			InventoryCount:     inventoryCount,
			LimitedCount:       limitedCount,
			LifetimeClaimCount: lifetimeClaimCount,
		})
	}
	return records
}

func parseEcoPrizeLots(userID int64, rawLots []rawEcoPrizeLot) ([]EcoPrizeLotImportRecord, []string) {
	records := make([]EcoPrizeLotImportRecord, 0, len(rawLots))
	warnings := []string{}
	for _, lot := range rawLots {
		id := strings.TrimSpace(lot.ID)
		if id == "" {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d prizeLots：缺少 lot id", userID))
			continue
		}
		prizeKey := strings.TrimSpace(lot.Key)
		if !isEcoPrizeKey(prizeKey) {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d prizeLots:%s：无效奖品 key %q", userID, id, prizeKey))
			continue
		}
		acquiredAtMs := positiveInt64Or(lot.AcquiredAt, 0)
		if acquiredAtMs <= 0 {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d prizeLots:%s：acquiredAt 无效", userID, id))
			continue
		}
		availableAtMs := positiveInt64Or(lot.AvailableAt, acquiredAtMs)
		source := strings.TrimSpace(lot.Source)
		if !isEcoPrizeLotSource(source) {
			source = "claim"
		}
		records = append(records, EcoPrizeLotImportRecord{
			ID:                       id,
			UserID:                   userID,
			PrizeKey:                 prizeKey,
			AcquiredAtMs:             acquiredAtMs,
			AvailableAtMs:            availableAtMs,
			Limited:                  boolFromRaw(lot.Limited, false),
			Source:                   source,
			PublicEntryID:            cleanOptionalString(lot.PublicEntryID),
			PubliclyListedAtMs:       positiveInt64FromRaw(lot.PubliclyListedAt),
			MerchantAvailableAtMs:    positiveInt64FromRaw(lot.MerchantAvailableAt),
			StolenFromUserID:         positiveInt64FromRaw(lot.StolenFromUserID),
			StolenAtMs:               positiveInt64FromRaw(lot.StolenAt),
			TheftID:                  cleanOptionalString(lot.TheftID),
			BlackMarketAvailableAtMs: positiveInt64FromRaw(lot.BlackMarketAvailableAt),
		})
	}
	return records, warnings
}

func parseEcoVisiblePrizes(userID int64, rawPrizes []rawEcoVisiblePrize) ([]EcoVisiblePrizeImportRecord, []string) {
	records := make([]EcoVisiblePrizeImportRecord, 0, len(rawPrizes))
	warnings := []string{}
	for _, prize := range rawPrizes {
		id := strings.TrimSpace(prize.ID)
		if id == "" {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d visiblePrizes：缺少 visible prize id", userID))
			continue
		}
		prizeKey := strings.TrimSpace(prize.Key)
		if !isEcoPrizeKey(prizeKey) {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d visiblePrizes:%s：无效奖品 key %q", userID, id, prizeKey))
			continue
		}
		createdAtMs := positiveInt64Or(prize.CreatedAt, 0)
		if createdAtMs <= 0 {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d visiblePrizes:%s：createdAt 无效", userID, id))
			continue
		}
		records = append(records, EcoVisiblePrizeImportRecord{
			ID:          id,
			UserID:      userID,
			PrizeKey:    prizeKey,
			CreatedAtMs: createdAtMs,
			Limited:     boolFromRaw(prize.Limited, false),
		})
	}
	return records, warnings
}

func parseEcoItemPurchases(userID int64, rawPurchases map[string]rawEcoItemPurchase) ([]EcoItemPurchaseImportRecord, []string) {
	records := make([]EcoItemPurchaseImportRecord, 0, len(rawPurchases))
	warnings := []string{}
	for itemKey, purchase := range rawPurchases {
		itemKey = strings.TrimSpace(itemKey)
		if !isEcoItemKey(itemKey) {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d itemPurchases:%s：无效道具 key", userID, itemKey))
			continue
		}
		date := strings.TrimSpace(purchase.Date)
		if !isValidDateString(date) {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:state:%d itemPurchases:%s：无效日期", userID, itemKey))
			continue
		}
		records = append(records, EcoItemPurchaseImportRecord{
			UserID:        userID,
			ItemKey:       itemKey,
			PurchaseDate:  date,
			PurchaseCount: nonNegativeInt64OrZero(purchase.Count),
		})
	}
	return records, warnings
}

func parseEcoDailyTrashDate(source string, value string) (*string, []string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if !isValidDateString(value) {
		return nil, []string{fmt.Sprintf("%s dailyTrashPoints.date 无效，已置空", source)}
	}
	return &value, nil
}

func nonNegativeInt64OrZero(raw json.RawMessage) int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value < 0 {
		return 0
	}
	return value
}

func positiveInt64Or(raw json.RawMessage, fallback int64) int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return fallback
	}
	return value
}

func isEcoPrizeKey(value string) bool {
	for _, key := range ecoPrizeKeys {
		if value == key {
			return true
		}
	}
	return false
}

func isEcoPrizeLotSource(value string) bool {
	return value == "claim" || value == "stolen" || value == "restored"
}

func isEcoItemKey(value string) bool {
	_, ok := ecoItemKeys[value]
	return ok
}

func cleanOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}
