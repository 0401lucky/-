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

type UserAssetsImportPlan struct {
	Users    []UserImportRecord
	Assets   []UserAssetImportRecord
	Warnings []string
}

type UserAssetsImportResult struct {
	UsersUpserted  int
	AssetsUpserted int
	Warnings       []string
}

type UserAssetImportRecord struct {
	UserID      int64
	ExtraSpins  int64
	CardDraws   int64
	MakeupCards int64
	UpdatedAt   time.Time
}

type assetValue struct {
	Value     int64
	UpdatedAt time.Time
}

type rawUserCardsAsset struct {
	DrawsAvailable json.RawMessage `json:"drawsAvailable"`
}

func PlanUserAssetsImport(reader io.Reader) (UserAssetsImportPlan, error) {
	plan := UserAssetsImportPlan{}
	users := map[int64]UserImportRecord{}
	nativeExtraSpins := map[int64]assetValue{}
	legacyExtraSpins := map[int64]assetValue{}
	nativeCardDraws := map[int64]assetValue{}
	legacyCardDraws := map[int64]assetValue{}
	legacyMakeupCards := map[int64]assetValue{}

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
		case "native_user_assets":
			entry, warnings, ok := parseNativeUserAsset(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				nativeExtraSpins[entry.UserID] = assetValue{Value: entry.ExtraSpins, UpdatedAt: entry.UpdatedAt}
				ensurePlanUser(users, entry.UserID, entry.UpdatedAt)
			}
		case "native_user_cards":
			userID, value, warnings, ok := parseNativeUserCardDraws(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				nativeCardDraws[userID] = value
				ensurePlanUser(users, userID, value.UpdatedAt)
			}
		case "kv_data":
			key, ok := kvKey(statement)
			if !ok {
				continue
			}
			value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
			if !ok {
				continue
			}

			switch {
			case matchKeyPattern(key, "user:extra_spins:*"):
				userID, entry, warnings, ok := parseLegacyAssetCounter(key, "user:extra_spins:", value, "额外抽奖次数")
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					legacyExtraSpins[userID] = entry
					ensurePlanUser(users, userID, entry.UpdatedAt)
				}
			case matchKeyPattern(key, "user:makeup_cards:*"):
				userID, entry, warnings, ok := parseLegacyAssetCounter(key, "user:makeup_cards:", value, "补签卡数量")
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					legacyMakeupCards[userID] = entry
					ensurePlanUser(users, userID, entry.UpdatedAt)
				}
			case matchKeyPattern(key, "cards:user:*"):
				userID, entry, warnings, ok := parseLegacyCardDraws(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					legacyCardDraws[userID] = entry
					ensurePlanUser(users, userID, entry.UpdatedAt)
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	if len(nativeExtraSpins) > 0 && len(legacyExtraSpins) > 0 {
		plan.Warnings = append(plan.Warnings, "同时检测到 native_user_assets 和 legacy user:extra_spins:*；同一用户 extra_spins 将优先使用 native")
	}
	if len(nativeCardDraws) > 0 && len(legacyCardDraws) > 0 {
		plan.Warnings = append(plan.Warnings, "同时检测到 native_user_cards 和 legacy cards:user:*；同一用户 card_draws 将优先使用 native")
	}

	userIDs := map[int64]struct{}{}
	addAssetUserIDs(userIDs, nativeExtraSpins)
	addAssetUserIDs(userIDs, legacyExtraSpins)
	addAssetUserIDs(userIDs, nativeCardDraws)
	addAssetUserIDs(userIDs, legacyCardDraws)
	addAssetUserIDs(userIDs, legacyMakeupCards)

	for userID := range userIDs {
		record := UserAssetImportRecord{UserID: userID}
		if value, ok := legacyExtraSpins[userID]; ok {
			record.ExtraSpins = value.Value
			record.UpdatedAt = laterTime(record.UpdatedAt, value.UpdatedAt)
		}
		if value, ok := nativeExtraSpins[userID]; ok {
			record.ExtraSpins = value.Value
			record.UpdatedAt = laterTime(record.UpdatedAt, value.UpdatedAt)
		}
		if value, ok := legacyCardDraws[userID]; ok {
			record.CardDraws = value.Value
			record.UpdatedAt = laterTime(record.UpdatedAt, value.UpdatedAt)
		}
		if value, ok := nativeCardDraws[userID]; ok {
			record.CardDraws = value.Value
			record.UpdatedAt = laterTime(record.UpdatedAt, value.UpdatedAt)
		}
		if value, ok := legacyMakeupCards[userID]; ok {
			record.MakeupCards = value.Value
			record.UpdatedAt = laterTime(record.UpdatedAt, value.UpdatedAt)
		}
		if record.UpdatedAt.IsZero() {
			record.UpdatedAt = time.Now().UTC()
		}
		plan.Assets = append(plan.Assets, record)
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	return plan, nil
}

func ApplyUserAssetsImport(ctx context.Context, db *pgxpool.Pool, plan UserAssetsImportPlan) (UserAssetsImportResult, error) {
	result := UserAssetsImportResult{Warnings: plan.Warnings}
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

	for _, asset := range plan.Assets {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_assets (user_id, extra_spins, card_draws, makeup_cards, updated_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id) DO UPDATE SET
			   extra_spins = excluded.extra_spins,
			   card_draws = excluded.card_draws,
			   makeup_cards = excluded.makeup_cards,
			   updated_at = excluded.updated_at`,
			asset.UserID,
			asset.ExtraSpins,
			asset.CardDraws,
			asset.MakeupCards,
			asset.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert user assets %d failed: %w", asset.UserID, err)
		}
		result.AssetsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseNativeUserAsset(statement insertStatement) (UserAssetImportRecord, []string, bool) {
	defaults := []string{"user_id", "extra_spins", "updated_at"}
	userID, ok := int64Value(statement, defaults, "user_id", 0)
	if !ok || userID <= 0 {
		return UserAssetImportRecord{}, []string{"跳过 native_user_assets：无效 user_id"}, false
	}
	extraSpins, ok := int64Value(statement, defaults, "extra_spins", 1)
	if !ok || extraSpins < 0 {
		return UserAssetImportRecord{}, []string{fmt.Sprintf("跳过 native_user_assets:%d：extra_spins 不能为负数", userID)}, false
	}
	updatedAt, _ := int64Value(statement, defaults, "updated_at", 2)
	return UserAssetImportRecord{
		UserID:     userID,
		ExtraSpins: extraSpins,
		UpdatedAt:  millisToTime(updatedAt),
	}, nil, true
}

func parseNativeUserCardDraws(statement insertStatement) (int64, assetValue, []string, bool) {
	defaults := []string{"user_id", "value_json", "updated_at"}
	userID, ok := int64Value(statement, defaults, "user_id", 0)
	if !ok || userID <= 0 {
		return 0, assetValue{}, []string{"跳过 native_user_cards：无效 user_id"}, false
	}
	rawValue, ok := valueFor(statement, defaults, "value_json", 1)
	if !ok || strings.TrimSpace(rawValue) == "" {
		return 0, assetValue{}, []string{fmt.Sprintf("跳过 native_user_cards:%d：缺少 value_json", userID)}, false
	}
	draws, warnings, ok := parseCardDrawsAvailable(fmt.Sprintf("native_user_cards:%d", userID), rawValue)
	if !ok {
		return 0, assetValue{}, warnings, false
	}
	updatedAt, _ := int64Value(statement, defaults, "updated_at", 2)
	return userID, assetValue{Value: draws, UpdatedAt: millisToTime(updatedAt)}, warnings, true
}

func parseLegacyAssetCounter(key string, prefix string, rawValue string, label string) (int64, assetValue, []string, bool) {
	userID := userIDFromPrefixedKey(key, prefix)
	if userID <= 0 {
		return 0, assetValue{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	value, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return 0, assetValue{}, []string{fmt.Sprintf("跳过 %s：%s解析失败：%v", key, label, err)}, false
	}
	if value < 0 {
		return 0, assetValue{}, []string{fmt.Sprintf("跳过 %s：%s不能为负数", key, label)}, false
	}
	return userID, assetValue{Value: value, UpdatedAt: time.Now().UTC()}, nil, true
}

func parseLegacyCardDraws(key string, rawValue string) (int64, assetValue, []string, bool) {
	userID := userIDFromPrefixedKey(key, "cards:user:")
	if userID <= 0 {
		return 0, assetValue{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	draws, warnings, ok := parseCardDrawsAvailable(key, rawValue)
	if !ok {
		return 0, assetValue{}, warnings, false
	}
	return userID, assetValue{Value: draws, UpdatedAt: time.Now().UTC()}, warnings, true
}

func parseCardDrawsAvailable(source string, rawValue string) (int64, []string, bool) {
	var raw rawUserCardsAsset
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return 0, []string{fmt.Sprintf("跳过 %s：卡牌用户状态 JSON 解析失败：%v", source, err)}, false
	}
	if len(raw.DrawsAvailable) == 0 || string(raw.DrawsAvailable) == "null" {
		return 1, nil, true
	}
	draws, ok := numberFromRaw(raw.DrawsAvailable)
	if !ok {
		return 1, []string{fmt.Sprintf("%s 的 drawsAvailable 无法解析，按旧逻辑默认导入 1", source)}, true
	}
	if draws < 0 {
		return 0, []string{fmt.Sprintf("%s 的 drawsAvailable 为负数，按旧逻辑归零", source)}, true
	}
	return draws, nil, true
}

func addAssetUserIDs(target map[int64]struct{}, values map[int64]assetValue) {
	for userID := range values {
		target[userID] = struct{}{}
	}
}

func laterTime(left time.Time, right time.Time) time.Time {
	if left.IsZero() {
		return right
	}
	if right.IsZero() || left.After(right) {
		return left
	}
	return right
}
