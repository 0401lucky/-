package economy

import (
	"context"
	"fmt"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"

	"github.com/jackc/pgx/v5"
)

const (
	CodeInsufficientPoints    = "INSUFFICIENT_POINTS"
	CodeVIPMaxDurationReached = "VIP_MAX_DURATION_REACHED"
)

type PurchaseVIPResult struct {
	Success     bool   `json:"success"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message"`
	Balance     int64  `json:"balance"`
	ExpiresAt   int64  `json:"expiresAt"` // 毫秒
	DaysAdded   int64  `json:"daysAdded"`
	PointsSpent int64  `json:"pointsSpent"`
}

// vipPurchaseWindow 计算本次购买后的到期时间与允许的最晚到期时间。
// newExpiresAt 晚于 ceiling 即为超出累计时长上限；恰好相等是允许的。
//
// 加法统一用固定时长 24h × days，与 vip.Extend 的 SQL（days * INTERVAL '1 day'）
// 对齐。不要改用 AddDate —— 它按日历日推进，在带 DST 的时区会与 SQL 结果差一小时。
func vipPurchaseWindow(
	now time.Time,
	currentExpiry time.Time,
	hasMembership bool,
	durationDays int64,
	maxTotalDays int64,
) (time.Time, time.Time) {
	base := now
	if hasMembership && currentExpiry.After(base) {
		base = currentExpiry
	}
	newExpiresAt := base.Add(time.Duration(durationDays) * 24 * time.Hour)
	ceiling := now.Add(time.Duration(maxTotalDays) * 24 * time.Hour)
	return newExpiresAt, ceiling
}

// PurchaseVIP 用积分购买 VIP 月卡，重复购买时长累加。
//
// 幂等键是必要的：一次购买扣数千积分，网络重试造成的重复扣费代价高。
func (service *Service) PurchaseVIP(ctx context.Context, user auth.User, idempotencyKey string) (PurchaseVIPResult, error) {
	var output PurchaseVIPResult
	err := service.withRetryableTx(ctx, func(tx pgx.Tx) error {
		scope := fmt.Sprintf("vip:purchase:%d", user.ID)
		if ok, err := beginIdempotency(ctx, tx, scope, idempotencyKey, &output); ok || err != nil {
			return err
		}
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}

		config, err := systemconfig.Get(ctx, tx)
		if err != nil {
			return err
		}

		// 先拿 point_accounts 行锁，再做上限校验 —— 顺序不能颠倒。
		// vip.Extend 是累加语义：校验若放在锁外，两个并发请求会各自读到同一个旧
		// 到期时间、各自算出「再加一个周期不超限」，执行后却累加了两个周期。
		// 这把行锁把同一用户的 economy 事务串行化，是上限不被击穿的唯一保证。
		// 幂等键替代不了它：两个携带不同幂等键的请求是两笔各自合法的购买。
		balance, err := getBalanceForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}

		now := time.Now()
		currentExpiry, hasMembership, err := vip.GetExpiry(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		newExpiresAt, ceiling := vipPurchaseWindow(
			now, currentExpiry, hasMembership,
			config.VIPDurationDays, config.VIPMaxTotalDays,
		)
		if newExpiresAt.After(ceiling) {
			output = PurchaseVIPResult{
				Success: false,
				Code:    CodeVIPMaxDurationReached,
				Message: fmt.Sprintf("VIP 剩余时长已达上限 %d 天，请在临近到期时再购买", config.VIPMaxTotalDays),
				Balance: balance,
			}
			return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
		}

		if balance < config.VIPPricePoints {
			output = PurchaseVIPResult{
				Success: false,
				Code:    CodeInsufficientPoints,
				Message: fmt.Sprintf("积分不足，还差 %d 积分", config.VIPPricePoints-balance),
				Balance: balance,
			}
			return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
		}

		nextBalance := balance - config.VIPPricePoints
		if _, err := tx.Exec(ctx,
			`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
			nextBalance, user.ID,
		); err != nil {
			return err
		}
		description := fmt.Sprintf("购买站内 VIP %d 天", config.VIPDurationDays)
		if err := insertPointLog(ctx, tx, user.ID, -config.VIPPricePoints, SourceVIPPurchase, description, nextBalance); err != nil {
			return err
		}

		expiresAtAfter, err := vip.Extend(ctx, tx, user.ID, config.VIPDurationDays, now)
		if err != nil {
			return err
		}

		var expiresAtBefore *time.Time
		if hasMembership {
			expiresAtBefore = &currentExpiry
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO vip_purchases (id, user_id, points_cost, days, expires_at_before, expires_at_after, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, now())`,
			randomID(), user.ID, config.VIPPricePoints, config.VIPDurationDays,
			expiresAtBefore, expiresAtAfter,
		); err != nil {
			return err
		}

		output = PurchaseVIPResult{
			Success: true,
			Message: fmt.Sprintf("已开通 VIP %d 天，到期时间 %s",
				config.VIPDurationDays,
				expiresAtAfter.In(chinaZone()).Format("2006-01-02 15:04"),
			),
			Balance:     nextBalance,
			ExpiresAt:   expiresAtAfter.UnixMilli(),
			DaysAdded:   config.VIPDurationDays,
			PointsSpent: config.VIPPricePoints,
		}
		return completeIdempotency(ctx, tx, scope, idempotencyKey, output)
	})
	return output, err
}
