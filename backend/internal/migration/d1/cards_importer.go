package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	cardUserKeyPrefix   = "cards:user:"
	cardRulesKey        = "cards:rules:config"
	cardAlbumRewardsKey = "cards:album_rewards"
	cardTierRewardsKey  = "cards:tier_rewards"
)

type CardsImportPlan struct {
	Users        []UserImportRecord
	States       []CardUserStateImportRecord
	Rules        []CardRulesImportRecord
	AlbumRewards []CardAlbumRewardImportRecord
	TierRewards  []CardTierRewardImportRecord
	Warnings     []string
}

type CardsImportResult struct {
	UsersUpserted        int
	StatesUpserted       int
	RulesUpserted        int
	AlbumRewardsUpserted int
	TierRewardsUpserted  int
	Warnings             []string
}

type CardUserStateImportRecord struct {
	UserID                int64
	InventoryJSON         string
	Fragments             int64
	PityRare              int64
	PityEpic              int64
	PityLegendary         int64
	PityLegendaryRare     int64
	DrawsAvailable        int64
	CollectionRewardsJSON string
	RecentDrawsJSON       string
	RawStateJSON          string
	ImportedUpdatedAt     time.Time
}

type CardRulesImportRecord struct {
	ID                      string
	RarityProbabilitiesJSON string
	PityThresholdsJSON      string
	CardDrawPrice           int64
	FragmentValuesJSON      string
	ExchangePricesJSON      string
	ConfigJSON              string
	UpdatedAtMs             int64
}

type CardAlbumRewardImportRecord struct {
	AlbumID       string
	RewardPoints  int64
	RawRewardJSON string
	UpdatedAtMs   int64
}

type CardTierRewardImportRecord struct {
	RewardType    string
	RewardPoints  int64
	RawRewardJSON string
	UpdatedAtMs   int64
}

type rawImportedCardUserState struct {
	Inventory         json.RawMessage `json:"inventory"`
	Fragments         json.RawMessage `json:"fragments"`
	PityCounter       json.RawMessage `json:"pityCounter"`
	PityRare          json.RawMessage `json:"pityRare"`
	PityEpic          json.RawMessage `json:"pityEpic"`
	PityLegendary     json.RawMessage `json:"pityLegendary"`
	PityLegendaryRare json.RawMessage `json:"pityLegendaryRare"`
	DrawsAvailable    json.RawMessage `json:"drawsAvailable"`
	CollectionRewards json.RawMessage `json:"collectionRewards"`
	RecentDraws       json.RawMessage `json:"recentDraws"`
}

type rawImportedCardRules struct {
	RarityProbabilities json.RawMessage `json:"rarityProbabilities"`
	PityThresholds      json.RawMessage `json:"pityThresholds"`
	CardDrawPrice       json.RawMessage `json:"cardDrawPrice"`
	FragmentValues      json.RawMessage `json:"fragmentValues"`
	ExchangePrices      json.RawMessage `json:"exchangePrices"`
	UpdatedAt           json.RawMessage `json:"updatedAt"`
}

type importedRecentCardDraw struct {
	CardID         string `json:"cardId"`
	Rarity         string `json:"rarity"`
	IsDuplicate    bool   `json:"isDuplicate"`
	FragmentsAdded int64  `json:"fragmentsAdded"`
	Timestamp      int64  `json:"timestamp"`
}

func PlanCardsImport(reader io.Reader) (CardsImportPlan, error) {
	plan := CardsImportPlan{}
	users := map[int64]UserImportRecord{}
	states := map[int64]CardUserStateImportRecord{}
	rules := map[string]CardRulesImportRecord{}
	albumRewards := map[string]CardAlbumRewardImportRecord{}
	tierRewards := map[string]CardTierRewardImportRecord{}

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
		case "native_user_cards":
			state, warnings, ok := parseNativeCardUserState(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				if existing, exists := states[state.UserID]; exists {
					state = mergeCardUserState(existing, state)
					plan.Warnings = append(plan.Warnings, fmt.Sprintf("用户 %d 同时存在多份卡牌状态，已按旧读穿逻辑合并", state.UserID))
				}
				states[state.UserID] = state
				ensurePlanUser(users, state.UserID, state.ImportedUpdatedAt)
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
			case matchKeyPattern(key, cardUserKeyPrefix+"*"):
				state, warnings, ok := parseLegacyCardUserState(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					if existing, exists := states[state.UserID]; exists {
						state = mergeCardUserState(existing, state)
						plan.Warnings = append(plan.Warnings, fmt.Sprintf("用户 %d 同时存在 native_user_cards 和 legacy cards:user:*，已按旧读穿逻辑合并", state.UserID))
					}
					states[state.UserID] = state
					ensurePlanUser(users, state.UserID, state.ImportedUpdatedAt)
				}
			case key == cardRulesKey:
				record, warnings, ok := parseCardRulesConfig(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					rules[record.ID] = record
				}
			case key == cardAlbumRewardsKey:
				records, warnings := parseCardAlbumRewards(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				for _, record := range records {
					albumRewards[record.AlbumID] = record
				}
			case key == cardTierRewardsKey:
				records, warnings := parseCardTierRewards(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				for _, record := range records {
					tierRewards[record.RewardType] = record
				}
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
	for _, record := range rules {
		plan.Rules = append(plan.Rules, record)
	}
	for _, record := range albumRewards {
		plan.AlbumRewards = append(plan.AlbumRewards, record)
	}
	for _, record := range tierRewards {
		plan.TierRewards = append(plan.TierRewards, record)
	}
	sort.Slice(plan.AlbumRewards, func(i, j int) bool { return plan.AlbumRewards[i].AlbumID < plan.AlbumRewards[j].AlbumID })
	sort.Slice(plan.TierRewards, func(i, j int) bool { return plan.TierRewards[i].RewardType < plan.TierRewards[j].RewardType })
	return plan, nil
}

func ApplyCardsImport(ctx context.Context, db *pgxpool.Pool, plan CardsImportPlan) (CardsImportResult, error) {
	result := CardsImportResult{Warnings: append([]string{}, plan.Warnings...)}
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
			`INSERT INTO card_user_states (
			   user_id, inventory, fragments, pity_rare, pity_epic, pity_legendary,
			   pity_legendary_rare, draws_available, collection_rewards, recent_draws,
			   raw_state, imported_at, updated_at
			 ) VALUES (
			   $1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
			   $11::jsonb, now(), $12
			 )
			 ON CONFLICT (user_id) DO UPDATE SET
			   inventory = excluded.inventory,
			   fragments = excluded.fragments,
			   pity_rare = excluded.pity_rare,
			   pity_epic = excluded.pity_epic,
			   pity_legendary = excluded.pity_legendary,
			   pity_legendary_rare = excluded.pity_legendary_rare,
			   draws_available = excluded.draws_available,
			   collection_rewards = excluded.collection_rewards,
			   recent_draws = excluded.recent_draws,
			   raw_state = excluded.raw_state,
			   imported_at = now(),
			   updated_at = excluded.updated_at`,
			state.UserID,
			state.InventoryJSON,
			state.Fragments,
			state.PityRare,
			state.PityEpic,
			state.PityLegendary,
			state.PityLegendaryRare,
			state.DrawsAvailable,
			state.CollectionRewardsJSON,
			state.RecentDrawsJSON,
			state.RawStateJSON,
			state.ImportedUpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert card user state %d failed: %w", state.UserID, err)
		}
		result.StatesUpserted++
	}

	for _, record := range plan.Rules {
		if _, err := tx.Exec(ctx,
			`INSERT INTO card_rules (
			   id, rarity_probabilities, pity_thresholds, card_draw_price,
			   fragment_values, exchange_prices, config_json, updated_at_ms, imported_at
			 ) VALUES (
			   $1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, now()
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   rarity_probabilities = excluded.rarity_probabilities,
			   pity_thresholds = excluded.pity_thresholds,
			   card_draw_price = excluded.card_draw_price,
			   fragment_values = excluded.fragment_values,
			   exchange_prices = excluded.exchange_prices,
			   config_json = excluded.config_json,
			   updated_at_ms = excluded.updated_at_ms,
			   imported_at = now(),
			   updated_at = now()`,
			record.ID,
			record.RarityProbabilitiesJSON,
			record.PityThresholdsJSON,
			record.CardDrawPrice,
			record.FragmentValuesJSON,
			record.ExchangePricesJSON,
			record.ConfigJSON,
			record.UpdatedAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert card rules %s failed: %w", record.ID, err)
		}
		result.RulesUpserted++
	}

	for _, record := range plan.AlbumRewards {
		if _, err := tx.Exec(ctx,
			`INSERT INTO card_album_rewards (
			   album_id, reward_points, raw_reward, updated_at_ms, imported_at
			 ) VALUES ($1, $2, $3::jsonb, $4, now())
			 ON CONFLICT (album_id) DO UPDATE SET
			   reward_points = excluded.reward_points,
			   raw_reward = excluded.raw_reward,
			   updated_at_ms = excluded.updated_at_ms,
			   imported_at = now(),
			   updated_at = now()`,
			record.AlbumID,
			record.RewardPoints,
			record.RawRewardJSON,
			record.UpdatedAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert card album reward %s failed: %w", record.AlbumID, err)
		}
		result.AlbumRewardsUpserted++
	}

	for _, record := range plan.TierRewards {
		if _, err := tx.Exec(ctx,
			`INSERT INTO card_tier_rewards (
			   reward_type, reward_points, raw_reward, updated_at_ms, imported_at
			 ) VALUES ($1, $2, $3::jsonb, $4, now())
			 ON CONFLICT (reward_type) DO UPDATE SET
			   reward_points = excluded.reward_points,
			   raw_reward = excluded.raw_reward,
			   updated_at_ms = excluded.updated_at_ms,
			   imported_at = now(),
			   updated_at = now()`,
			record.RewardType,
			record.RewardPoints,
			record.RawRewardJSON,
			record.UpdatedAtMs,
		); err != nil {
			return result, fmt.Errorf("upsert card tier reward %s failed: %w", record.RewardType, err)
		}
		result.TierRewardsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseNativeCardUserState(statement insertStatement) (CardUserStateImportRecord, []string, bool) {
	defaults := []string{"user_id", "value_json", "updated_at"}
	userID, ok := int64Value(statement, defaults, "user_id", 0)
	if !ok || userID <= 0 {
		return CardUserStateImportRecord{}, []string{"跳过 native_user_cards：无效 user_id"}, false
	}
	rawValue, ok := valueFor(statement, defaults, "value_json", 1)
	if !ok || strings.TrimSpace(rawValue) == "" {
		return CardUserStateImportRecord{}, []string{fmt.Sprintf("跳过 native_user_cards:%d：缺少 value_json", userID)}, false
	}
	updatedAt, _ := int64Value(statement, defaults, "updated_at", 2)
	return parseCardUserState(fmt.Sprintf("native_user_cards:%d", userID), userID, rawValue, millisToTime(updatedAt))
}

func parseLegacyCardUserState(key string, rawValue string) (CardUserStateImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, cardUserKeyPrefix)
	if userID <= 0 {
		return CardUserStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	return parseCardUserState(key, userID, rawValue, time.Now().UTC())
}

func parseCardUserState(source string, userID int64, rawValue string, updatedAt time.Time) (CardUserStateImportRecord, []string, bool) {
	var raw rawImportedCardUserState
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return CardUserStateImportRecord{}, []string{fmt.Sprintf("跳过 %s：卡牌用户状态 JSON 解析失败：%v", source, err)}, false
	}
	if updatedAt.IsZero() {
		updatedAt = time.Now().UTC()
	}

	var warnings []string
	inventory, warning := normalizeStringArrayJSON(raw.Inventory, "inventory")
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 %s", source, warning))
	}
	collectionRewards, warning := normalizeStringArrayJSON(raw.CollectionRewards, "collectionRewards")
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 %s", source, warning))
	}
	recentDraws, warning := normalizeRecentDrawsJSON(raw.RecentDraws)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 %s", source, warning))
	}

	pityLegendaryRare := nonNegativeRawOr(raw.PityLegendaryRare, nonNegativeRawOr(raw.PityCounter, 0))
	record := CardUserStateImportRecord{
		UserID:                userID,
		InventoryJSON:         string(inventory),
		Fragments:             nonNegativeRawOr(raw.Fragments, 0),
		PityRare:              nonNegativeRawOr(raw.PityRare, 0),
		PityEpic:              nonNegativeRawOr(raw.PityEpic, 0),
		PityLegendary:         nonNegativeRawOr(raw.PityLegendary, 0),
		PityLegendaryRare:     pityLegendaryRare,
		DrawsAvailable:        nonNegativeRawOr(raw.DrawsAvailable, 1),
		CollectionRewardsJSON: string(collectionRewards),
		RecentDrawsJSON:       string(recentDraws),
		ImportedUpdatedAt:     updatedAt,
	}
	record.RawStateJSON = marshalCardStateRaw(record)
	return record, warnings, true
}

func parseCardRulesConfig(key string, rawValue string) (CardRulesImportRecord, []string, bool) {
	var raw rawImportedCardRules
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return CardRulesImportRecord{}, []string{fmt.Sprintf("跳过 %s：卡牌规则 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	rarityProbabilities, warning := normalizeObjectJSONWithDefault(raw.RarityProbabilities, defaultCardRarityProbabilitiesJSON())
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 rarityProbabilities %s", key, warning))
	}
	pityThresholds, warning := normalizeObjectJSONWithDefault(raw.PityThresholds, defaultCardPityThresholdsJSON())
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 pityThresholds %s", key, warning))
	}
	fragmentValues, warning := normalizeObjectJSONWithDefault(raw.FragmentValues, defaultCardFragmentValuesJSON())
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 fragmentValues %s", key, warning))
	}
	exchangePrices, warning := normalizeObjectJSONWithDefault(raw.ExchangePrices, defaultCardExchangePricesJSON())
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 exchangePrices %s", key, warning))
	}
	cardDrawPrice := nonNegativeRawOr(raw.CardDrawPrice, 900)
	if cardDrawPrice <= 0 {
		cardDrawPrice = 900
		warnings = append(warnings, fmt.Sprintf("%s 的 cardDrawPrice 无效，已按默认 900 导入", key))
	}
	updatedAtMs := nonNegativeRawOr(raw.UpdatedAt, 0)

	config := map[string]any{}
	if err := decodeJSONObject(rawValue, &config); err != nil {
		config = map[string]any{}
	}
	config["rarityProbabilities"] = decodeJSONMap(rarityProbabilities)
	config["pityThresholds"] = decodeJSONMap(pityThresholds)
	config["cardDrawPrice"] = cardDrawPrice
	config["fragmentValues"] = decodeJSONMap(fragmentValues)
	config["exchangePrices"] = decodeJSONMap(exchangePrices)
	config["updatedAt"] = updatedAtMs
	configJSON, _ := json.Marshal(config)

	return CardRulesImportRecord{
		ID:                      "default",
		RarityProbabilitiesJSON: string(rarityProbabilities),
		PityThresholdsJSON:      string(pityThresholds),
		CardDrawPrice:           cardDrawPrice,
		FragmentValuesJSON:      string(fragmentValues),
		ExchangePricesJSON:      string(exchangePrices),
		ConfigJSON:              string(configJSON),
		UpdatedAtMs:             updatedAtMs,
	}, warnings, true
}

func parseCardAlbumRewards(key string, rawValue string) ([]CardAlbumRewardImportRecord, []string) {
	var rewards map[string]json.RawMessage
	if err := decodeJSONObject(rawValue, &rewards); err != nil {
		return nil, []string{fmt.Sprintf("跳过 %s：卡册奖励 JSON 解析失败：%v", key, err)}
	}

	records := make([]CardAlbumRewardImportRecord, 0, len(rewards))
	var warnings []string
	for albumID, rawReward := range rewards {
		albumID = strings.TrimSpace(albumID)
		points, ok := numberFromRaw(rawReward)
		if albumID == "" {
			warnings = append(warnings, fmt.Sprintf("跳过 %s：卡册 ID 为空", key))
			continue
		}
		if !ok || points < 0 {
			warnings = append(warnings, fmt.Sprintf("跳过 %s:%s：奖励值无效", key, albumID))
			continue
		}
		rawJSON, _ := json.Marshal(map[string]any{"reward": points})
		records = append(records, CardAlbumRewardImportRecord{
			AlbumID:       albumID,
			RewardPoints:  points,
			RawRewardJSON: string(rawJSON),
			UpdatedAtMs:   0,
		})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].AlbumID < records[j].AlbumID })
	return records, warnings
}

func parseCardTierRewards(key string, rawValue string) ([]CardTierRewardImportRecord, []string) {
	var rewards map[string]json.RawMessage
	if err := decodeJSONObject(rawValue, &rewards); err != nil {
		return nil, []string{fmt.Sprintf("跳过 %s：稀有度奖励 JSON 解析失败：%v", key, err)}
	}

	records := make([]CardTierRewardImportRecord, 0, len(rewards))
	var warnings []string
	for rewardType, rawReward := range rewards {
		rewardType = strings.TrimSpace(rewardType)
		points, ok := numberFromRaw(rawReward)
		if !isImportedRewardType(rewardType) {
			warnings = append(warnings, fmt.Sprintf("跳过 %s:%s：奖励类型无效", key, rewardType))
			continue
		}
		if !ok || points < 0 {
			warnings = append(warnings, fmt.Sprintf("跳过 %s:%s：奖励值无效", key, rewardType))
			continue
		}
		rawJSON, _ := json.Marshal(map[string]any{"reward": points})
		records = append(records, CardTierRewardImportRecord{
			RewardType:    rewardType,
			RewardPoints:  points,
			RawRewardJSON: string(rawJSON),
			UpdatedAtMs:   0,
		})
	}
	sort.Slice(records, func(i, j int) bool { return records[i].RewardType < records[j].RewardType })
	return records, warnings
}

func mergeCardUserState(left CardUserStateImportRecord, right CardUserStateImportRecord) CardUserStateImportRecord {
	merged := CardUserStateImportRecord{
		UserID:                left.UserID,
		InventoryJSON:         mergeStringArrayJSON(left.InventoryJSON, right.InventoryJSON),
		Fragments:             maxCardInt64(left.Fragments, right.Fragments),
		PityRare:              maxCardInt64(left.PityRare, right.PityRare),
		PityEpic:              maxCardInt64(left.PityEpic, right.PityEpic),
		PityLegendary:         maxCardInt64(left.PityLegendary, right.PityLegendary),
		PityLegendaryRare:     maxCardInt64(left.PityLegendaryRare, right.PityLegendaryRare),
		DrawsAvailable:        maxCardInt64(left.DrawsAvailable, right.DrawsAvailable),
		CollectionRewardsJSON: mergeStringArrayJSON(left.CollectionRewardsJSON, right.CollectionRewardsJSON),
		RecentDrawsJSON:       mergeRecentDrawsJSON(left.RecentDrawsJSON, right.RecentDrawsJSON),
		ImportedUpdatedAt:     laterTime(left.ImportedUpdatedAt, right.ImportedUpdatedAt),
	}
	merged.RawStateJSON = marshalCardStateRaw(merged)
	return merged
}

func normalizeStringArrayJSON(raw json.RawMessage, field string) (json.RawMessage, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("[]"), ""
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return json.RawMessage("[]"), fmt.Sprintf("%s 不是字符串数组，已使用空数组", field)
	}
	values = uniqueSortedStrings(values)
	normalized, _ := json.Marshal(values)
	return normalized, ""
}

func normalizeRecentDrawsJSON(raw json.RawMessage) (json.RawMessage, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("[]"), ""
	}
	var draws []importedRecentCardDraw
	if err := json.Unmarshal(raw, &draws); err != nil {
		return json.RawMessage("[]"), "recentDraws 不是合法数组，已使用空数组"
	}
	draws = normalizeRecentDraws(draws)
	normalized, _ := json.Marshal(draws)
	return normalized, ""
}

func normalizeRecentDraws(draws []importedRecentCardDraw) []importedRecentCardDraw {
	result := make([]importedRecentCardDraw, 0, len(draws))
	for _, draw := range draws {
		draw.CardID = strings.TrimSpace(draw.CardID)
		draw.Rarity = strings.TrimSpace(draw.Rarity)
		if draw.CardID == "" || !isImportedCardRarity(draw.Rarity) || draw.Timestamp <= 0 {
			continue
		}
		if draw.FragmentsAdded < 0 {
			draw.FragmentsAdded = 0
		}
		result = append(result, draw)
	}
	sort.SliceStable(result, func(i, j int) bool {
		return result[i].Timestamp > result[j].Timestamp
	})
	if len(result) > 10 {
		result = result[:10]
	}
	return result
}

func normalizeObjectJSONWithDefault(raw json.RawMessage, fallback json.RawMessage) (json.RawMessage, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, "缺失，已使用默认值"
	}
	if !json.Valid(raw) {
		return fallback, "不是合法 JSON，已使用默认值"
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return fallback, "不是对象，已使用默认值"
	}
	normalized, err := json.Marshal(object)
	if err != nil {
		return fallback, "序列化失败，已使用默认值"
	}
	return normalized, ""
}

func mergeStringArrayJSON(left string, right string) string {
	var leftValues []string
	var rightValues []string
	_ = json.Unmarshal([]byte(left), &leftValues)
	_ = json.Unmarshal([]byte(right), &rightValues)
	merged, _ := json.Marshal(uniqueSortedStrings(append(leftValues, rightValues...)))
	return string(merged)
}

func mergeRecentDrawsJSON(left string, right string) string {
	var leftValues []importedRecentCardDraw
	var rightValues []importedRecentCardDraw
	_ = json.Unmarshal([]byte(left), &leftValues)
	_ = json.Unmarshal([]byte(right), &rightValues)
	merged, _ := json.Marshal(normalizeRecentDraws(append(leftValues, rightValues...)))
	return string(merged)
}

func marshalCardStateRaw(record CardUserStateImportRecord) string {
	payload := map[string]any{
		"inventory":         decodeJSONStringArray(record.InventoryJSON),
		"fragments":         record.Fragments,
		"pityCounter":       record.PityLegendaryRare,
		"pityRare":          record.PityRare,
		"pityEpic":          record.PityEpic,
		"pityLegendary":     record.PityLegendary,
		"pityLegendaryRare": record.PityLegendaryRare,
		"drawsAvailable":    record.DrawsAvailable,
		"collectionRewards": decodeJSONStringArray(record.CollectionRewardsJSON),
		"recentDraws":       decodeJSONRecentDraws(record.RecentDrawsJSON),
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func decodeJSONStringArray(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil
	}
	return values
}

func decodeJSONRecentDraws(raw string) []importedRecentCardDraw {
	var values []importedRecentCardDraw
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil
	}
	return values
}

func decodeJSONMap(raw json.RawMessage) map[string]any {
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{}
	}
	return value
}

func uniqueSortedStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func nonNegativeRawOr(raw json.RawMessage, fallback int64) int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value < 0 {
		return fallback
	}
	return value
}

func maxCardInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func isImportedCardRarity(value string) bool {
	switch value {
	case "common", "rare", "epic", "legendary", "legendary_rare":
		return true
	default:
		return false
	}
}

func isImportedRewardType(value string) bool {
	if value == "full_set" {
		return true
	}
	return isImportedCardRarity(value)
}

func defaultCardRarityProbabilitiesJSON() json.RawMessage {
	return json.RawMessage(`{"common":65.5,"rare":25,"epic":7,"legendary":2,"legendary_rare":0.5}`)
}

func defaultCardPityThresholdsJSON() json.RawMessage {
	return json.RawMessage(`{"rare":10,"epic":50,"legendary":100,"legendary_rare":200}`)
}

func defaultCardFragmentValuesJSON() json.RawMessage {
	return json.RawMessage(`{"common":9,"rare":14,"epic":26,"legendary":50,"legendary_rare":100}`)
}

func defaultCardExchangePricesJSON() json.RawMessage {
	return json.RawMessage(`{"common":30,"rare":80,"epic":200,"legendary":500,"legendary_rare":1000}`)
}
