package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxPostgresInteger = 2147483647

type StoreDataImportPlan struct {
	Users          []UserImportRecord
	Categories     []StoreCategoryImportRecord
	Items          []StoreItemImportRecord
	ExchangeLogs   []StoreExchangeLogImportRecord
	DailyPurchases []StoreDailyPurchaseImportRecord
	Warnings       []string
}

type StoreDataImportResult struct {
	UsersUpserted          int
	CategoriesUpserted     int
	ItemsUpserted          int
	ExchangeLogsUpserted   int
	DailyPurchasesUpserted int
	Warnings               []string
}

type StoreCategoryImportRecord struct {
	ID        string
	Name      string
	Color     string
	SortOrder int
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

type StoreItemImportRecord struct {
	ID            string
	Name          string
	Description   string
	Type          string
	CategoryID    string
	PointsCost    int64
	Value         int64
	DailyLimit    *int64
	TotalStock    *int64
	PurchaseCount int64
	SortOrder     int
	Enabled       bool
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type StoreExchangeLogImportRecord struct {
	ID         string
	UserID     int64
	ItemID     string
	ItemName   string
	PointsCost int64
	Value      int64
	Type       string
	Quantity   int64
	CreatedAt  time.Time
}

type StoreDailyPurchaseImportRecord struct {
	UserID        int64
	ItemID        string
	StatDate      string
	PurchaseCount int64
	UpdatedAt     time.Time
}

type rawStoreCategory struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Color     string          `json:"color"`
	SortOrder json.RawMessage `json:"sortOrder"`
	Enabled   json.RawMessage `json:"enabled"`
	CreatedAt json.RawMessage `json:"createdAt"`
	UpdatedAt json.RawMessage `json:"updatedAt"`
}

type rawStoreItem struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Type        string          `json:"type"`
	CategoryID  string          `json:"categoryId"`
	PointsCost  json.RawMessage `json:"pointsCost"`
	Value       json.RawMessage `json:"value"`
	DailyLimit  json.RawMessage `json:"dailyLimit"`
	TotalStock  json.RawMessage `json:"totalStock"`
	SortOrder   json.RawMessage `json:"sortOrder"`
	Enabled     json.RawMessage `json:"enabled"`
	CreatedAt   json.RawMessage `json:"createdAt"`
	UpdatedAt   json.RawMessage `json:"updatedAt"`
}

type rawStoreExchangeLog struct {
	ID         string          `json:"id"`
	UserID     json.RawMessage `json:"userId"`
	ItemID     string          `json:"itemId"`
	ItemName   string          `json:"itemName"`
	PointsCost json.RawMessage `json:"pointsCost"`
	Value      json.RawMessage `json:"value"`
	Type       string          `json:"type"`
	CreatedAt  json.RawMessage `json:"createdAt"`
}

func PlanStoreDataImport(reader io.Reader) (StoreDataImportPlan, error) {
	plan := StoreDataImportPlan{}
	users := map[int64]UserImportRecord{}
	categories := map[string]StoreCategoryImportRecord{}
	items := map[string]StoreItemImportRecord{}
	purchaseCounts := map[string]int64{}
	exchangeLogs := map[string]StoreExchangeLogImportRecord{}
	dailyPurchases := map[string]StoreDailyPurchaseImportRecord{}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statement, ok := parseInsertStatement(line)
		if !ok {
			continue
		}

		switch statement.Table {
		case "kv_hashes":
			key, ok := kvKey(statement)
			if !ok {
				continue
			}
			field, _ := valueFor(statement, []string{"key", "field", "value"}, "field", 1)
			value, ok := valueFor(statement, []string{"key", "field", "value"}, "value", 2)
			if !ok || strings.TrimSpace(value) == "" {
				continue
			}

			switch key {
			case "store:categories":
				category, warnings, ok := parseStoreCategory(field, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					categories[category.ID] = category
				}
			case "store:items":
				item, warnings, ok := parseStoreItem(field, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					items[item.ID] = item
				}
			case "store:item:purchase_counts":
				count, warnings, ok := parseStoreItemPurchaseCount(field, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					purchaseCounts[strings.TrimSpace(field)] = count
				}
			}
		case "kv_lists":
			key, ok := kvKey(statement)
			if !ok || !matchKeyPattern(key, "exchange_log:*") {
				continue
			}
			value, ok := valueFor(statement, []string{"id", "key", "value"}, "value", 2)
			if !ok {
				continue
			}
			listID, _ := valueFor(statement, []string{"id", "key", "value"}, "id", 0)
			log, warnings, ok := parseStoreExchangeLog(key, listID, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				exchangeLogs[log.ID] = log
				ensurePlanUser(users, log.UserID, log.CreatedAt)
			}
		case "kv_data":
			key, ok := kvKey(statement)
			if !ok || !matchKeyPattern(key, "exchange:daily:*") {
				continue
			}
			value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
			if !ok {
				continue
			}
			entry, warnings, ok := parseStoreDailyPurchase(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				dailyPurchases[storeDailyPurchaseKey(entry.UserID, entry.StatDate, entry.ItemID)] = entry
				ensurePlanUser(users, entry.UserID, entry.UpdatedAt)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for itemID, count := range purchaseCounts {
		item, ok := items[itemID]
		if !ok {
			plan.Warnings = append(plan.Warnings, fmt.Sprintf("store:item:purchase_counts:%s 无对应商品，已跳过购买次数导入", itemID))
			continue
		}
		item.PurchaseCount = count
		items[itemID] = item
	}

	for _, item := range items {
		if item.CategoryID != "" {
			if _, ok := categories[item.CategoryID]; !ok {
				plan.Warnings = append(plan.Warnings, fmt.Sprintf("store_items:%s 的 categoryId %q 未在导出分类中出现；apply 时若目标库也不存在会置空", item.ID, item.CategoryID))
			}
		}
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, category := range categories {
		plan.Categories = append(plan.Categories, category)
	}
	for _, item := range items {
		plan.Items = append(plan.Items, item)
	}
	for _, log := range exchangeLogs {
		plan.ExchangeLogs = append(plan.ExchangeLogs, log)
	}
	for _, entry := range dailyPurchases {
		plan.DailyPurchases = append(plan.DailyPurchases, entry)
	}
	return plan, nil
}

func ApplyStoreDataImport(ctx context.Context, db *pgxpool.Pool, plan StoreDataImportPlan) (StoreDataImportResult, error) {
	result := StoreDataImportResult{Warnings: append([]string{}, plan.Warnings...)}
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

	for _, category := range plan.Categories {
		if _, err := tx.Exec(ctx,
			`INSERT INTO store_categories (id, name, color, sort_order, enabled, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET
			   name = excluded.name,
			   color = excluded.color,
			   sort_order = excluded.sort_order,
			   enabled = excluded.enabled,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			category.ID,
			category.Name,
			category.Color,
			category.SortOrder,
			category.Enabled,
			category.CreatedAt,
			category.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert store category %s failed: %w", category.ID, err)
		}
		result.CategoriesUpserted++
	}

	for _, item := range plan.Items {
		if _, err := tx.Exec(ctx,
			`INSERT INTO store_items (
			   id, name, description, type, category_id, points_cost, value, daily_limit,
			   total_stock, purchase_count, sort_order, enabled, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3, $4,
			   CASE WHEN NULLIF($5, '') IS NULL THEN NULL ELSE (SELECT id FROM store_categories WHERE id = $5) END,
			   $6, $7, $8, $9, $10, $11, $12, $13, $14
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   type = excluded.type,
			   category_id = excluded.category_id,
			   points_cost = excluded.points_cost,
			   value = excluded.value,
			   daily_limit = excluded.daily_limit,
			   total_stock = excluded.total_stock,
			   purchase_count = excluded.purchase_count,
			   sort_order = excluded.sort_order,
			   enabled = excluded.enabled,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			item.ID,
			item.Name,
			item.Description,
			item.Type,
			item.CategoryID,
			item.PointsCost,
			item.Value,
			nullableInt64Ptr(item.DailyLimit),
			nullableInt64Ptr(item.TotalStock),
			item.PurchaseCount,
			item.SortOrder,
			item.Enabled,
			item.CreatedAt,
			item.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert store item %s failed: %w", item.ID, err)
		}
		result.ItemsUpserted++
	}

	for _, log := range plan.ExchangeLogs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO exchange_logs
			   (id, user_id, item_id, item_name, points_cost, value, type, quantity, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   item_id = excluded.item_id,
			   item_name = excluded.item_name,
			   points_cost = excluded.points_cost,
			   value = excluded.value,
			   type = excluded.type,
			   quantity = excluded.quantity,
			   created_at = excluded.created_at`,
			log.ID,
			log.UserID,
			log.ItemID,
			log.ItemName,
			log.PointsCost,
			log.Value,
			log.Type,
			log.Quantity,
			log.CreatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert exchange log %s failed: %w", log.ID, err)
		}
		result.ExchangeLogsUpserted++
	}

	for _, entry := range plan.DailyPurchases {
		tag, err := tx.Exec(ctx,
			`INSERT INTO store_daily_purchases (user_id, item_id, stat_date, purchase_count, updated_at)
			 SELECT $1::bigint, $2::text, $3::date, $4::bigint, $5::timestamptz
			 WHERE EXISTS (SELECT 1 FROM store_items WHERE id = $2)
			 ON CONFLICT (user_id, item_id, stat_date) DO UPDATE SET
			   purchase_count = excluded.purchase_count,
			   updated_at = excluded.updated_at`,
			entry.UserID,
			entry.ItemID,
			entry.StatDate,
			entry.PurchaseCount,
			entry.UpdatedAt,
		)
		if err != nil {
			return result, fmt.Errorf("upsert store daily purchase %d/%s/%s failed: %w", entry.UserID, entry.StatDate, entry.ItemID, err)
		}
		if tag.RowsAffected() == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("exchange:daily:%d:%s:%s 目标库无对应商品，已跳过", entry.UserID, entry.StatDate, entry.ItemID))
			continue
		}
		result.DailyPurchasesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseStoreCategory(field string, rawValue string) (StoreCategoryImportRecord, []string, bool) {
	var raw rawStoreCategory
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return StoreCategoryImportRecord{}, []string{fmt.Sprintf("跳过 store:categories:%s：分类 JSON 解析失败：%v", field, err)}, false
	}

	id := fallbackString(raw.ID, strings.TrimSpace(field))
	if id == "" {
		return StoreCategoryImportRecord{}, []string{"跳过 store:categories：缺少分类 ID"}, false
	}
	sortOrder, ok := intFromRaw(raw.SortOrder, 0)
	if !ok {
		return StoreCategoryImportRecord{}, []string{fmt.Sprintf("跳过 store:categories:%s：sortOrder 超出 PostgreSQL integer 范围", id)}, false
	}
	createdAtMillis := int64FromRaw(raw.CreatedAt, nowMillis())
	updatedAtMillis := int64FromRaw(raw.UpdatedAt, createdAtMillis)
	return StoreCategoryImportRecord{
		ID:        id,
		Name:      fallbackString(raw.Name, id),
		Color:     fallbackString(raw.Color, "#64748b"),
		SortOrder: sortOrder,
		Enabled:   boolFromRaw(raw.Enabled, true),
		CreatedAt: millisToTime(createdAtMillis),
		UpdatedAt: millisToTime(updatedAtMillis),
	}, nil, true
}

func parseStoreItem(field string, rawValue string) (StoreItemImportRecord, []string, bool) {
	var raw rawStoreItem
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：商品 JSON 解析失败：%v", field, err)}, false
	}

	id := fallbackString(raw.ID, strings.TrimSpace(field))
	if id == "" {
		return StoreItemImportRecord{}, []string{"跳过 store:items：缺少商品 ID"}, false
	}
	itemType := strings.TrimSpace(raw.Type)
	if !isValidStoreItemType(itemType) {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：无效商品类型 %q", id, itemType)}, false
	}

	pointsCost := int64FromRaw(raw.PointsCost, 0)
	if pointsCost <= 0 {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：pointsCost 必须大于 0", id)}, false
	}
	value := int64FromRaw(raw.Value, 0)
	if value <= 0 {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：value 必须大于 0", id)}, false
	}
	dailyLimit, ok := optionalNonNegativeInt64(raw.DailyLimit)
	if !ok {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：dailyLimit 不能为负数", id)}, false
	}
	totalStock, ok := optionalNonNegativeInt64(raw.TotalStock)
	if !ok {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：totalStock 不能为负数", id)}, false
	}
	sortOrder, ok := intFromRaw(raw.SortOrder, 0)
	if !ok {
		return StoreItemImportRecord{}, []string{fmt.Sprintf("跳过 store:items:%s：sortOrder 超出 PostgreSQL integer 范围", id)}, false
	}

	categoryID := strings.TrimSpace(raw.CategoryID)
	if categoryID == "" && itemType != "quota_direct" {
		categoryID = defaultStoreCategoryID(itemType)
	}
	createdAtMillis := int64FromRaw(raw.CreatedAt, nowMillis())
	updatedAtMillis := int64FromRaw(raw.UpdatedAt, createdAtMillis)
	return StoreItemImportRecord{
		ID:            id,
		Name:          fallbackString(raw.Name, id),
		Description:   raw.Description,
		Type:          itemType,
		CategoryID:    categoryID,
		PointsCost:    pointsCost,
		Value:         value,
		DailyLimit:    dailyLimit,
		TotalStock:    totalStock,
		PurchaseCount: 0,
		SortOrder:     sortOrder,
		Enabled:       boolFromRaw(raw.Enabled, true),
		CreatedAt:     millisToTime(createdAtMillis),
		UpdatedAt:     millisToTime(updatedAtMillis),
	}, nil, true
}

func parseStoreItemPurchaseCount(field string, rawValue string) (int64, []string, bool) {
	itemID := strings.TrimSpace(field)
	if itemID == "" {
		return 0, []string{"跳过 store:item:purchase_counts：缺少商品 ID"}, false
	}
	count, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return 0, []string{fmt.Sprintf("跳过 store:item:purchase_counts:%s：购买次数解析失败：%v", itemID, err)}, false
	}
	if count < 0 {
		return 0, []string{fmt.Sprintf("跳过 store:item:purchase_counts:%s：购买次数不能为负数", itemID)}, false
	}
	return count, nil, true
}

func parseStoreExchangeLog(key string, listID string, rawValue string) (StoreExchangeLogImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, "exchange_log:")
	if userID <= 0 {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	var raw rawStoreExchangeLog
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：兑换日志 JSON 解析失败：%v", key, err)}, false
	}
	if rawUserID := int64FromRaw(raw.UserID, userID); rawUserID > 0 {
		userID = rawUserID
	}

	itemID := strings.TrimSpace(raw.ItemID)
	if itemID == "" {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少 itemId", key)}, false
	}
	itemType := strings.TrimSpace(raw.Type)
	if !isValidStoreItemType(itemType) {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效商品类型 %q", key, itemType)}, false
	}
	pointsCost := int64FromRaw(raw.PointsCost, 0)
	if pointsCost <= 0 {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：pointsCost 必须大于 0", key)}, false
	}
	value := int64FromRaw(raw.Value, 0)
	if value <= 0 {
		return StoreExchangeLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：value 必须大于 0", key)}, false
	}

	createdAtMillis := int64FromRaw(raw.CreatedAt, nowMillis())
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		listID = strings.TrimSpace(listID)
		if listID != "" {
			id = "legacy-exchange-" + listID
		} else {
			id = fmt.Sprintf("legacy-exchange-%d-%d-%s", userID, createdAtMillis, itemID)
		}
	}
	return StoreExchangeLogImportRecord{
		ID:         id,
		UserID:     userID,
		ItemID:     itemID,
		ItemName:   fallbackString(raw.ItemName, itemID),
		PointsCost: pointsCost,
		Value:      value,
		Type:       itemType,
		Quantity:   1,
		CreatedAt:  millisToTime(createdAtMillis),
	}, nil, true
}

func parseStoreDailyPurchase(key string, rawValue string) (StoreDailyPurchaseImportRecord, []string, bool) {
	parts := strings.SplitN(key, ":", 5)
	if len(parts) != 5 || parts[0] != "exchange" || parts[1] != "daily" {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	userID, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || userID <= 0 {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	statDate := strings.TrimSpace(parts[3])
	if !isValidDateString(statDate) {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效日期", key)}, false
	}
	itemID := strings.TrimSpace(parts[4])
	if itemID == "" {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少商品 ID", key)}, false
	}
	count, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：每日限购次数解析失败：%v", key, err)}, false
	}
	if count < 0 {
		return StoreDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：每日限购次数不能为负数", key)}, false
	}
	return StoreDailyPurchaseImportRecord{
		UserID:        userID,
		ItemID:        itemID,
		StatDate:      statDate,
		PurchaseCount: count,
		UpdatedAt:     time.Now().UTC(),
	}, nil, true
}

func optionalNonNegativeInt64(raw json.RawMessage) (*int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	value, ok := numberFromRaw(raw)
	if !ok || value < 0 {
		return nil, false
	}
	return &value, true
}

func intFromRaw(raw json.RawMessage, fallback int) (int, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, true
	}
	value, ok := numberFromRaw(raw)
	if !ok {
		return fallback, true
	}
	if value < -maxPostgresInteger || value > maxPostgresInteger {
		return 0, false
	}
	return int(value), true
}

func isValidStoreItemType(itemType string) bool {
	return itemType == "lottery_spin" ||
		itemType == "quota_direct" ||
		itemType == "card_draw" ||
		itemType == "makeup_card"
}

func defaultStoreCategoryID(itemType string) string {
	switch itemType {
	case "card_draw":
		return "card"
	case "makeup_card":
		return "makeup"
	default:
		return "lottery"
	}
}

func storeDailyPurchaseKey(userID int64, statDate string, itemID string) string {
	return fmt.Sprintf("%d:%s:%s", userID, statDate, itemID)
}
