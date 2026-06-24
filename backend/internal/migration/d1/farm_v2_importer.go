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

const (
	farmStateKeyPrefix        = "farmv2:state:"
	farmDailyPurchasePrefix   = "farmv2:shop:daily:"
	farmMaturitySentKeyPrefix = "farmv2:mature-mail:sent:"
	farmWaterSentKeyPrefix    = "farmv2:water-mail:sent:"
)

type FarmV2ImportPlan struct {
	Users          []UserImportRecord
	States         []FarmStateImportRecord
	DailyPurchases []FarmDailyPurchaseImportRecord
	MaturityEmails []FarmMaturityEmailImportRecord
	WaterEmails    []FarmWaterEmailImportRecord
	Warnings       []string
}

type FarmV2ImportResult struct {
	UsersUpserted          int
	StatesUpserted         int
	DailyPurchasesUpserted int
	MaturityEmailsUpserted int
	WaterEmailsUpserted    int
	Warnings               []string
}

type FarmStateImportRecord struct {
	UserID       int64
	StateJSON    string
	LastTickAtMs int64
	UpdatedAtMs  int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type FarmDailyPurchaseImportRecord struct {
	UserID        int64
	PurchaseDate  string
	ItemKey       string
	PurchaseCount int64
	UpdatedAtMs   int64
}

type FarmMaturityEmailImportRecord struct {
	UserID   int64
	EventID  string
	SentAtMs int64
}

type FarmWaterEmailImportRecord struct {
	UserID           int64
	LandIndex        int64
	PlantedAtMs      int64
	NextWaterDueAtMs int64
	WaterMissCount   int64
	SentAtMs         int64
}

type rawFarmState struct {
	UserID     json.RawMessage `json:"userId"`
	LastTickAt json.RawMessage `json:"lastTickAt"`
	CreatedAt  json.RawMessage `json:"createdAt"`
	UpdatedAt  json.RawMessage `json:"updatedAt"`
}

type rawFarmEmailClaim struct {
	ClaimedAt json.RawMessage `json:"claimedAt"`
}

func PlanFarmV2Import(reader io.Reader) (FarmV2ImportPlan, error) {
	plan := FarmV2ImportPlan{}
	users := map[int64]UserImportRecord{}
	states := map[int64]FarmStateImportRecord{}
	dailyPurchases := map[string]FarmDailyPurchaseImportRecord{}
	maturityEmails := map[string]FarmMaturityEmailImportRecord{}
	waterEmails := map[string]FarmWaterEmailImportRecord{}

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
		if !ok {
			continue
		}
		value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
		if !ok {
			continue
		}

		switch {
		case matchKeyPattern(key, farmStateKeyPrefix+"*"):
			state, warnings, ok := parseFarmState(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				states[state.UserID] = state
				ensurePlanUser(users, state.UserID, state.CreatedAt)
			}
		case matchKeyPattern(key, farmDailyPurchasePrefix+"*"):
			purchase, warnings, ok := parseFarmDailyPurchase(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				dailyPurchases[farmDailyPurchasePlanKey(purchase.UserID, purchase.PurchaseDate, purchase.ItemKey)] = purchase
				ensurePlanUser(users, purchase.UserID, millisToTime(purchase.UpdatedAtMs))
			}
		case matchKeyPattern(key, farmMaturitySentKeyPrefix+"*"):
			record, warnings, ok := parseFarmMaturityEmail(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				maturityEmails[farmMaturityEmailPlanKey(record.UserID, record.EventID)] = record
				ensurePlanUser(users, record.UserID, millisToTime(record.SentAtMs))
			}
		case matchKeyPattern(key, farmWaterSentKeyPrefix+"*"):
			record, warnings, ok := parseFarmWaterEmail(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				waterEmails[farmWaterEmailPlanKey(record)] = record
				ensurePlanUser(users, record.UserID, millisToTime(record.SentAtMs))
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, state := range states {
		plan.States = append(plan.States, state)
	}
	for _, purchase := range dailyPurchases {
		plan.DailyPurchases = append(plan.DailyPurchases, purchase)
	}
	for _, record := range maturityEmails {
		plan.MaturityEmails = append(plan.MaturityEmails, record)
	}
	for _, record := range waterEmails {
		plan.WaterEmails = append(plan.WaterEmails, record)
	}
	return plan, nil
}

func ApplyFarmV2Import(ctx context.Context, db *pgxpool.Pool, plan FarmV2ImportPlan) (FarmV2ImportResult, error) {
	result := FarmV2ImportResult{Warnings: append([]string{}, plan.Warnings...)}
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
		if _, err := tx.Exec(ctx,
			`INSERT INTO farm_states (
			   user_id, state_json, last_tick_at_ms, updated_at_ms,
			   imported_at, created_at, updated_at
			 ) VALUES (
			   $1, $2::jsonb, $3, $4, now(), $5, $6
			 )
			 ON CONFLICT (user_id) DO UPDATE SET
			   state_json = excluded.state_json,
			   last_tick_at_ms = excluded.last_tick_at_ms,
			   updated_at_ms = excluded.updated_at_ms,
			   imported_at = now(),
			   updated_at = excluded.updated_at`,
			state.UserID,
			state.StateJSON,
			state.LastTickAtMs,
			state.UpdatedAtMs,
			state.CreatedAt,
			state.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert farm state %d failed: %w", state.UserID, err)
		}
		result.StatesUpserted++
	}

	for _, purchase := range plan.DailyPurchases {
		if _, err := tx.Exec(ctx,
			`INSERT INTO farm_daily_shop_purchases (
			   user_id, purchase_date, item_key, purchase_count, updated_at_ms
			 ) VALUES (
			   $1, $2::date, $3, $4, $5
			 )
			 ON CONFLICT (user_id, purchase_date, item_key) DO UPDATE SET
			   purchase_count = excluded.purchase_count,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = now()`,
			purchase.UserID,
			purchase.PurchaseDate,
			purchase.ItemKey,
			purchase.PurchaseCount,
			purchase.UpdatedAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert farm daily purchase %d/%s/%s failed: %w", purchase.UserID, purchase.PurchaseDate, purchase.ItemKey, err)
		}
		result.DailyPurchasesUpserted++
	}

	for _, record := range plan.MaturityEmails {
		if _, err := tx.Exec(ctx,
			`INSERT INTO farm_maturity_email_dedupes (user_id, event_id, sent_at_ms)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id, event_id) DO UPDATE SET
			   sent_at_ms = excluded.sent_at_ms`,
			record.UserID,
			record.EventID,
			record.SentAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert farm maturity email %d/%s failed: %w", record.UserID, record.EventID, err)
		}
		result.MaturityEmailsUpserted++
	}

	for _, record := range plan.WaterEmails {
		if _, err := tx.Exec(ctx,
			`INSERT INTO farm_water_email_dedupes (
			   user_id, land_index, planted_at_ms, next_water_due_at_ms,
			   water_miss_count, sent_at_ms
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6
			 )
			 ON CONFLICT (user_id, land_index, planted_at_ms, next_water_due_at_ms, water_miss_count) DO UPDATE SET
			   sent_at_ms = excluded.sent_at_ms`,
			record.UserID,
			record.LandIndex,
			record.PlantedAtMs,
			record.NextWaterDueAtMs,
			record.WaterMissCount,
			record.SentAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert farm water email %d/%d failed: %w", record.UserID, record.LandIndex, err)
		}
		result.WaterEmailsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseFarmState(key string, rawValue string) (FarmStateImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, farmStateKeyPrefix)
	if userID <= 0 {
		return FarmStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	if !json.Valid([]byte(rawValue)) {
		return FarmStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：农场状态 JSON 解析失败", key)}, false
	}

	var object map[string]any
	if err := json.Unmarshal([]byte(rawValue), &object); err != nil || object == nil {
		return FarmStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：农场状态必须是 JSON 对象", key)}, false
	}

	var raw rawFarmState
	if err := json.Unmarshal([]byte(rawValue), &raw); err != nil {
		return FarmStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：农场状态结构解析失败：%v", key, err)}, false
	}

	warnings := []string{}
	if rawUserID := int64FromRaw(raw.UserID, userID); rawUserID > 0 && rawUserID != userID {
		warnings = append(warnings, fmt.Sprintf("%s 的 JSON userId=%d 与 key 用户 ID=%d 不一致，按 key 导入", key, rawUserID, userID))
	}

	now := nowMillis()
	createdAtMs := positiveInt64Or(raw.CreatedAt, now)
	updatedAtMs := positiveInt64Or(raw.UpdatedAt, createdAtMs)
	lastTickAtMs := positiveInt64Or(raw.LastTickAt, updatedAtMs)
	return FarmStateImportRecord{
		UserID:       userID,
		StateJSON:    rawValue,
		LastTickAtMs: lastTickAtMs,
		UpdatedAtMs:  updatedAtMs,
		CreatedAt:    millisToTime(createdAtMs),
		UpdatedAt:    millisToTime(updatedAtMs),
	}, warnings, true
}

func parseFarmDailyPurchase(key string, rawValue string) (FarmDailyPurchaseImportRecord, []string, bool) {
	raw := strings.TrimPrefix(key, farmDailyPurchasePrefix)
	parts := strings.SplitN(raw, ":", 3)
	if len(parts) != 3 {
		return FarmDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	userID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || userID <= 0 {
		return FarmDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	date := strings.TrimSpace(parts[1])
	if !isValidDateString(date) {
		return FarmDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效日期", key)}, false
	}
	itemKey := strings.TrimSpace(parts[2])
	if itemKey == "" {
		return FarmDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少道具 key", key)}, false
	}
	count, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil || count < 0 {
		return FarmDailyPurchaseImportRecord{}, []string{fmt.Sprintf("跳过 %s：每日限购次数必须是非负整数", key)}, false
	}
	return FarmDailyPurchaseImportRecord{
		UserID:        userID,
		PurchaseDate:  date,
		ItemKey:       itemKey,
		PurchaseCount: count,
		UpdatedAtMs:   nowMillis(),
	}, nil, true
}

func parseFarmMaturityEmail(key string, rawValue string) (FarmMaturityEmailImportRecord, []string, bool) {
	raw := strings.TrimPrefix(key, farmMaturitySentKeyPrefix)
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		return FarmMaturityEmailImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	userID, err := strconv.ParseInt(parts[0], 10, 64)
	eventID := strings.TrimSpace(parts[1])
	if err != nil || userID <= 0 || eventID == "" {
		return FarmMaturityEmailImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少用户或事件 ID", key)}, false
	}
	return FarmMaturityEmailImportRecord{
		UserID:   userID,
		EventID:  eventID,
		SentAtMs: farmEmailClaimedAt(rawValue),
	}, nil, true
}

func parseFarmWaterEmail(key string, rawValue string) (FarmWaterEmailImportRecord, []string, bool) {
	raw := strings.TrimPrefix(key, farmWaterSentKeyPrefix)
	parts := strings.Split(raw, ":")
	if len(parts) != 5 {
		return FarmWaterEmailImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	values := make([]int64, 0, 5)
	for _, part := range parts {
		value, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil {
			return FarmWaterEmailImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 数值解析失败", key)}, false
		}
		values = append(values, value)
	}
	if values[0] <= 0 || values[1] <= 0 || values[2] <= 0 || values[3] <= 0 || values[4] < 0 {
		return FarmWaterEmailImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 数值范围无效", key)}, false
	}
	return FarmWaterEmailImportRecord{
		UserID:           values[0],
		LandIndex:        values[1],
		PlantedAtMs:      values[2],
		NextWaterDueAtMs: values[3],
		WaterMissCount:   values[4],
		SentAtMs:         farmEmailClaimedAt(rawValue),
	}, nil, true
}

func farmEmailClaimedAt(rawValue string) int64 {
	var claim rawFarmEmailClaim
	if err := json.Unmarshal([]byte(rawValue), &claim); err == nil {
		if claimedAt := positiveInt64FromRaw(claim.ClaimedAt); claimedAt != nil {
			return *claimedAt
		}
	}
	return nowMillis()
}

func farmDailyPurchasePlanKey(userID int64, date string, itemKey string) string {
	return fmt.Sprintf("%d:%s:%s", userID, date, itemKey)
}

func farmMaturityEmailPlanKey(userID int64, eventID string) string {
	return fmt.Sprintf("%d:%s", userID, eventID)
}

func farmWaterEmailPlanKey(record FarmWaterEmailImportRecord) string {
	return fmt.Sprintf(
		"%d:%d:%d:%d:%d",
		record.UserID,
		record.LandIndex,
		record.PlantedAtMs,
		record.NextWaterDueAtMs,
		record.WaterMissCount,
	)
}
