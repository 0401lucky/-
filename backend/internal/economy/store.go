package economy

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var defaultCategories = []defaultCategory{
	{ID: "lottery", Name: "抽奖次数", Color: "#06b6d4", SortOrder: 1, Enabled: true},
	{ID: "card", Name: "卡牌抽卡", Color: "#3b82f6", SortOrder: 2, Enabled: true},
	{ID: "makeup", Name: "补签道具", Color: "#22c55e", SortOrder: 3, Enabled: true},
}

var defaultItems = []defaultItem{
	{
		ID:          "lottery-spin-1",
		Name:        "抽奖机会 x1",
		Description: "兑换一次抽奖机会",
		Type:        ItemTypeLotterySpin,
		CategoryID:  "lottery",
		PointsCost:  13000,
		Value:       1,
		DailyLimit:  ptrInt64(1),
		SortOrder:   1,
		Enabled:     true,
	},
	{
		ID:          "lottery-spin-2",
		Name:        "抽奖机会 x2",
		Description: "兑换两次抽奖机会",
		Type:        ItemTypeLotterySpin,
		CategoryID:  "lottery",
		PointsCost:  24000,
		Value:       2,
		DailyLimit:  ptrInt64(1),
		SortOrder:   2,
		Enabled:     true,
	},
	{
		ID:          "card-draw-1",
		Name:        "动物卡抽卡次数 x1",
		Description: "兑换一次动物卡抽卡机会",
		Type:        ItemTypeCardDraw,
		CategoryID:  "card",
		PointsCost:  900,
		Value:       1,
		SortOrder:   5,
		Enabled:     true,
	},
	{
		ID:          "makeup-card-1",
		Name:        "补签卡 x1",
		Description: "用于补回本周漏签的日子，补签后视同已签到。",
		Type:        ItemTypeMakeupCard,
		CategoryID:  "makeup",
		PointsCost:  30,
		Value:       1,
		SortOrder:   8,
		Enabled:     true,
	},
}

func ensureDefaultStore(ctx context.Context, tx pgx.Tx) error {
	for _, category := range defaultCategories {
		if _, err := tx.Exec(ctx,
			`INSERT INTO store_categories (id, name, color, sort_order, enabled, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, now(), now())
			 ON CONFLICT (id) DO NOTHING`,
			category.ID,
			category.Name,
			category.Color,
			category.SortOrder,
			category.Enabled,
		); err != nil {
			return err
		}
	}

	for _, item := range defaultItems {
		if _, err := tx.Exec(ctx,
			`INSERT INTO store_items
			   (id, name, description, type, category_id, points_cost, value, daily_limit, sort_order, enabled, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
			 ON CONFLICT (id) DO NOTHING`,
			item.ID,
			item.Name,
			item.Description,
			item.Type,
			item.CategoryID,
			item.PointsCost,
			item.Value,
			item.DailyLimit,
			item.SortOrder,
			item.Enabled,
		); err != nil {
			return err
		}
	}
	return nil
}

func listStoreCategories(ctx context.Context, tx pgx.Tx, includeDisabled bool) ([]StoreCategory, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, name, color, sort_order, enabled, created_at, updated_at
		 FROM store_categories
		 WHERE $1 OR enabled = true
		 ORDER BY sort_order ASC, id ASC`,
		includeDisabled,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	categories := make([]StoreCategory, 0)
	for rows.Next() {
		var category StoreCategory
		var createdAt time.Time
		var updatedAt time.Time
		if err := rows.Scan(
			&category.ID,
			&category.Name,
			&category.Color,
			&category.SortOrder,
			&category.Enabled,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, err
		}
		category.CreatedAt = millis(createdAt)
		category.UpdatedAt = millis(updatedAt)
		categories = append(categories, category)
	}
	return categories, rows.Err()
}

func listStoreItems(ctx context.Context, tx pgx.Tx, includeDisabled bool) ([]StoreItem, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, name, description, type, COALESCE(category_id, ''),
		        points_cost, value, daily_limit, total_stock, purchase_count,
		        sort_order, enabled, created_at, updated_at
		 FROM store_items
		 WHERE $1 OR enabled = true
		 ORDER BY sort_order ASC, id ASC`,
		includeDisabled,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]StoreItem, 0)
	for rows.Next() {
		item, err := scanStoreItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func getStoreItemForUpdate(ctx context.Context, tx pgx.Tx, itemID string) (StoreItem, error) {
	row := tx.QueryRow(ctx,
		`SELECT id, name, description, type, COALESCE(category_id, ''),
		        points_cost, value, daily_limit, total_stock, purchase_count,
		        sort_order, enabled, created_at, updated_at
		 FROM store_items
		 WHERE id = $1
		 FOR UPDATE`,
		itemID,
	)
	return scanStoreItem(row)
}

type storeItemScanner interface {
	Scan(dest ...any) error
}

func scanStoreItem(scanner storeItemScanner) (StoreItem, error) {
	var item StoreItem
	var dailyLimit sql.NullInt64
	var totalStock sql.NullInt64
	var createdAt time.Time
	var updatedAt time.Time

	if err := scanner.Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&item.Type,
		&item.CategoryID,
		&item.PointsCost,
		&item.Value,
		&dailyLimit,
		&totalStock,
		&item.PurchaseCount,
		&item.SortOrder,
		&item.Enabled,
		&createdAt,
		&updatedAt,
	); err != nil {
		return StoreItem{}, err
	}

	if dailyLimit.Valid {
		item.DailyLimit = &dailyLimit.Int64
	}
	if totalStock.Valid {
		item.TotalStock = &totalStock.Int64
	}
	item.CreatedAt = millis(createdAt)
	item.UpdatedAt = millis(updatedAt)
	return item, nil
}

func lockDailyPurchaseCount(ctx context.Context, tx pgx.Tx, userID int64, itemID string, statDate string) (int64, error) {
	if _, err := tx.Exec(ctx,
		`INSERT INTO store_daily_purchases (user_id, item_id, stat_date, purchase_count, updated_at)
		 VALUES ($1, $2, $3, 0, now())
		 ON CONFLICT (user_id, item_id, stat_date) DO NOTHING`,
		userID,
		itemID,
		statDate,
	); err != nil {
		return 0, err
	}

	var count int64
	err := tx.QueryRow(ctx,
		`SELECT purchase_count
		 FROM store_daily_purchases
		 WHERE user_id = $1 AND item_id = $2 AND stat_date = $3
		 FOR UPDATE`,
		userID,
		itemID,
		statDate,
	).Scan(&count)
	return count, err
}

func grantStoreReward(ctx context.Context, tx pgx.Tx, userID int64, itemType string, amount int64) (string, *int64, error) {
	if amount <= 0 {
		return "", nil, errors.New("reward amount must be positive")
	}

	switch itemType {
	case ItemTypeLotterySpin:
		return "extra_spins", nil, incrementUserAsset(ctx, tx, userID, "extra_spins", amount)
	case ItemTypeCardDraw:
		if _, err := incrementUserAssetReturning(ctx, tx, userID, "card_draws", amount); err != nil {
			return "", nil, err
		}
		draws, err := incrementCardUserStateDrawsReturning(ctx, tx, userID, amount)
		if err != nil {
			return "", nil, err
		}
		return "card_draws", &draws, nil
	case ItemTypeMakeupCard:
		return "makeup_cards", nil, incrementUserAsset(ctx, tx, userID, "makeup_cards", amount)
	default:
		return "", nil, fmt.Errorf("unsupported reward type: %s", itemType)
	}
}

func incrementUserAsset(ctx context.Context, tx pgx.Tx, userID int64, column string, amount int64) error {
	_, err := incrementUserAssetReturning(ctx, tx, userID, column, amount)
	return err
}

func incrementUserAssetReturning(ctx context.Context, tx pgx.Tx, userID int64, column string, amount int64) (int64, error) {
	if column != "extra_spins" && column != "card_draws" && column != "makeup_cards" {
		return 0, fmt.Errorf("unsupported asset column: %s", column)
	}

	query := fmt.Sprintf(
		`INSERT INTO user_assets (user_id, %s, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   %s = user_assets.%s + excluded.%s,
		   updated_at = now()
		 RETURNING %s`,
		column,
		column,
		column,
		column,
		column,
	)

	var next int64
	err := tx.QueryRow(ctx, query, userID, amount).Scan(&next)
	return next, err
}

func incrementCardUserStateDrawsReturning(ctx context.Context, tx pgx.Tx, userID int64, amount int64) (int64, error) {
	if amount <= 0 {
		return 0, errors.New("card draw amount must be positive")
	}

	var drawsAvailable int64
	err := tx.QueryRow(ctx,
		`INSERT INTO card_user_states (
		   user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
		   pity_legendary_rare, draws_available, collection_rewards, recent_draws,
		   raw_state, created_at, updated_at
		 ) VALUES (
		   $1, '[]'::jsonb, 0, 0, 0, 0, 0, 1 + $2, '[]'::jsonb, '[]'::jsonb,
		   '{}'::jsonb, now(), now()
		 )
		 ON CONFLICT (user_id) DO UPDATE SET
		   draws_available = card_user_states.draws_available + excluded.draws_available - 1,
		   updated_at = now()
		 RETURNING draws_available`,
		userID,
		amount,
	).Scan(&drawsAvailable)
	if err != nil {
		return 0, err
	}
	return drawsAvailable, nil
}

func insertExchangeLog(ctx context.Context, tx pgx.Tx, log ExchangeLog, quantity int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO exchange_logs
		   (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9::double precision / 1000))`,
		log.ID,
		log.UserID,
		log.ItemID,
		log.ItemName,
		log.PointsCost,
		log.Value,
		log.Type,
		quantity,
		log.CreatedAt,
	)
	return err
}

func listExchangeLogs(ctx context.Context, tx pgx.Tx, userID int64, limit int) ([]ExchangeLog, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, user_id, item_id, item_name, points_cost, value, type, created_at
		 FROM exchange_logs
		 WHERE user_id = $1
		 ORDER BY created_at DESC, id DESC
		 LIMIT $2`,
		userID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	logs := make([]ExchangeLog, 0)
	for rows.Next() {
		var log ExchangeLog
		var createdAt time.Time
		if err := rows.Scan(
			&log.ID,
			&log.UserID,
			&log.ItemID,
			&log.ItemName,
			&log.PointsCost,
			&log.Value,
			&log.Type,
			&createdAt,
		); err != nil {
			return nil, err
		}
		log.CreatedAt = millis(createdAt)
		logs = append(logs, log)
	}
	return logs, rows.Err()
}

func isSupportedRewardType(itemType string) bool {
	return itemType == ItemTypeLotterySpin || itemType == ItemTypeCardDraw || itemType == ItemTypeMakeupCard
}

func rewardMessage(itemType string, amount int64) string {
	switch itemType {
	case ItemTypeLotterySpin:
		return fmt.Sprintf("获得 %d 次抽奖机会", amount)
	case ItemTypeCardDraw:
		return fmt.Sprintf("获得 %d 次卡牌抽奖机会", amount)
	case ItemTypeMakeupCard:
		return fmt.Sprintf("获得 %d 张补签卡，可在签到页面使用", amount)
	default:
		return "兑换成功"
	}
}
