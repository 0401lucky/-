package rewards

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"
	"redemption/backend/internal/platform/newapi"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable          = errors.New("rewards database unavailable")
	ErrNotificationNotFound = errors.New("notification not found")
	ErrForbidden            = errors.New("notification belongs to another user")
	ErrNotReward            = errors.New("notification is not reward")
	ErrInvalidRewardData    = errors.New("invalid reward data")
	ErrQuotaUnavailable     = errors.New("quota client unavailable")
)

type QuotaClient interface {
	CreditQuota(ctx context.Context, userID int64, dollars float64) (newapi.QuotaResult, error)
}

type Service struct {
	db           *pgxpool.Pool
	pointService *economy.Service
	quotaClient  QuotaClient
}

type ClaimResult struct {
	Success     bool   `json:"success"`
	Message     string `json:"message"`
	ClaimStatus string `json:"claimStatus"`
}

type rewardNotificationData struct {
	RewardBatchID string          `json:"rewardBatchId"`
	RewardType    string          `json:"rewardType"`
	RewardAmount  json.RawMessage `json:"rewardAmount"`
	ClaimStatus   string          `json:"claimStatus"`
}

type claimRecord struct {
	ID             string
	BatchID        string
	UserID         int64
	NotificationID string
	Type           string
	Amount         string
	Status         string
	RetryCount     int64
}

func NewService(db *pgxpool.Pool, pointService *economy.Service, quotaClient QuotaClient) *Service {
	return &Service{db: db, pointService: pointService, quotaClient: quotaClient}
}

func (service *Service) Claim(ctx context.Context, user auth.User, notificationID string) (ClaimResult, error) {
	if service.db == nil {
		return ClaimResult{}, ErrUnavailable
	}
	if service.pointService == nil {
		service.pointService = economy.NewService(service.db)
	}
	notificationID = strings.TrimSpace(notificationID)
	if notificationID == "" {
		return ClaimResult{}, ErrInvalidRewardData
	}
	if err := service.ensureRewardUserAccount(ctx, user); err != nil {
		return ClaimResult{}, err
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return ClaimResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	notification, err := service.getRewardNotificationForUpdate(ctx, tx, notificationID)
	if err != nil {
		return ClaimResult{}, err
	}
	if notification.UserID != user.ID {
		return ClaimResult{}, ErrForbidden
	}
	if notification.Type != "reward" {
		return ClaimResult{}, ErrNotReward
	}

	rewardData, err := parseRewardNotificationData(notification.Data)
	if err != nil {
		return ClaimResult{}, err
	}

	claim, err := service.getOrCreateClaimFromNotification(ctx, tx, user.ID, notificationID, rewardData, notification.CreatedAtMs)
	if err != nil {
		return ClaimResult{}, err
	}
	if claim.Status == "claimed" {
		if err := tx.Commit(ctx); err != nil {
			return ClaimResult{}, err
		}
		return ClaimResult{Success: true, Message: "奖励已领取", ClaimStatus: "claimed"}, nil
	}

	claimSuccess := false
	failReason := ""
	switch claim.Type {
	case "points":
		points, ok := integerAmount(claim.Amount)
		if !ok || points <= 0 {
			failReason = "奖励数据无效"
			break
		}
		if err := grantRewardPoints(ctx, tx, user.ID, points, "奖励领取: "+notification.Title); err != nil {
			return ClaimResult{}, err
		}
		claimSuccess = true
	case "quota":
		if service.quotaClient == nil {
			return ClaimResult{}, ErrQuotaUnavailable
		}
		dollars, ok := floatAmount(claim.Amount)
		if !ok || dollars <= 0 {
			failReason = "奖励数据无效"
			break
		}
		result, err := service.quotaClient.CreditQuota(ctx, user.ID, dollars)
		if err != nil {
			result = newapi.QuotaResult{Success: false, Message: "充值结果不确定，请稍后检查余额", Uncertain: true}
		}
		claimSuccess = result.Success || result.Uncertain
		if result.Uncertain {
			failReason = fallbackMessage(result.Message, "充值结果不确定，请稍后检查余额")
		} else if !claimSuccess {
			failReason = fallbackMessage(result.Message, "额度充值失败")
		}
	default:
		failReason = "奖励数据无效"
	}

	nowMs := time.Now().UnixMilli()
	if claimSuccess {
		if err := service.markClaimSuccess(ctx, tx, claim, notificationID, nowMs, failReason); err != nil {
			return ClaimResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return ClaimResult{}, err
		}
		return ClaimResult{
			Success:     true,
			Message:     fallbackMessage(failReason, "奖励领取成功"),
			ClaimStatus: "claimed",
		}, nil
	}

	if err := service.markClaimFailed(ctx, tx, claim, notificationID, failReason); err != nil {
		return ClaimResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ClaimResult{}, err
	}
	return ClaimResult{
		Success:     false,
		Message:     fallbackMessage(failReason, "领取失败"),
		ClaimStatus: "failed",
	}, nil
}

type notificationRecord struct {
	ID          string
	UserID      int64
	Type        string
	Title       string
	Data        []byte
	CreatedAtMs int64
}

func (service *Service) getRewardNotificationForUpdate(ctx context.Context, tx pgx.Tx, notificationID string) (notificationRecord, error) {
	var notification notificationRecord
	err := tx.QueryRow(ctx,
		`SELECT id, user_id, type, title, data, created_at_ms
		   FROM notifications
		  WHERE id = $1
		  FOR UPDATE`,
		notificationID,
	).Scan(&notification.ID, &notification.UserID, &notification.Type, &notification.Title, &notification.Data, &notification.CreatedAtMs)
	if errors.Is(err, pgx.ErrNoRows) {
		return notificationRecord{}, ErrNotificationNotFound
	}
	return notification, err
}

func (service *Service) getOrCreateClaimFromNotification(
	ctx context.Context,
	tx pgx.Tx,
	userID int64,
	notificationID string,
	data rewardNotificationData,
	createdAtMs int64,
) (claimRecord, error) {
	var claim claimRecord
	err := tx.QueryRow(ctx,
		`SELECT id, batch_id, user_id, notification_id, type, amount::text, status, retry_count
		   FROM reward_claims
		  WHERE batch_id = $1 AND user_id = $2
		  FOR UPDATE`,
		data.RewardBatchID,
		userID,
	).Scan(&claim.ID, &claim.BatchID, &claim.UserID, &claim.NotificationID, &claim.Type, &claim.Amount, &claim.Status, &claim.RetryCount)
	if err == nil {
		return claim, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return claimRecord{}, err
	}

	amount, ok := positiveDecimalStringFromRaw(data.RewardAmount)
	if data.RewardBatchID == "" || !isRewardType(data.RewardType) || !ok {
		return claimRecord{}, ErrInvalidRewardData
	}
	createdAt := millisToTime(createdAtMs)
	claim = claimRecord{
		ID:             randomID(),
		BatchID:        data.RewardBatchID,
		UserID:         userID,
		NotificationID: notificationID,
		Type:           data.RewardType,
		Amount:         amount,
		Status:         "pending",
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO reward_claims (
		   id, batch_id, user_id, notification_id, type, amount, status, retry_count, created_at, updated_at
		 ) VALUES ($1, $2, $3, $4, $5, $6::numeric, 'pending', 0, $7, $7)
		 ON CONFLICT (batch_id, user_id) DO NOTHING`,
		claim.ID,
		claim.BatchID,
		claim.UserID,
		claim.NotificationID,
		claim.Type,
		claim.Amount,
		createdAt,
	); err != nil {
		return claimRecord{}, err
	}
	return service.getOrCreateClaimFromNotification(ctx, tx, userID, notificationID, data, createdAtMs)
}

func (service *Service) markClaimSuccess(ctx context.Context, tx pgx.Tx, claim claimRecord, notificationID string, nowMs int64, failReason string) error {
	if _, err := tx.Exec(ctx,
		`UPDATE reward_claims
		    SET status = 'claimed',
		        claimed_at_ms = $2,
		        fail_reason = $3,
		        updated_at = now()
		  WHERE id = $1`,
		claim.ID,
		nowMs,
		nullableString(failReason),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE notifications
		    SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{claimStatus}', to_jsonb('claimed'::text), true),
		        read_at_ms = COALESCE(read_at_ms, $2),
		        updated_at = now()
		  WHERE id = $1`,
		notificationID,
		nowMs,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`UPDATE reward_batches
		    SET claimed_count = claimed_count + 1,
		        updated_at = now()
		  WHERE id = $1`,
		claim.BatchID,
	)
	return err
}

func (service *Service) markClaimFailed(ctx context.Context, tx pgx.Tx, claim claimRecord, notificationID string, failReason string) error {
	if _, err := tx.Exec(ctx,
		`UPDATE reward_claims
		    SET status = 'failed',
		        fail_reason = $2,
		        retry_count = retry_count + 1,
		        updated_at = now()
		  WHERE id = $1`,
		claim.ID,
		fallbackMessage(failReason, "领取失败"),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE notifications
		    SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{claimStatus}', to_jsonb('failed'::text), true),
		        updated_at = now()
		  WHERE id = $1`,
		notificationID,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`UPDATE reward_batches
		    SET failed_claim_count = failed_claim_count + 1,
		        updated_at = now()
		  WHERE id = $1`,
		claim.BatchID,
	)
	return err
}

func ensureRewardUser(ctx context.Context, tx pgx.Tx, user auth.User) error {
	displayName := strings.TrimSpace(user.DisplayName)
	if displayName == "" {
		displayName = user.Username
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $3, now(), now())
		 ON CONFLICT (id) DO UPDATE SET
		   username = excluded.username,
		   display_name = excluded.display_name,
		   updated_at = now()`,
		user.ID,
		user.Username,
		displayName,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 0, now())
		 ON CONFLICT (user_id) DO NOTHING`,
		user.ID,
	)
	return err
}

func grantRewardPoints(ctx context.Context, tx pgx.Tx, userID int64, points int64, description string) error {
	var balance int64
	if err := tx.QueryRow(ctx,
		`SELECT balance FROM point_accounts WHERE user_id = $1 FOR UPDATE`,
		userID,
	).Scan(&balance); err != nil {
		return err
	}
	nextBalance := balance + points
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		userID,
	); err != nil {
		return err
	}
	_, err := tx.Exec(ctx,
		`INSERT INTO point_ledger (id, user_id, amount, source, description, balance_after, created_at)
		 VALUES ($1, $2, $3, 'reward_claim', $4, $5, now())`,
		randomID(),
		userID,
		points,
		description,
		nextBalance,
	)
	return err
}

func (service *Service) ensureRewardUserAccount(ctx context.Context, user auth.User) error {
	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := ensureRewardUser(ctx, tx, user); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func parseRewardNotificationData(raw []byte) (rewardNotificationData, error) {
	var data rewardNotificationData
	if len(raw) == 0 || string(raw) == "null" {
		return data, ErrInvalidRewardData
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return data, ErrInvalidRewardData
	}
	data.RewardBatchID = strings.TrimSpace(data.RewardBatchID)
	data.RewardType = strings.TrimSpace(data.RewardType)
	if data.RewardBatchID == "" || !isRewardType(data.RewardType) {
		return data, ErrInvalidRewardData
	}
	if _, ok := positiveDecimalStringFromRaw(data.RewardAmount); !ok {
		return data, ErrInvalidRewardData
	}
	return data, nil
}

func positiveDecimalStringFromRaw(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", false
	}
	var asNumber json.Number
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&asNumber); err == nil {
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

func integerAmount(raw string) (int64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 || value != math.Trunc(value) {
		return 0, false
	}
	if value > float64(math.MaxInt64) {
		return 0, false
	}
	return int64(value), true
}

func floatAmount(raw string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0, false
	}
	return value, true
}

func isRewardType(value string) bool {
	return value == "points" || value == "quota"
}

func fallbackMessage(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func millisToTime(millis int64) time.Time {
	if millis <= 0 {
		return time.Now().UTC()
	}
	return time.UnixMilli(millis).UTC()
}

func randomID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer[:])
}
