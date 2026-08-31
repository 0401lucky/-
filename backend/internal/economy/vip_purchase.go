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
// 对齐，但这个对齐是有前提的：SQL 侧算出的是带 days 分量的 interval，而 PostgreSQL
// 对 timestamptz + interval 的 days 分量是按会话 TimeZone 的日历日推进、保持当地钟面
// 时刻不变 —— 也就是说 SQL 侧本身就是日历日语义，只有当数据库会话时区无 DST 时，
// 它才与这里的固定 24h 等价（否则跨 DST 切换时反倒是 Go 侧会差一小时）。
// 部署时区 UTC / Asia/Shanghai（后者自 1991 年起无 DST）满足这一前提。
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
		// output 在闭包外声明、跨重试复用，这里必须先清零：beginIdempotency 回放时走
		// json.Unmarshal，而 Unmarshal 不会清零 JSON 里缺席的字段。Code 带 omitempty，
		// 成功结果序列化后不含 code 键 —— 不清零就可能返回「成功但带着上一轮的拒绝码」。
		output = PurchaseVIPResult{}
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

		// 上限校验必须落在同一用户的串行化区间之内 —— 顺序不能颠倒。
		// vip.Extend 是累加语义：校验若落在全部 per-user 行锁之外，两个并发请求会
		// 各自读到同一个旧到期时间、各自算出「再加一个周期不超限」，执行后却累加了
		// 两个周期。
		//
		// 本事务有两道 per-user 行锁，校验排在它们之后：
		//  1. 上面的 ensureUser：INSERT INTO users ... ON CONFLICT (id) DO UPDATE
		//     （service.go:477）会以 FOR UPDATE 强度锁住 users 行并持有到事务结束。
		//     这是先到的一道，实际把并发购买串起来的就是它。（它的第二条语句
		//     point_accounts ... ON CONFLICT DO NOTHING 不加锁，承重的只有 users
		//     那条 upsert。）
		//  2. 下面的 getBalanceForUpdate：SELECT ... FOR UPDATE，扣分依赖的那一道。
		//
		// 改动其中任何一道之前，先确认另一道仍然覆盖本次校验。尤其当心 ensureUser：
		// 它名字上只是「确保用户存在」，很容易被当成无关紧要的前置步骤挪到校验之后，
		// 或被改成 ON CONFLICT DO NOTHING / 先 SELECT 再决定 INSERT 这类不取锁的形式。
		// 变异实验佐证：把本段校验挪到 getBalanceForUpdate 之前，
		// TestPurchaseVIPConcurrentDistinctKeysRespectCeiling 仍然通过（ensureUser 兜住了）；
		// 挪到 ensureUser 之前才变红，到期时间超上限约 8 个月。
		//
		// 幂等键替代不了行锁：两个携带不同幂等键的请求是两笔各自合法的购买。
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
