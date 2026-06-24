package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"redemption/backend/internal/profile"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	userAchievementsKeyPrefix      = "user:achievements:"
	userEquippedAchievementPrefix  = "user:achievement:equipped:"
	userForcedAchievementKeyPrefix = "user:achievement:forced:"
)

type UserAchievementsImportPlan struct {
	Users    []UserImportRecord
	Grants   []AchievementGrantImportRecord
	Equipped []EquippedAchievementImportRecord
	Forced   []ForcedAchievementImportRecord
	Warnings []string
}

type UserAchievementsImportResult struct {
	UsersUpserted    int
	GrantsUpserted   int
	EquippedUpserted int
	ForcedUpserted   int
	Warnings         []string
}

type AchievementGrantImportRecord struct {
	UserID            int64
	AchievementID     string
	Source            string
	GrantedAtMs       int64
	ExpiresAtMs       *int64
	Reason            *string
	GrantedByUserID   *int64
	GrantedByUsername *string
	MetadataJSON      string
}

type EquippedAchievementImportRecord struct {
	UserID        int64
	AchievementID string
	UpdatedAtMs   int64
}

type ForcedAchievementImportRecord struct {
	UserID        int64
	AchievementID string
	UntilMs       int64
	UpdatedAtMs   int64
}

type rawLegacyAchievementGrant struct {
	ID        json.RawMessage `json:"id"`
	Source    string          `json:"source"`
	GrantedAt json.RawMessage `json:"grantedAt"`
	ExpiresAt json.RawMessage `json:"expiresAt"`
	Reason    json.RawMessage `json:"reason"`
	GrantedBy json.RawMessage `json:"grantedBy"`
	Metadata  json.RawMessage `json:"metadata"`
}

type rawLegacyAchievementGrantor struct {
	ID       json.RawMessage `json:"id"`
	Username string          `json:"username"`
}

type rawLegacyForcedAchievement struct {
	ID    json.RawMessage `json:"id"`
	Until json.RawMessage `json:"until"`
}

func PlanUserAchievementsImport(reader io.Reader) (UserAchievementsImportPlan, error) {
	plan := UserAchievementsImportPlan{}
	users := map[int64]UserImportRecord{}
	grants := map[string]AchievementGrantImportRecord{}
	equipped := map[int64]EquippedAchievementImportRecord{}
	forced := map[int64]ForcedAchievementImportRecord{}

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
		case matchKeyPattern(key, userAchievementsKeyPrefix+"*"):
			_, records, warnings, ok := parseLegacyAchievementGrants(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				for _, record := range records {
					grants[achievementGrantKey(record.UserID, record.AchievementID)] = record
					ensurePlanUser(users, record.UserID, millisToTime(record.GrantedAtMs))
				}
			}
		case matchKeyPattern(key, userEquippedAchievementPrefix+"*"):
			record, warnings, ok := parseLegacyEquippedAchievement(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				equipped[record.UserID] = record
				ensurePlanUser(users, record.UserID, millisToTime(record.UpdatedAtMs))
			}
		case matchKeyPattern(key, userForcedAchievementKeyPrefix+"*"):
			record, warnings, ok := parseLegacyForcedAchievement(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				forced[record.UserID] = record
				ensurePlanUser(users, record.UserID, millisToTime(record.UpdatedAtMs))
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, grant := range grants {
		plan.Grants = append(plan.Grants, grant)
	}
	for _, record := range equipped {
		plan.Equipped = append(plan.Equipped, record)
	}
	for _, record := range forced {
		plan.Forced = append(plan.Forced, record)
	}
	return plan, nil
}

func ApplyUserAchievementsImport(ctx context.Context, db *pgxpool.Pool, plan UserAchievementsImportPlan) (UserAchievementsImportResult, error) {
	result := UserAchievementsImportResult{Warnings: plan.Warnings}
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

	for _, grant := range plan.Grants {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_achievement_grants (
			   user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason,
			   granted_by_user_id, granted_by_username, metadata, updated_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now()
			 )
			 ON CONFLICT (user_id, achievement_id) DO UPDATE SET
			   source = excluded.source,
			   granted_at_ms = LEAST(user_achievement_grants.granted_at_ms, excluded.granted_at_ms),
			   expires_at_ms = excluded.expires_at_ms,
			   reason = excluded.reason,
			   granted_by_user_id = excluded.granted_by_user_id,
			   granted_by_username = excluded.granted_by_username,
			   metadata = excluded.metadata,
			   updated_at = now()`,
			grant.UserID,
			grant.AchievementID,
			grant.Source,
			grant.GrantedAtMs,
			nullableInt64Ptr(grant.ExpiresAtMs),
			nullableStringPtr(grant.Reason),
			nullableInt64Ptr(grant.GrantedByUserID),
			nullableStringPtr(grant.GrantedByUsername),
			grant.MetadataJSON,
		); err != nil {
			return result, fmt.Errorf("upsert achievement grant %d/%s failed: %w", grant.UserID, grant.AchievementID, err)
		}
		result.GrantsUpserted++
	}

	for _, record := range plan.Equipped {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms, updated_at)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (user_id) DO UPDATE SET
			   achievement_id = excluded.achievement_id,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = excluded.updated_at`,
			record.UserID,
			record.AchievementID,
			record.UpdatedAtMs,
			millisToTime(record.UpdatedAtMs),
		); err != nil {
			return result, fmt.Errorf("upsert equipped achievement %d failed: %w", record.UserID, err)
		}
		result.EquippedUpserted++
	}

	for _, record := range plan.Forced {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms, updated_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (user_id) DO UPDATE SET
			   achievement_id = excluded.achievement_id,
			   until_ms = excluded.until_ms,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = excluded.updated_at`,
			record.UserID,
			record.AchievementID,
			record.UntilMs,
			record.UpdatedAtMs,
			millisToTime(record.UpdatedAtMs),
		); err != nil {
			return result, fmt.Errorf("upsert forced achievement %d failed: %w", record.UserID, err)
		}
		result.ForcedUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseLegacyAchievementGrants(key string, rawValue string) (int64, []AchievementGrantImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, userAchievementsKeyPrefix)
	if userID <= 0 {
		return 0, nil, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	rawItems, err := achievementGrantRawItems(rawValue)
	if err != nil {
		return 0, nil, []string{fmt.Sprintf("跳过 %s：成就授予 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	records := make([]AchievementGrantImportRecord, 0, len(rawItems))
	for _, rawItem := range rawItems {
		record, itemWarnings, ok := parseLegacyAchievementGrantItem(key, userID, rawItem)
		warnings = append(warnings, itemWarnings...)
		if ok {
			records = append(records, record)
		}
	}
	return userID, records, warnings, true
}

func achievementGrantRawItems(rawValue string) ([]json.RawMessage, error) {
	var asArray []json.RawMessage
	if err := decodeJSONObject(rawValue, &asArray); err == nil {
		return asArray, nil
	}
	var asObject map[string]json.RawMessage
	if err := decodeJSONObject(rawValue, &asObject); err != nil {
		return nil, err
	}
	items := make([]json.RawMessage, 0, len(asObject))
	for _, raw := range asObject {
		items = append(items, raw)
	}
	return items, nil
}

func parseLegacyAchievementGrantItem(sourceKey string, userID int64, rawItem json.RawMessage) (AchievementGrantImportRecord, []string, bool) {
	var raw rawLegacyAchievementGrant
	if err := json.Unmarshal(rawItem, &raw); err != nil {
		return AchievementGrantImportRecord{}, []string{fmt.Sprintf("跳过 %s 的一条成就授予：JSON 解析失败：%v", sourceKey, err)}, false
	}
	achievementID := stringFromRaw(raw.ID, "")
	if !profile.IsAchievementID(achievementID) {
		return AchievementGrantImportRecord{}, []string{fmt.Sprintf("跳过 %s 的一条成就授予：未知成就 %q", sourceKey, achievementID)}, false
	}
	source := normalizedAchievementSource(raw.Source)
	grantedAt := int64FromRaw(raw.GrantedAt, nowMillis())
	if grantedAt <= 0 {
		grantedAt = nowMillis()
	}
	expiresAt := positiveInt64FromRaw(raw.ExpiresAt)
	reason := optionalRawString(raw.Reason)
	grantedByUserID, grantedByUsername := parseLegacyAchievementGrantor(raw.GrantedBy)
	metadata := normalizedJSONObject(raw.Metadata)

	return AchievementGrantImportRecord{
		UserID:            userID,
		AchievementID:     achievementID,
		Source:            source,
		GrantedAtMs:       grantedAt,
		ExpiresAtMs:       expiresAt,
		Reason:            reason,
		GrantedByUserID:   grantedByUserID,
		GrantedByUsername: grantedByUsername,
		MetadataJSON:      string(metadata),
	}, nil, true
}

func parseLegacyEquippedAchievement(key string, rawValue string) (EquippedAchievementImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, userEquippedAchievementPrefix)
	if userID <= 0 {
		return EquippedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	achievementID := parseLegacyAchievementIDValue(rawValue)
	if !profile.IsAchievementID(achievementID) {
		return EquippedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：未知成就 %q", key, achievementID)}, false
	}
	return EquippedAchievementImportRecord{
		UserID:        userID,
		AchievementID: achievementID,
		UpdatedAtMs:   nowMillis(),
	}, nil, true
}

func parseLegacyForcedAchievement(key string, rawValue string) (ForcedAchievementImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, userForcedAchievementKeyPrefix)
	if userID <= 0 {
		return ForcedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	var raw rawLegacyForcedAchievement
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return ForcedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：强制佩戴 JSON 解析失败：%v", key, err)}, false
	}
	achievementID := stringFromRaw(raw.ID, "")
	if !profile.IsAchievementID(achievementID) {
		return ForcedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：未知强制佩戴成就 %q", key, achievementID)}, false
	}
	until := int64FromRaw(raw.Until, 0)
	if until <= 0 {
		return ForcedAchievementImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效 until", key)}, false
	}
	return ForcedAchievementImportRecord{
		UserID:        userID,
		AchievementID: achievementID,
		UntilMs:       until,
		UpdatedAtMs:   nowMillis(),
	}, nil, true
}

func parseLegacyAchievementIDValue(rawValue string) string {
	var asString string
	if err := decodeJSONObject(rawValue, &asString); err == nil {
		return strings.TrimSpace(asString)
	}
	return strings.Trim(strings.TrimSpace(rawValue), `"`)
}

func normalizedAchievementSource(source string) string {
	switch source {
	case "admin", "ranking_monthly", "auto":
		return source
	default:
		return "auto"
	}
}

func parseLegacyAchievementGrantor(raw json.RawMessage) (*int64, *string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var grantor rawLegacyAchievementGrantor
	if err := json.Unmarshal(raw, &grantor); err != nil {
		return nil, nil
	}
	id := positiveInt64FromRaw(grantor.ID)
	username := optionalString(grantor.Username)
	return id, username
}

func optionalRawString(raw json.RawMessage) *string {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	return optionalString(value)
}

func normalizedJSONObject(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage("{}")
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return json.RawMessage("{}")
	}
	return raw
}

func achievementGrantKey(userID int64, achievementID string) string {
	return fmt.Sprintf("%d:%s", userID, achievementID)
}
