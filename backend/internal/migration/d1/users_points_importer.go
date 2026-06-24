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

type UsersPointsImportPlan struct {
	Users         []UserImportRecord
	PointAccounts []PointAccountImportRecord
	Warnings      []string
}

type UsersPointsImportResult struct {
	UsersUpserted         int
	PointAccountsUpserted int
	Warnings              []string
}

type UserImportRecord struct {
	ID          int64
	Username    string
	DisplayName string
	FirstSeenAt time.Time
	UpdatedAt   time.Time
}

type PointAccountImportRecord struct {
	UserID    int64
	Balance   int64
	UpdatedAt time.Time
	Source    string
}

type rawLegacyUser struct {
	ID        json.RawMessage `json:"id"`
	Username  string          `json:"username"`
	FirstSeen json.RawMessage `json:"firstSeen"`
}

func PlanUsersPointsImport(reader io.Reader) (UsersPointsImportPlan, error) {
	plan := UsersPointsImportPlan{}
	users := map[int64]UserImportRecord{}
	nativePoints := map[int64]PointAccountImportRecord{}
	legacyPoints := map[int64]PointAccountImportRecord{}

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
		case "native_users":
			user, warnings, ok := parseNativeUser(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				users[user.ID] = user
			}
		case "native_user_points":
			account, warnings, ok := parseNativePointAccount(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				nativePoints[account.UserID] = account
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
			case matchKeyPattern(key, "user:*"):
				user, warnings, ok := parseLegacyUser(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					users[user.ID] = user
				}
			case matchKeyPattern(key, "points:*"):
				account, warnings, ok := parseLegacyPointAccount(key, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					legacyPoints[account.UserID] = account
				}
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	if len(nativePoints) > 0 && len(legacyPoints) > 0 {
		plan.Warnings = append(plan.Warnings, "同时检测到 native_user_points 和 legacy points:*；同一用户余额将优先使用 native_user_points")
	}

	for _, account := range nativePoints {
		plan.PointAccounts = append(plan.PointAccounts, account)
		if _, ok := users[account.UserID]; !ok {
			users[account.UserID] = placeholderUser(account.UserID, account.UpdatedAt)
		}
	}
	for userID, account := range legacyPoints {
		if _, exists := nativePoints[userID]; exists {
			continue
		}
		plan.PointAccounts = append(plan.PointAccounts, account)
		if _, ok := users[userID]; !ok {
			users[userID] = placeholderUser(userID, account.UpdatedAt)
		}
	}
	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	return plan, nil
}

func ApplyUsersPointsImport(ctx context.Context, db *pgxpool.Pool, plan UsersPointsImportPlan) (UsersPointsImportResult, error) {
	result := UsersPointsImportResult{Warnings: plan.Warnings}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, user := range plan.Users {
		if _, err := tx.Exec(ctx,
			`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO UPDATE SET
			   username = excluded.username,
			   display_name = excluded.display_name,
			   first_seen_at = LEAST(users.first_seen_at, excluded.first_seen_at),
			   updated_at = GREATEST(users.updated_at, excluded.updated_at)`,
			user.ID,
			user.Username,
			user.DisplayName,
			user.FirstSeenAt,
			user.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert user %d failed: %w", user.ID, err)
		}
		result.UsersUpserted++
	}

	for _, account := range plan.PointAccounts {
		if _, err := tx.Exec(ctx,
			`INSERT INTO point_accounts (user_id, balance, updated_at)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (user_id) DO UPDATE SET
			   balance = excluded.balance,
			   updated_at = excluded.updated_at`,
			account.UserID,
			account.Balance,
			account.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert point account %d failed: %w", account.UserID, err)
		}
		result.PointAccountsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseNativeUser(statement insertStatement) (UserImportRecord, []string, bool) {
	userID, ok := int64Value(statement, []string{"user_id", "username", "first_seen", "updated_at"}, "user_id", 0)
	if !ok || userID <= 0 {
		return UserImportRecord{}, []string{"跳过 native_users：无效 user_id"}, false
	}
	username, _ := valueFor(statement, []string{"user_id", "username", "first_seen", "updated_at"}, "username", 1)
	firstSeen, _ := int64Value(statement, []string{"user_id", "username", "first_seen", "updated_at"}, "first_seen", 2)
	updatedAt, _ := int64Value(statement, []string{"user_id", "username", "first_seen", "updated_at"}, "updated_at", 3)

	return UserImportRecord{
		ID:          userID,
		Username:    fallbackString(username, fmt.Sprintf("user_%d", userID)),
		DisplayName: fallbackString(username, fmt.Sprintf("user_%d", userID)),
		FirstSeenAt: millisToTime(firstSeen),
		UpdatedAt:   millisToTime(updatedAt),
	}, nil, true
}

func parseNativePointAccount(statement insertStatement) (PointAccountImportRecord, []string, bool) {
	userID, ok := int64Value(statement, []string{"user_id", "balance", "updated_at"}, "user_id", 0)
	if !ok || userID <= 0 {
		return PointAccountImportRecord{}, []string{"跳过 native_user_points：无效 user_id"}, false
	}
	balance, _ := int64Value(statement, []string{"user_id", "balance", "updated_at"}, "balance", 1)
	if balance < 0 {
		return PointAccountImportRecord{}, []string{fmt.Sprintf("跳过 native_user_points:%d：余额为负数", userID)}, false
	}
	updatedAt, _ := int64Value(statement, []string{"user_id", "balance", "updated_at"}, "updated_at", 2)

	return PointAccountImportRecord{
		UserID:    userID,
		Balance:   balance,
		UpdatedAt: millisToTime(updatedAt),
		Source:    "native_user_points",
	}, nil, true
}

func parseLegacyUser(key string, rawValue string) (UserImportRecord, []string, bool) {
	var raw rawLegacyUser
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return UserImportRecord{}, []string{fmt.Sprintf("跳过 %s：用户 JSON 解析失败：%v", key, err)}, false
	}

	userID := int64FromRaw(raw.ID, 0)
	if userID <= 0 {
		userID = userIDFromPrefixedKey(key, "user:")
	}
	if userID <= 0 {
		return UserImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	firstSeen := int64FromRaw(raw.FirstSeen, nowMillis())
	username := fallbackString(raw.Username, fmt.Sprintf("user_%d", userID))
	return UserImportRecord{
		ID:          userID,
		Username:    username,
		DisplayName: username,
		FirstSeenAt: millisToTime(firstSeen),
		UpdatedAt:   millisToTime(firstSeen),
	}, nil, true
}

func parseLegacyPointAccount(key string, rawValue string) (PointAccountImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, "points:")
	if userID <= 0 {
		return PointAccountImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	balance, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return PointAccountImportRecord{}, []string{fmt.Sprintf("跳过 %s：积分余额解析失败：%v", key, err)}, false
	}
	if balance < 0 {
		return PointAccountImportRecord{}, []string{fmt.Sprintf("跳过 %s：余额为负数", key)}, false
	}

	return PointAccountImportRecord{
		UserID:    userID,
		Balance:   balance,
		UpdatedAt: time.Now().UTC(),
		Source:    "points:*",
	}, nil, true
}

func int64Value(statement insertStatement, defaults []string, column string, fallbackIndex int) (int64, bool) {
	value, ok := valueFor(statement, defaults, column, fallbackIndex)
	if !ok {
		return 0, false
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	return parsed, err == nil
}

func userIDFromPrefixedKey(key string, prefix string) int64 {
	raw := strings.TrimPrefix(key, prefix)
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func placeholderUser(userID int64, updatedAt time.Time) UserImportRecord {
	username := fmt.Sprintf("user_%d", userID)
	return UserImportRecord{
		ID:          userID,
		Username:    username,
		DisplayName: username,
		FirstSeenAt: updatedAt,
		UpdatedAt:   updatedAt,
	}
}

func millisToTime(millis int64) time.Time {
	if millis <= 0 {
		return time.Now().UTC()
	}
	return time.UnixMilli(millis).UTC()
}
