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
	rewardBatchKeyPrefix = "rewards:batch:"
	rewardClaimKeyPrefix = "rewards:claim:"
)

type RewardClaimsImportPlan struct {
	Users    []UserImportRecord
	Batches  []RewardBatchImportRecord
	Claims   []RewardClaimImportRecord
	Warnings []string
}

type RewardClaimsImportResult struct {
	UsersUpserted   int
	BatchesUpserted int
	ClaimsUpserted  int
	Warnings        []string
}

type RewardBatchImportRecord struct {
	ID                string
	Type              string
	Amount            string
	TargetMode        string
	TargetUserIDsJSON string
	Title             string
	Message           string
	CreatedBy         string
	CreatedAtMs       int64
	Status            string
	TotalTargets      int64
	DistributedCount  int64
	ClaimedCount      int64
	FailedClaimCount  int64
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type RewardClaimImportRecord struct {
	ID             string
	BatchID        string
	UserID         int64
	NotificationID string
	Type           string
	Amount         string
	Status         string
	ClaimedAtMs    *int64
	FailReason     *string
	RetryCount     int64
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type rawLegacyRewardBatch struct {
	ID               string          `json:"id"`
	Type             string          `json:"type"`
	Amount           json.RawMessage `json:"amount"`
	TargetMode       string          `json:"targetMode"`
	TargetUserIDs    json.RawMessage `json:"targetUserIds"`
	Title            string          `json:"title"`
	Message          string          `json:"message"`
	CreatedBy        string          `json:"createdBy"`
	CreatedAt        json.RawMessage `json:"createdAt"`
	Status           string          `json:"status"`
	TotalTargets     json.RawMessage `json:"totalTargets"`
	DistributedCount json.RawMessage `json:"distributedCount"`
	ClaimedCount     json.RawMessage `json:"claimedCount"`
	FailedClaimCount json.RawMessage `json:"failedClaimCount"`
}

type rawLegacyRewardClaim struct {
	ID             string          `json:"id"`
	BatchID        string          `json:"batchId"`
	UserID         json.RawMessage `json:"userId"`
	NotificationID string          `json:"notificationId"`
	Type           string          `json:"type"`
	Amount         json.RawMessage `json:"amount"`
	Status         string          `json:"status"`
	ClaimedAt      json.RawMessage `json:"claimedAt"`
	FailReason     string          `json:"failReason"`
	RetryCount     json.RawMessage `json:"retryCount"`
}

type rawRewardNotificationData struct {
	RewardBatchID string          `json:"rewardBatchId"`
	RewardType    string          `json:"rewardType"`
	RewardAmount  json.RawMessage `json:"rewardAmount"`
	ClaimStatus   string          `json:"claimStatus"`
}

func PlanRewardClaimsImport(reader io.Reader) (RewardClaimsImportPlan, error) {
	plan := RewardClaimsImportPlan{}
	users := map[int64]UserImportRecord{}
	batches := map[string]RewardBatchImportRecord{}
	claims := map[string]RewardClaimImportRecord{}
	fallbackClaims := map[string]RewardClaimImportRecord{}

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
		case matchKeyPattern(key, rewardBatchKeyPrefix+"*") && !matchKeyPattern(key, rewardClaimKeyPrefix+"lock:*"):
			batch, warnings, ok := parseLegacyRewardBatch(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				batches[batch.ID] = batch
			}
		case matchKeyPattern(key, rewardClaimKeyPrefix+"*") && !matchKeyPattern(key, rewardClaimKeyPrefix+"lock:*"):
			claim, warnings, ok := parseLegacyRewardClaim(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				claims[rewardClaimPlanKey(claim.BatchID, claim.UserID)] = claim
				ensurePlanUser(users, claim.UserID, claim.UpdatedAt)
			}
		case matchKeyPattern(key, notificationItemKeyPrefix+"*"):
			claim, warnings, ok := parseRewardClaimFromNotification(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				fallbackClaims[rewardClaimPlanKey(claim.BatchID, claim.UserID)] = claim
				ensurePlanUser(users, claim.UserID, claim.UpdatedAt)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for key, claim := range fallbackClaims {
		if _, exists := claims[key]; !exists {
			claims[key] = claim
		}
	}
	for _, batch := range batches {
		plan.Batches = append(plan.Batches, batch)
	}
	for _, claim := range claims {
		plan.Claims = append(plan.Claims, claim)
	}
	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	return plan, nil
}

func ApplyRewardClaimsImport(ctx context.Context, db *pgxpool.Pool, plan RewardClaimsImportPlan) (RewardClaimsImportResult, error) {
	result := RewardClaimsImportResult{Warnings: plan.Warnings}
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

	for _, batch := range plan.Batches {
		if _, err := tx.Exec(ctx,
			`INSERT INTO reward_batches (
			   id, type, amount, target_mode, target_user_ids, title, message, created_by,
			   created_at_ms, status, total_targets, distributed_count, claimed_count,
			   failed_claim_count, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3::numeric, $4, $5::jsonb, $6, $7, $8,
			   $9, $10, $11, $12, $13, $14, $15, $16
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   type = excluded.type,
			   amount = excluded.amount,
			   target_mode = excluded.target_mode,
			   target_user_ids = excluded.target_user_ids,
			   title = excluded.title,
			   message = excluded.message,
			   created_by = excluded.created_by,
			   created_at_ms = excluded.created_at_ms,
			   status = excluded.status,
			   total_targets = excluded.total_targets,
			   distributed_count = excluded.distributed_count,
			   claimed_count = excluded.claimed_count,
			   failed_claim_count = excluded.failed_claim_count,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			batch.ID,
			batch.Type,
			batch.Amount,
			batch.TargetMode,
			batch.TargetUserIDsJSON,
			batch.Title,
			batch.Message,
			batch.CreatedBy,
			batch.CreatedAtMs,
			batch.Status,
			batch.TotalTargets,
			batch.DistributedCount,
			batch.ClaimedCount,
			batch.FailedClaimCount,
			batch.CreatedAt,
			batch.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert reward batch %s failed: %w", batch.ID, err)
		}
		result.BatchesUpserted++
	}

	for _, claim := range plan.Claims {
		if _, err := tx.Exec(ctx,
			`INSERT INTO reward_claims (
			   id, batch_id, user_id, notification_id, type, amount, status,
			   claimed_at_ms, fail_reason, retry_count, created_at, updated_at
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $11, $12
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   batch_id = excluded.batch_id,
			   user_id = excluded.user_id,
			   notification_id = excluded.notification_id,
			   type = excluded.type,
			   amount = excluded.amount,
			   status = excluded.status,
			   claimed_at_ms = excluded.claimed_at_ms,
			   fail_reason = excluded.fail_reason,
			   retry_count = excluded.retry_count,
			   created_at = excluded.created_at,
			   updated_at = excluded.updated_at`,
			claim.ID,
			claim.BatchID,
			claim.UserID,
			claim.NotificationID,
			claim.Type,
			claim.Amount,
			claim.Status,
			nullableInt64Ptr(claim.ClaimedAtMs),
			nullableStringPtr(claim.FailReason),
			claim.RetryCount,
			claim.CreatedAt,
			claim.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert reward claim %s failed: %w", claim.ID, err)
		}
		result.ClaimsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseLegacyRewardBatch(key string, rawValue string) (RewardBatchImportRecord, []string, bool) {
	var raw rawLegacyRewardBatch
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return RewardBatchImportRecord{}, []string{fmt.Sprintf("跳过 %s：奖励批次 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	id := strings.TrimSpace(raw.ID)
	keyID := strings.TrimSpace(strings.TrimPrefix(key, rewardBatchKeyPrefix))
	if id == "" {
		id = keyID
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用 key 后缀作为批次 ID", key))
	}
	if id == "" {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励批次 ID 为空", key)), false
	}

	rewardType := strings.TrimSpace(raw.Type)
	if !isLegacyRewardType(rewardType) {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知奖励类型 %q", key, rewardType)), false
	}
	amount, ok := positiveDecimalStringFromRaw(raw.Amount)
	if !ok {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励数量必须大于 0", key)), false
	}
	targetMode := strings.TrimSpace(raw.TargetMode)
	if !isLegacyRewardTargetMode(targetMode) {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知目标模式 %q", key, targetMode)), false
	}
	createdAtMs, ok := numberFromRaw(raw.CreatedAt)
	if !ok || createdAtMs <= 0 {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：createdAt 必须是正数", key)), false
	}
	status := strings.TrimSpace(raw.Status)
	if !isLegacyRewardBatchStatus(status) {
		return RewardBatchImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知批次状态 %q", key, status)), false
	}
	targetUserIDsJSON := string(normalizedJSONArray(raw.TargetUserIDs))
	updatedAt := millisToTime(createdAtMs)

	return RewardBatchImportRecord{
		ID:                id,
		Type:              rewardType,
		Amount:            amount,
		TargetMode:        targetMode,
		TargetUserIDsJSON: targetUserIDsJSON,
		Title:             fallbackString(raw.Title, "奖励通知"),
		Message:           fallbackString(raw.Message, "你收到了一份奖励"),
		CreatedBy:         fallbackString(raw.CreatedBy, "legacy_import"),
		CreatedAtMs:       createdAtMs,
		Status:            status,
		TotalTargets:      maxInt64(0, int64FromRaw(raw.TotalTargets, 0)),
		DistributedCount:  maxInt64(0, int64FromRaw(raw.DistributedCount, 0)),
		ClaimedCount:      maxInt64(0, int64FromRaw(raw.ClaimedCount, 0)),
		FailedClaimCount:  maxInt64(0, int64FromRaw(raw.FailedClaimCount, 0)),
		CreatedAt:         millisToTime(createdAtMs),
		UpdatedAt:         updatedAt,
	}, warnings, true
}

func parseLegacyRewardClaim(key string, rawValue string) (RewardClaimImportRecord, []string, bool) {
	var raw rawLegacyRewardClaim
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return RewardClaimImportRecord{}, []string{fmt.Sprintf("跳过 %s：奖励领取 JSON 解析失败：%v", key, err)}, false
	}

	var warnings []string
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = strings.TrimPrefix(key, rewardClaimKeyPrefix)
		id = strings.ReplaceAll(id, ":", "-")
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用 key 后缀作为领取 ID", key))
	}
	batchID := strings.TrimSpace(raw.BatchID)
	userID, ok := numberFromRaw(raw.UserID)
	if batchID == "" || !ok || userID <= 0 {
		keyBatchID, keyUserID := rewardClaimPartsFromKey(key)
		if batchID == "" {
			batchID = keyBatchID
		}
		if userID <= 0 {
			userID = keyUserID
		}
	}
	if id == "" || batchID == "" || userID <= 0 {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：领取记录缺少批次或用户", key)), false
	}
	notificationID := strings.TrimSpace(raw.NotificationID)
	if notificationID == "" {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：缺少通知 ID", key)), false
	}
	rewardType := strings.TrimSpace(raw.Type)
	if !isLegacyRewardType(rewardType) {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知奖励类型 %q", key, rewardType)), false
	}
	amount, ok := positiveDecimalStringFromRaw(raw.Amount)
	if !ok {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励数量必须大于 0", key)), false
	}
	status := strings.TrimSpace(raw.Status)
	if !isLegacyRewardClaimStatus(status) {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：未知领取状态 %q", key, status)), false
	}
	claimedAt := positiveInt64FromRaw(raw.ClaimedAt)
	updatedAt := time.Now().UTC()
	if claimedAt != nil {
		updatedAt = millisToTime(*claimedAt)
	}
	retryCount := maxInt64(0, int64FromRaw(raw.RetryCount, 0))
	failReason := optionalString(raw.FailReason)

	return RewardClaimImportRecord{
		ID:             id,
		BatchID:        batchID,
		UserID:         userID,
		NotificationID: notificationID,
		Type:           rewardType,
		Amount:         amount,
		Status:         status,
		ClaimedAtMs:    claimedAt,
		FailReason:     failReason,
		RetryCount:     retryCount,
		CreatedAt:      updatedAt,
		UpdatedAt:      updatedAt,
	}, warnings, true
}

func parseRewardClaimFromNotification(key string, rawValue string) (RewardClaimImportRecord, []string, bool) {
	var raw rawLegacyNotification
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return RewardClaimImportRecord{}, nil, false
	}
	if strings.TrimSpace(raw.Type) != "reward" {
		return RewardClaimImportRecord{}, nil, false
	}

	var warnings []string
	notificationID := strings.TrimSpace(raw.ID)
	keyID := strings.TrimSpace(strings.TrimPrefix(key, notificationItemKeyPrefix))
	if notificationID == "" {
		notificationID = keyID
		warnings = append(warnings, fmt.Sprintf("%s 缺少 id，使用 key 后缀作为通知 ID", key))
	}
	userID, ok := numberFromRaw(raw.UserID)
	if notificationID == "" || !ok || userID <= 0 {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励通知缺少通知 ID 或用户 ID", key)), false
	}

	var data rawRewardNotificationData
	if len(raw.Data) == 0 || string(raw.Data) == "null" {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励通知 data 为空", key)), false
	}
	if err := json.Unmarshal(raw.Data, &data); err != nil {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励通知 data 解析失败：%v", key, err)), false
	}
	batchID := strings.TrimSpace(data.RewardBatchID)
	rewardType := strings.TrimSpace(data.RewardType)
	amount, amountOK := positiveDecimalStringFromRaw(data.RewardAmount)
	if batchID == "" || !isLegacyRewardType(rewardType) || !amountOK {
		return RewardClaimImportRecord{}, append(warnings, fmt.Sprintf("跳过 %s：奖励通知 data 缺少有效批次、类型或数量", key)), false
	}
	createdAtMs, ok := numberFromRaw(raw.CreatedAt)
	if !ok || createdAtMs <= 0 {
		createdAtMs = nowMillis()
		warnings = append(warnings, fmt.Sprintf("%s 缺少有效 createdAt，使用当前时间", key))
	}
	status := strings.TrimSpace(data.ClaimStatus)
	if !isLegacyRewardClaimStatus(status) {
		status = "pending"
	}
	claimedAt := (*int64)(nil)
	if status == "claimed" {
		claimedAt = parseImportedNotificationReadAtOrNil(raw.ReadAt)
	}
	updatedAt := millisToTime(createdAtMs)
	if claimedAt != nil {
		updatedAt = millisToTime(*claimedAt)
	}

	return RewardClaimImportRecord{
		ID:             "notification-" + notificationID,
		BatchID:        batchID,
		UserID:         userID,
		NotificationID: notificationID,
		Type:           rewardType,
		Amount:         amount,
		Status:         status,
		ClaimedAtMs:    claimedAt,
		RetryCount:     0,
		CreatedAt:      millisToTime(createdAtMs),
		UpdatedAt:      updatedAt,
	}, warnings, true
}

func rewardClaimPartsFromKey(key string) (string, int64) {
	raw := strings.TrimPrefix(key, rewardClaimKeyPrefix)
	parts := strings.Split(raw, ":")
	if len(parts) != 2 {
		return "", 0
	}
	userID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return parts[0], 0
	}
	return parts[0], userID
}

func rewardClaimPlanKey(batchID string, userID int64) string {
	return fmt.Sprintf("%s:%d", batchID, userID)
}

func positiveDecimalStringFromRaw(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", false
	}
	var asNumber json.Number
	if err := decodeJSONObject(string(raw), &asNumber); err == nil {
		value, err := asNumber.Float64()
		if err == nil && value > 0 {
			return asNumber.String(), true
		}
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		number := json.Number(strings.TrimSpace(asString))
		value, err := number.Float64()
		if err == nil && value > 0 {
			return number.String(), true
		}
	}
	return "", false
}

func parseImportedNotificationReadAtOrNil(raw json.RawMessage) *int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return nil
	}
	return &value
}

func isLegacyRewardType(value string) bool {
	return value == "points" || value == "quota"
}

func isLegacyRewardTargetMode(value string) bool {
	return value == "all" || value == "selected"
}

func isLegacyRewardBatchStatus(value string) bool {
	return value == "distributing" || value == "completed" || value == "failed"
}

func isLegacyRewardClaimStatus(value string) bool {
	return value == "pending" || value == "claimed" || value == "failed"
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
