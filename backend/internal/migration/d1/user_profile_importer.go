package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	customProfileKeyPrefix = "user:profile:custom:"
	maxDisplayNameRunes    = 30
	maxAvatarURLLength     = 80 * 1024
	maxQQEmailLength       = 254
)

var (
	avatarDataURLPattern = regexp.MustCompile(`(?i)^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$`)
	qqEmailPattern       = regexp.MustCompile(`^[1-9][0-9]{4,11}@qq\.com$`)
)

type UserProfilesImportPlan struct {
	Users    []UserImportRecord
	Profiles []UserProfileImportRecord
	Warnings []string
}

type UserProfilesImportResult struct {
	UsersUpserted    int
	ProfilesUpserted int
	Warnings         []string
}

type UserProfileImportRecord struct {
	UserID      int64
	DisplayName *string
	AvatarURL   *string
	QQEmail     *string
	UpdatedAtMs *int64
	UpdatedAt   time.Time
}

type rawCustomUserProfile struct {
	DisplayName json.RawMessage `json:"displayName"`
	AvatarURL   json.RawMessage `json:"avatarUrl"`
	QQEmail     json.RawMessage `json:"qqEmail"`
	UpdatedAt   json.RawMessage `json:"updatedAt"`
}

func PlanUserProfilesImport(reader io.Reader) (UserProfilesImportPlan, error) {
	plan := UserProfilesImportPlan{}
	users := map[int64]UserImportRecord{}

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
		if !ok || !matchKeyPattern(key, customProfileKeyPrefix+"*") {
			continue
		}
		value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
		if !ok {
			continue
		}

		record, warnings, ok := parseLegacyCustomUserProfile(key, value)
		plan.Warnings = append(plan.Warnings, warnings...)
		if !ok {
			continue
		}
		plan.Profiles = append(plan.Profiles, record)
		ensurePlanUser(users, record.UserID, record.UpdatedAt)
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	return plan, nil
}

func ApplyUserProfilesImport(ctx context.Context, db *pgxpool.Pool, plan UserProfilesImportPlan) (UserProfilesImportResult, error) {
	result := UserProfilesImportResult{Warnings: plan.Warnings}
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

	for _, profile := range plan.Profiles {
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_profiles (user_id, display_name, avatar_url, qq_email, updated_at_ms, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 ON CONFLICT (user_id) DO UPDATE SET
			   display_name = excluded.display_name,
			   avatar_url = excluded.avatar_url,
			   qq_email = excluded.qq_email,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = excluded.updated_at`,
			profile.UserID,
			nullableStringPtr(profile.DisplayName),
			nullableStringPtr(profile.AvatarURL),
			nullableStringPtr(profile.QQEmail),
			nullableInt64Ptr(profile.UpdatedAtMs),
			profile.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert user profile %d failed: %w", profile.UserID, err)
		}
		result.ProfilesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseLegacyCustomUserProfile(key string, rawValue string) (UserProfileImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, customProfileKeyPrefix)
	if userID <= 0 {
		return UserProfileImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	var raw rawCustomUserProfile
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return UserProfileImportRecord{}, []string{fmt.Sprintf("跳过 %s：用户资料 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	displayName, warning := validateImportedDisplayName(raw.DisplayName)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 displayName 无效：%s", key, warning))
	}
	avatarURL, warning := validateImportedAvatarURL(raw.AvatarURL)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 avatarUrl 无效：%s", key, warning))
	}
	qqEmail, warning := validateImportedQQEmail(raw.QQEmail)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 qqEmail 无效：%s", key, warning))
	}

	updatedAtMs, warning := parseImportedUpdatedAt(raw.UpdatedAt)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 updatedAt 无效：%s", key, warning))
	}
	updatedAt := time.Now().UTC()
	if updatedAtMs != nil {
		updatedAt = millisToTime(*updatedAtMs)
	}

	if displayName == nil && avatarURL == nil && qqEmail == nil && updatedAtMs == nil {
		if len(warnings) == 0 {
			warnings = append(warnings, fmt.Sprintf("跳过 %s：用户资料为空", key))
		}
		return UserProfileImportRecord{}, warnings, false
	}

	return UserProfileImportRecord{
		UserID:      userID,
		DisplayName: displayName,
		AvatarURL:   avatarURL,
		QQEmail:     qqEmail,
		UpdatedAtMs: updatedAtMs,
		UpdatedAt:   updatedAt,
	}, warnings, true
}

func validateImportedDisplayName(raw json.RawMessage) (*string, string) {
	value, ok, warning := optionalStringFromRaw(raw)
	if warning != "" || !ok || value == nil {
		return nil, warning
	}
	if utf16CodeUnitLength(*value) > maxDisplayNameRunes {
		return nil, "昵称长度超过 30 个字符"
	}
	if hasASCIIControlChar(*value) {
		return nil, "昵称包含控制字符"
	}
	return value, ""
}

func validateImportedAvatarURL(raw json.RawMessage) (*string, string) {
	value, ok, warning := optionalStringFromRaw(raw)
	if warning != "" || !ok || value == nil {
		return nil, warning
	}
	if len(*value) > maxAvatarURLLength {
		return nil, "头像数据超过 80KB"
	}
	if strings.HasPrefix(*value, "data:") {
		if !avatarDataURLPattern.MatchString(*value) {
			return nil, "data URL 图片格式不被支持"
		}
		return value, ""
	}

	parsed, err := url.Parse(*value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, "头像链接格式无效"
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, "头像链接必须是 http 或 https"
	}
	return value, ""
}

func validateImportedQQEmail(raw json.RawMessage) (*string, string) {
	value, ok, warning := optionalStringFromRaw(raw)
	if warning != "" || !ok || value == nil {
		return nil, warning
	}
	normalized := strings.ToLower(*value)
	if len(normalized) > maxQQEmailLength {
		return nil, "QQ 邮箱长度超过 254"
	}
	if hasASCIIControlChar(normalized) {
		return nil, "QQ 邮箱包含控制字符"
	}
	if !qqEmailPattern.MatchString(normalized) {
		return nil, "QQ 邮箱格式无效"
	}
	return &normalized, ""
}

func optionalStringFromRaw(raw json.RawMessage) (*string, bool, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false, ""
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, true, "字段不是字符串"
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, true, ""
	}
	return &value, true, ""
}

func parseImportedUpdatedAt(raw json.RawMessage) (*int64, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, ""
	}
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return nil, "时间戳必须是正数"
	}
	return &value, ""
}

func hasASCIIControlChar(value string) bool {
	for _, char := range value {
		if char <= 0x1f || char == 0x7f {
			return true
		}
	}
	return false
}

func utf16CodeUnitLength(value string) int {
	return len(utf16.Encode([]rune(value)))
}
