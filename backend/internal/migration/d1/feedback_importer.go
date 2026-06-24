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

const (
	feedbackItemKeyPrefix     = "feedback:item:"
	feedbackMessagesKeyPrefix = "feedback:messages:"
	feedbackLikesKeyPrefix    = "feedback:likes:"
	maxFeedbackTitleRunes     = 80
	maxFeedbackContactRunes   = 100
	maxFeedbackContentRunes   = 1000
)

type FeedbackImportPlan struct {
	Users    []UserImportRecord
	Items    []FeedbackItemImportRecord
	Messages []FeedbackMessageImportRecord
	Likes    []FeedbackLikeImportRecord
	Warnings []string
}

type FeedbackImportResult struct {
	UsersUpserted    int
	ItemsUpserted    int
	MessagesUpserted int
	LikesUpserted    int
	Warnings         []string
}

type FeedbackItemImportRecord struct {
	ID           string
	UserID       int64
	Username     string
	Title        *string
	Contact      *string
	Anonymous    bool
	Status       string
	CreatedAtMs  int64
	UpdatedAtMs  int64
	ArchivedAtMs *int64
	RawItemJSON  string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type FeedbackMessageImportRecord struct {
	ID             string
	FeedbackID     string
	Role           string
	Content        string
	ImagesJSON     string
	CreatedAtMs    int64
	CreatedBy      string
	RawMessageJSON string
}

type FeedbackLikeImportRecord struct {
	FeedbackID string
	UserID     int64
}

type rawLegacyFeedbackItem struct {
	ID         string          `json:"id"`
	UserID     json.RawMessage `json:"userId"`
	Username   string          `json:"username"`
	Title      json.RawMessage `json:"title"`
	Contact    json.RawMessage `json:"contact"`
	Anonymous  json.RawMessage `json:"anonymous"`
	Status     string          `json:"status"`
	CreatedAt  json.RawMessage `json:"createdAt"`
	UpdatedAt  json.RawMessage `json:"updatedAt"`
	ArchivedAt json.RawMessage `json:"archivedAt"`
}

type rawLegacyFeedbackMessage struct {
	ID         string          `json:"id"`
	FeedbackID string          `json:"feedbackId"`
	Role       string          `json:"role"`
	Content    string          `json:"content"`
	Images     json.RawMessage `json:"images"`
	CreatedAt  json.RawMessage `json:"createdAt"`
	CreatedBy  string          `json:"createdBy"`
}

func PlanFeedbackImport(reader io.Reader) (FeedbackImportPlan, error) {
	plan := FeedbackImportPlan{}
	users := map[int64]UserImportRecord{}
	items := map[string]FeedbackItemImportRecord{}
	messages := map[string]FeedbackMessageImportRecord{}
	likes := map[string]FeedbackLikeImportRecord{}

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
		if !isKVTable(statement.Table) {
			continue
		}
		key, ok := kvKey(statement)
		if !ok {
			continue
		}

		switch {
		case statement.Table == "kv_data" && matchKeyPattern(key, feedbackItemKeyPrefix+"*"):
			value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
			if !ok {
				continue
			}
			record, warnings, ok := parseLegacyFeedbackItem(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				items[record.ID] = record
				ensurePlanUser(users, record.UserID, record.CreatedAt)
			}
		case statement.Table == "kv_lists" && matchKeyPattern(key, feedbackMessagesKeyPrefix+"*"):
			value, ok := valueFor(statement, []string{"id", "key", "value"}, "value", 2)
			if !ok {
				continue
			}
			listID, _ := valueFor(statement, []string{"id", "key", "value"}, "id", 0)
			record, warnings, ok := parseLegacyFeedbackMessage(key, listID, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				messages[record.ID] = record
			}
		case statement.Table == "kv_sets" && matchKeyPattern(key, feedbackLikesKeyPrefix+"*"):
			member, ok := valueFor(statement, []string{"key", "member"}, "member", 1)
			if !ok {
				continue
			}
			record, warnings, ok := parseLegacyFeedbackLike(key, member)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				likes[fmt.Sprintf("%s:%d", record.FeedbackID, record.UserID)] = record
				ensurePlanUser(users, record.UserID, time.Now().UTC())
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, item := range items {
		plan.Items = append(plan.Items, item)
	}
	for _, message := range messages {
		plan.Messages = append(plan.Messages, message)
	}
	for _, like := range likes {
		plan.Likes = append(plan.Likes, like)
	}
	return plan, nil
}

func ApplyFeedbackImport(ctx context.Context, db *pgxpool.Pool, plan FeedbackImportPlan) (FeedbackImportResult, error) {
	result := FeedbackImportResult{Warnings: append([]string{}, plan.Warnings...)}
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

	for _, item := range plan.Items {
		if _, err := tx.Exec(ctx,
			`INSERT INTO feedback_items (
			   id, user_id, username, title, contact, anonymous, status,
			   created_at_ms, updated_at_ms, archived_at_ms, raw_item, imported_at, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7,
			   $8, $9, $10, $11::jsonb, now(), $12, $13
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   user_id = excluded.user_id,
			   username = excluded.username,
			   title = excluded.title,
			   contact = excluded.contact,
			   anonymous = excluded.anonymous,
			   status = excluded.status,
			   created_at_ms = excluded.created_at_ms,
			   updated_at_ms = excluded.updated_at_ms,
			   archived_at_ms = excluded.archived_at_ms,
			   raw_item = excluded.raw_item,
			   imported_at = excluded.imported_at,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			item.ID,
			item.UserID,
			item.Username,
			nullableStringPtr(item.Title),
			nullableStringPtr(item.Contact),
			item.Anonymous,
			item.Status,
			item.CreatedAtMs,
			item.UpdatedAtMs,
			nullableInt64Ptr(item.ArchivedAtMs),
			item.RawItemJSON,
			item.CreatedAt,
			item.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert feedback item %s failed: %w", item.ID, err)
		}
		result.ItemsUpserted++
	}

	for _, message := range plan.Messages {
		tag, err := tx.Exec(ctx,
			`INSERT INTO feedback_messages (
			   id, feedback_id, role, content, images, created_at_ms, created_by,
			   raw_message, imported_at, created_at, updated_at
			 )
			 SELECT $1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, now(), $9, $9
			 WHERE EXISTS (SELECT 1 FROM feedback_items WHERE id = $2)
			 ON CONFLICT (id) DO UPDATE SET
			   feedback_id = excluded.feedback_id,
			   role = excluded.role,
			   content = excluded.content,
			   images = excluded.images,
			   created_at_ms = excluded.created_at_ms,
			   created_by = excluded.created_by,
			   raw_message = excluded.raw_message,
			   imported_at = excluded.imported_at,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			message.ID,
			message.FeedbackID,
			message.Role,
			message.Content,
			message.ImagesJSON,
			message.CreatedAtMs,
			message.CreatedBy,
			message.RawMessageJSON,
			millisToTime(message.CreatedAtMs),
		)
		if err != nil {
			return result, fmt.Errorf("upsert feedback message %s failed: %w", message.ID, err)
		}
		if tag.RowsAffected() == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("feedback:messages:%s 目标库无对应反馈，已跳过 message %s", message.FeedbackID, message.ID))
			continue
		}
		result.MessagesUpserted++
	}

	for _, like := range plan.Likes {
		tag, err := tx.Exec(ctx,
			`INSERT INTO feedback_likes (feedback_id, user_id, imported_at)
			 SELECT $1, $2, now()
			 WHERE EXISTS (SELECT 1 FROM feedback_items WHERE id = $1)
			 ON CONFLICT (feedback_id, user_id) DO UPDATE SET
			   imported_at = excluded.imported_at`,
			like.FeedbackID,
			like.UserID,
		)
		if err != nil {
			return result, fmt.Errorf("upsert feedback like %s:%d failed: %w", like.FeedbackID, like.UserID, err)
		}
		if tag.RowsAffected() == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("feedback:likes:%s 目标库无对应反馈，已跳过 user %d", like.FeedbackID, like.UserID))
			continue
		}
		result.LikesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseLegacyFeedbackItem(key string, rawValue string) (FeedbackItemImportRecord, []string, bool) {
	var raw rawLegacyFeedbackItem
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return FeedbackItemImportRecord{}, []string{fmt.Sprintf("跳过 %s：反馈 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	id := strings.TrimSpace(raw.ID)
	keyID := strings.TrimSpace(strings.TrimPrefix(key, feedbackItemKeyPrefix))
	if id == "" {
		id = keyID
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用 key 后缀作为反馈 ID", key))
	}
	if id == "" {
		return FeedbackItemImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：反馈 ID 为空", key)), false
	}

	userID, ok := numberFromRaw(raw.UserID)
	if !ok || userID <= 0 {
		return FeedbackItemImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：无效用户 ID", key)), false
	}
	username := fallbackString(raw.Username, fmt.Sprintf("user_%d", userID))

	status := strings.TrimSpace(raw.Status)
	if !isValidFeedbackStatus(status) {
		return FeedbackItemImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：无效反馈状态 %q", key, status)), false
	}

	createdAtMs, ok := numberFromRaw(raw.CreatedAt)
	if !ok || createdAtMs <= 0 {
		return FeedbackItemImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：createdAt 必须是正数", key)), false
	}
	updatedAtMs, ok := numberFromRaw(raw.UpdatedAt)
	if !ok || updatedAtMs <= 0 {
		updatedAtMs = createdAtMs
		warnings = append(warnings, fmt.Sprintf("%s 缺少有效 updatedAt，使用 createdAt", key))
	}
	if updatedAtMs < createdAtMs {
		updatedAtMs = createdAtMs
		warnings = append(warnings, fmt.Sprintf("%s 的 updatedAt 早于 createdAt，使用 createdAt", key))
	}

	archivedAtMs, warning := parseOptionalPositiveMillis(raw.ArchivedAt)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 archivedAt 无效：%s", key, warning))
	}

	title, warning := optionalBoundedStringFromRaw(raw.Title, maxFeedbackTitleRunes)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 title 无效：%s", key, warning))
	}
	contact, warning := optionalBoundedStringFromRaw(raw.Contact, maxFeedbackContactRunes)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 contact 无效：%s", key, warning))
	}

	return FeedbackItemImportRecord{
		ID:           id,
		UserID:       userID,
		Username:     username,
		Title:        title,
		Contact:      contact,
		Anonymous:    boolFromRaw(raw.Anonymous, false),
		Status:       status,
		CreatedAtMs:  createdAtMs,
		UpdatedAtMs:  updatedAtMs,
		ArchivedAtMs: archivedAtMs,
		RawItemJSON:  normalizeJSONObjectString(rawValue),
		CreatedAt:    millisToTime(createdAtMs),
		UpdatedAt:    millisToTime(updatedAtMs),
	}, warnings, true
}

func parseLegacyFeedbackMessage(key string, listID string, rawValue string) (FeedbackMessageImportRecord, []string, bool) {
	var raw rawLegacyFeedbackMessage
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return FeedbackMessageImportRecord{}, []string{fmt.Sprintf("跳过 %s：反馈留言 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	feedbackID := strings.TrimSpace(strings.TrimPrefix(key, feedbackMessagesKeyPrefix))
	if raw.FeedbackID != "" {
		feedbackID = strings.TrimSpace(raw.FeedbackID)
	}
	if feedbackID == "" {
		return FeedbackMessageImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少反馈 ID", key)}, false
	}

	role := strings.TrimSpace(raw.Role)
	if role != "user" && role != "admin" {
		return FeedbackMessageImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效留言角色 %q", key, role)}, false
	}

	createdAtMs, ok := numberFromRaw(raw.CreatedAt)
	if !ok || createdAtMs <= 0 {
		return FeedbackMessageImportRecord{}, []string{fmt.Sprintf("跳过 %s：createdAt 必须是正数", key)}, false
	}

	content := truncateRunes(strings.TrimSpace(raw.Content), maxFeedbackContentRunes)
	imagesJSON, warning := normalizeImportedJSONList(raw.Images)
	if warning != "" {
		warnings = append(warnings, fmt.Sprintf("%s 的 images 无效：%s", key, warning))
	}
	if content == "" && imagesJSON == "[]" {
		return FeedbackMessageImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：留言内容和附件均为空", key)), false
	}

	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = strings.TrimSpace(listID)
	}
	if id == "" {
		id = fmt.Sprintf("legacy-feedback-message-%s-%d-%s", feedbackID, createdAtMs, sanitizeIDPart(raw.CreatedBy))
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用派生留言 ID", key))
	}

	createdBy := fallbackString(raw.CreatedBy, role)
	return FeedbackMessageImportRecord{
		ID:             id,
		FeedbackID:     feedbackID,
		Role:           role,
		Content:        content,
		ImagesJSON:     imagesJSON,
		CreatedAtMs:    createdAtMs,
		CreatedBy:      createdBy,
		RawMessageJSON: normalizeJSONObjectString(rawValue),
	}, warnings, true
}

func parseLegacyFeedbackLike(key string, rawMember string) (FeedbackLikeImportRecord, []string, bool) {
	feedbackID := strings.TrimSpace(strings.TrimPrefix(key, feedbackLikesKeyPrefix))
	if feedbackID == "" {
		return FeedbackLikeImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少反馈 ID", key)}, false
	}
	var raw json.RawMessage = []byte(rawMember)
	userID, ok := numberFromRaw(raw)
	if !ok {
		userID = userIDFromPrefixedKey("user:"+rawMember, "user:")
	}
	if userID <= 0 {
		return FeedbackLikeImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效点赞用户 ID %q", key, rawMember)}, false
	}
	return FeedbackLikeImportRecord{FeedbackID: feedbackID, UserID: userID}, nil, true
}

func isValidFeedbackStatus(status string) bool {
	return status == "open" || status == "processing" || status == "resolved" || status == "closed"
}

func parseOptionalPositiveMillis(raw json.RawMessage) (*int64, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, ""
	}
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return nil, "时间戳必须是正数"
	}
	return &value, ""
}

func optionalBoundedStringFromRaw(raw json.RawMessage, maxRunes int) (*string, string) {
	value, ok, warning := optionalStringFromRaw(raw)
	if warning != "" || !ok || value == nil {
		return nil, warning
	}
	if len([]rune(*value)) > maxRunes {
		return nil, fmt.Sprintf("长度超过 %d", maxRunes)
	}
	if hasASCIIControlChar(*value) {
		return nil, "包含控制字符"
	}
	return value, ""
}

func normalizeImportedJSONList(raw json.RawMessage) (string, string) {
	if len(raw) == 0 || string(raw) == "null" {
		return "[]", ""
	}
	if !json.Valid(raw) {
		return "[]", "不是合法 JSON，已使用空数组"
	}
	var array []any
	if err := json.Unmarshal(raw, &array); err != nil {
		return "[]", "不是数组，已使用空数组"
	}
	normalized, err := json.Marshal(array)
	if err != nil {
		return "[]", "序列化失败，已使用空数组"
	}
	return string(normalized), ""
}

func normalizeJSONObjectString(rawValue string) string {
	var object map[string]any
	if err := decodeJSONObject(rawValue, &object); err != nil {
		return "{}"
	}
	normalized, err := json.Marshal(object)
	if err != nil {
		return "{}"
	}
	return string(normalized)
}

func truncateRunes(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}

func sanitizeIDPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	value = strings.Map(func(char rune) rune {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			return char
		}
		return '-'
	}, value)
	return strings.Trim(value, "-")
}
