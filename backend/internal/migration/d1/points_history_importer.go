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

type PointsHistoryImportPlan struct {
	Users           []UserImportRecord
	PointLogs       []PointLogImportRecord
	DailyGamePoints []DailyGamePointImportRecord
	Warnings        []string
}

type PointsHistoryImportResult struct {
	UsersUpserted           int
	PointLogsUpserted       int
	DailyGamePointsUpserted int
	Warnings                []string
}

type PointLogImportRecord struct {
	ID           string
	UserID       int64
	Amount       int64
	Source       string
	Description  string
	BalanceAfter int64
	CreatedAt    time.Time
}

type DailyGamePointImportRecord struct {
	UserID       int64
	StatDate     string
	EarnedPoints int64
	UpdatedAt    time.Time
}

type rawLegacyPointLog struct {
	ID          string          `json:"id"`
	Amount      json.RawMessage `json:"amount"`
	Source      string          `json:"source"`
	Description string          `json:"description"`
	Balance     json.RawMessage `json:"balance"`
	CreatedAt   json.RawMessage `json:"createdAt"`
}

func PlanPointsHistoryImport(reader io.Reader) (PointsHistoryImportPlan, error) {
	plan := PointsHistoryImportPlan{}
	users := map[int64]UserImportRecord{}
	pointLogs := map[string]PointLogImportRecord{}
	dailyPoints := map[string]DailyGamePointImportRecord{}

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
		case "native_user_point_logs":
			log, warnings, ok := parseNativePointLog(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				pointLogs[log.ID] = log
				ensurePlanUser(users, log.UserID, log.CreatedAt)
			}
		case "native_user_daily_game_points":
			entry, warnings, ok := parseNativeDailyGamePoint(statement)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				dailyPoints[dailyPointKey(entry.UserID, entry.StatDate)] = entry
				ensurePlanUser(users, entry.UserID, entry.UpdatedAt)
			}
		case "kv_lists":
			key, ok := kvKey(statement)
			if !ok || !matchKeyPattern(key, "points_log:*") {
				continue
			}
			value, ok := valueFor(statement, []string{"id", "key", "value"}, "value", 2)
			if !ok {
				continue
			}
			log, warnings, ok := parseLegacyPointLog(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				pointLogs[log.ID] = log
				ensurePlanUser(users, log.UserID, log.CreatedAt)
			}
		case "kv_data":
			key, ok := kvKey(statement)
			if !ok || !matchKeyPattern(key, "game:daily_earned:*") {
				continue
			}
			value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
			if !ok {
				continue
			}
			entry, warnings, ok := parseLegacyDailyGamePoint(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				dailyPoints[dailyPointKey(entry.UserID, entry.StatDate)] = entry
				ensurePlanUser(users, entry.UserID, entry.UpdatedAt)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, log := range pointLogs {
		plan.PointLogs = append(plan.PointLogs, log)
	}
	for _, entry := range dailyPoints {
		plan.DailyGamePoints = append(plan.DailyGamePoints, entry)
	}
	return plan, nil
}

func ApplyPointsHistoryImport(ctx context.Context, db *pgxpool.Pool, plan PointsHistoryImportPlan) (PointsHistoryImportResult, error) {
	result := PointsHistoryImportResult{Warnings: plan.Warnings}
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

	for _, log := range plan.PointLogs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   amount = excluded.amount,
			   source = excluded.source,
			   description = excluded.description,
			   balance_after = excluded.balance_after,
			   created_at = excluded.created_at`,
			log.ID,
			log.UserID,
			log.Amount,
			log.Source,
			log.Description,
			log.BalanceAfter,
			log.CreatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert point log %s failed: %w", log.ID, err)
		}
		result.PointLogsUpserted++
	}

	for _, entry := range plan.DailyGamePoints {
		if _, err := tx.Exec(ctx,
			`INSERT INTO daily_game_points (user_id, stat_date, earned_points, updated_at)
			 VALUES ($1, $2::date, $3, $4)
			 ON CONFLICT (user_id, stat_date) DO UPDATE SET
			   earned_points = excluded.earned_points,
			   updated_at = excluded.updated_at`,
			entry.UserID,
			entry.StatDate,
			entry.EarnedPoints,
			entry.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert daily game points %d/%s failed: %w", entry.UserID, entry.StatDate, err)
		}
		result.DailyGamePointsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseNativePointLog(statement insertStatement) (PointLogImportRecord, []string, bool) {
	defaults := []string{"id", "user_id", "amount", "source", "description", "balance", "created_at"}
	id, _ := valueFor(statement, defaults, "id", 0)
	id = strings.TrimSpace(id)
	if id == "" {
		return PointLogImportRecord{}, []string{"跳过 native_user_point_logs：缺少 id"}, false
	}
	userID, ok := int64Value(statement, defaults, "user_id", 1)
	if !ok || userID <= 0 {
		return PointLogImportRecord{}, []string{fmt.Sprintf("跳过 native_user_point_logs:%s：无效 user_id", id)}, false
	}
	amount, _ := int64Value(statement, defaults, "amount", 2)
	source, _ := valueFor(statement, defaults, "source", 3)
	description, _ := valueFor(statement, defaults, "description", 4)
	balance, _ := int64Value(statement, defaults, "balance", 5)
	createdAt, _ := int64Value(statement, defaults, "created_at", 6)

	return PointLogImportRecord{
		ID:           id,
		UserID:       userID,
		Amount:       amount,
		Source:       fallbackString(source, "legacy_import"),
		Description:  fallbackString(description, "历史积分记录"),
		BalanceAfter: balance,
		CreatedAt:    millisToTime(createdAt),
	}, nil, true
}

func parseLegacyPointLog(key string, rawValue string) (PointLogImportRecord, []string, bool) {
	userID := userIDFromPrefixedKey(key, "points_log:")
	if userID <= 0 {
		return PointLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}

	var raw rawLegacyPointLog
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return PointLogImportRecord{}, []string{fmt.Sprintf("跳过 %s：积分流水 JSON 解析失败：%v", key, err)}, false
	}
	id := fallbackString(raw.ID, fmt.Sprintf("legacy-%s-%d", strings.TrimPrefix(key, "points_log:"), int64FromRaw(raw.CreatedAt, nowMillis())))
	return PointLogImportRecord{
		ID:           id,
		UserID:       userID,
		Amount:       int64FromRaw(raw.Amount, 0),
		Source:       fallbackString(raw.Source, "legacy_import"),
		Description:  fallbackString(raw.Description, "历史积分记录"),
		BalanceAfter: int64FromRaw(raw.Balance, 0),
		CreatedAt:    millisToTime(int64FromRaw(raw.CreatedAt, nowMillis())),
	}, nil, true
}

func parseNativeDailyGamePoint(statement insertStatement) (DailyGamePointImportRecord, []string, bool) {
	defaults := []string{"user_id", "stat_date", "earned_points", "updated_at"}
	userID, ok := int64Value(statement, defaults, "user_id", 0)
	if !ok || userID <= 0 {
		return DailyGamePointImportRecord{}, []string{"跳过 native_user_daily_game_points：无效 user_id"}, false
	}
	statDate, _ := valueFor(statement, defaults, "stat_date", 1)
	statDate = strings.TrimSpace(statDate)
	if !isValidDateString(statDate) {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 native_user_daily_game_points:%d：无效日期 %q", userID, statDate)}, false
	}
	earnedPoints, _ := int64Value(statement, defaults, "earned_points", 2)
	if earnedPoints < 0 {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 native_user_daily_game_points:%d/%s：积分为负数", userID, statDate)}, false
	}
	updatedAt, _ := int64Value(statement, defaults, "updated_at", 3)
	return DailyGamePointImportRecord{
		UserID:       userID,
		StatDate:     statDate,
		EarnedPoints: earnedPoints,
		UpdatedAt:    millisToTime(updatedAt),
	}, nil, true
}

func parseLegacyDailyGamePoint(key string, rawValue string) (DailyGamePointImportRecord, []string, bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 4 {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	userID, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || userID <= 0 {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效用户 ID", key)}, false
	}
	statDate := strings.TrimSpace(parts[3])
	if !isValidDateString(statDate) {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效日期", key)}, false
	}
	earnedPoints, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 %s：每日游戏积分解析失败：%v", key, err)}, false
	}
	if earnedPoints < 0 {
		return DailyGamePointImportRecord{}, []string{fmt.Sprintf("跳过 %s：积分为负数", key)}, false
	}
	return DailyGamePointImportRecord{
		UserID:       userID,
		StatDate:     statDate,
		EarnedPoints: earnedPoints,
		UpdatedAt:    time.Now().UTC(),
	}, nil, true
}

func ensurePlanUser(users map[int64]UserImportRecord, userID int64, at time.Time) {
	if userID <= 0 {
		return
	}
	if _, ok := users[userID]; ok {
		return
	}
	users[userID] = placeholderUser(userID, at)
}

func dailyPointKey(userID int64, statDate string) string {
	return fmt.Sprintf("%d:%s", userID, statDate)
}

func isValidDateString(value string) bool {
	_, err := time.Parse("2006-01-02", value)
	return err == nil
}
