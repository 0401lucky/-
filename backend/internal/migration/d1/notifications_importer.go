package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const notificationItemKeyPrefix = "notifications:item:"
const maxNotificationTextRunes = 5000

type NotificationsImportPlan struct {
	Users         []UserImportRecord
	Notifications []NotificationImportRecord
	Warnings      []string
}

type NotificationsImportResult struct {
	UsersUpserted         int
	NotificationsUpserted int
	Warnings              []string
}

type NotificationImportRecord struct {
	ID          string
	UserID      int64
	Type        string
	Title       string
	Content     string
	DataJSON    string
	CreatedAtMs int64
	ReadAtMs    *int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type rawLegacyNotification struct {
	ID        string          `json:"id"`
	UserID    json.RawMessage `json:"userId"`
	Type      string          `json:"type"`
	Title     string          `json:"title"`
	Content   string          `json:"content"`
	Data      json.RawMessage `json:"data"`
	CreatedAt json.RawMessage `json:"createdAt"`
	ReadAt    json.RawMessage `json:"readAt"`
}

func PlanNotificationsImport(reader io.Reader) (NotificationsImportPlan, error) {
	plan := NotificationsImportPlan{}
	users := map[int64]UserImportRecord{}
	notifications := map[string]NotificationImportRecord{}

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
		if !ok || !matchKeyPattern(key, notificationItemKeyPrefix+"*") {
			continue
		}
		value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
		if !ok {
			continue
		}

		record, warnings, ok := parseLegacyNotification(key, value)
		plan.Warnings = append(plan.Warnings, warnings...)
		if !ok {
			continue
		}
		notifications[record.ID] = record
		ensurePlanUser(users, record.UserID, record.CreatedAt)
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, notification := range notifications {
		plan.Notifications = append(plan.Notifications, notification)
	}
	return plan, nil
}

func ApplyNotificationsImport(ctx context.Context, db *pgxpool.Pool, plan NotificationsImportPlan) (NotificationsImportResult, error) {
	result := NotificationsImportResult{Warnings: plan.Warnings}
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

	for _, notification := range plan.Notifications {
		if _, err := tx.Exec(ctx,
			`INSERT INTO notifications (
			   id, user_id, type, title, content, data, created_at_ms, read_at_ms, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   type = excluded.type,
			   title = excluded.title,
			   content = excluded.content,
			   data = excluded.data,
			   created_at_ms = excluded.created_at_ms,
			   read_at_ms = excluded.read_at_ms,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			notification.ID,
			notification.UserID,
			notification.Type,
			notification.Title,
			notification.Content,
			notification.DataJSON,
			notification.CreatedAtMs,
			nullableInt64Ptr(notification.ReadAtMs),
			notification.CreatedAt,
			notification.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert notification %s failed: %w", notification.ID, err)
		}
		result.NotificationsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseLegacyNotification(key string, rawValue string) (NotificationImportRecord, []string, bool) {
	var raw rawLegacyNotification
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return NotificationImportRecord{}, []string{fmt.Sprintf("跳过 %s：通知 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	id := strings.TrimSpace(raw.ID)
	keyID := strings.TrimSpace(strings.TrimPrefix(key, notificationItemKeyPrefix))
	if id == "" {
		id = keyID
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用 key 后缀作为通知 ID", key))
	}
	if id == "" {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：通知 ID 为空", key)), false
	}
	if keyID != "" && id != keyID {
		warnings = append(warnings, fmt.Sprintf("%s 的 JSON id %q 与 key 后缀 %q 不一致，使用 JSON id", key, id, keyID))
	}

	userID, ok := numberFromRaw(raw.UserID)
	if !ok || userID <= 0 {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：无效用户 ID", key)), false
	}
	notificationType := strings.TrimSpace(raw.Type)
	if !isLegacyNotificationType(notificationType) {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知通知类型 %q", key, notificationType)), false
	}

	title := sanitizeLegacyNotificationText(raw.Title)
	if title == "" {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：通知标题为空", key)), false
	}
	content := sanitizeLegacyNotificationText(raw.Content)
	if content == "" {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：通知内容为空", key)), false
	}

	createdAtMs, ok := numberFromRaw(raw.CreatedAt)
	if !ok || createdAtMs <= 0 {
		return NotificationImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：createdAt 必须是正数", key)), false
	}
	readAtMs, warning := parseImportedNotificationReadAt(raw.ReadAt, createdAtMs)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 readAt 无效：%s", key, warning))
	}
	dataJSON, warning := normalizeNotificationData(raw.Data)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 data 无效：%s", key, warning))
	}

	updatedAt := millisToTime(createdAtMs)
	if readAtMs != nil {
		updatedAt = millisToTime(*readAtMs)
	}
	return NotificationImportRecord{
		ID:          id,
		UserID:      userID,
		Type:        notificationType,
		Title:       title,
		Content:     content,
		DataJSON:    dataJSON,
		CreatedAtMs: createdAtMs,
		ReadAtMs:    readAtMs,
		CreatedAt:   millisToTime(createdAtMs),
		UpdatedAt:   updatedAt,
	}, warnings, true
}

func isLegacyNotificationType(value string) bool {
	switch value {
	case "system", "announcement", "feedback_reply", "feedback_status", "lottery_win", "raffle_win", "wallet", "reward":
		return true
	default:
		return false
	}
}

func sanitizeLegacyNotificationText(value string) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxNotificationTextRunes {
		value = string(runes[:maxNotificationTextRunes])
	}
	return value
}

func parseImportedNotificationReadAt(raw json.RawMessage, createdAtMs int64) (*int64, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, ""
	}
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return nil, "时间戳必须是正数"
	}
	if value < createdAtMs {
		return nil, "时间戳早于 createdAt，按未读导入"
	}
	return &value, ""
}

func normalizeNotificationData(raw json.RawMessage) (string, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "{}", ""
	}
	if !json.Valid(raw) {
		return "{}", "不是合法 JSON，已使用空对象"
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		return "{}", "不是对象，已使用空对象"
	}
	normalized, err := json.Marshal(object)
	if err != nil {
		return "{}", "序列化失败，已使用空对象"
	}
	return string(normalized), ""
}
