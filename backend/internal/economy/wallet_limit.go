package economy

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"

	"github.com/jackc/pgx/v5"
)

// CodeWithdrawDailyLimit 标识「今日提现次数已用完」。
const CodeWithdrawDailyLimit = "WITHDRAW_DAILY_LIMIT"

// CodeWithdrawBalanceCap 标识「账户额度余额已达封顶线，禁止继续提现」。
const CodeWithdrawBalanceCap = "WITHDRAW_BALANCE_CAP"

// CodeWithdrawBalanceUnknown 标识「账户额度余额查不到，无法校验封顶线」。
const CodeWithdrawBalanceUnknown = "WITHDRAW_BALANCE_UNKNOWN"

// 计数只是一条本地 UPSERT，不该共用提现主流程那份可能已被 new-api 耗尽的预算。
const withdrawCountTimeout = 5 * time.Second

// WithdrawDailyUsage 描述用户今日的提现次数配额，供钱包页展示。
type WithdrawDailyUsage struct {
	Used      int64 `json:"used"`
	Limit     int64 `json:"limit"`
	Remaining int64 `json:"remaining"`
	ResetAtMs int64 `json:"resetAtMs"` // 中国时区次日 0 点
}

func chinaZone() *time.Location {
	return time.FixedZone("CST", 8*60*60)
}

// nextChinaMidnightMillis 返回中国时区次日 0 点的毫秒时间戳，与 todayChina 的日期口径一致。
func nextChinaMidnightMillis(now time.Time) int64 {
	local := now.In(chinaZone())
	next := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, chinaZone())
	return next.UnixMilli()
}

func withdrawDailyLimitFor(config systemconfig.Config, vipActive bool) int64 {
	if vipActive {
		return config.VIPDailyWithdrawLimit
	}
	return config.DailyWithdrawLimit
}

func withdrawFeePercentFor(config systemconfig.Config, vipActive bool) int64 {
	if vipActive {
		return config.VIPWithdrawFeePercent
	}
	return 100
}

// checkWithdrawBalanceCap 判断账户额度（new-api）余额是否已达封顶线。
//
// 比较用整数美元（QuotaToWholeDollars 的 floor 值）而不是 BalanceDollars：
// 后者经过两位四舍五入，$9999.996 会被抬成 10000.00，把还没到顶的用户误拦。
//
// VIP 与管理员都不豁免：这是控制 new-api 成本敞口的闸门，与提现次数限制同一立场。
func checkWithdrawBalanceCap(balanceWholeDollars int64, capDollars int64) (bool, string) {
	if balanceWholeDollars < capDollars {
		return false, ""
	}
	return true, fmt.Sprintf(
		"账户额度余额已达上限 $%d，暂不能继续提现，请先消耗额度后再试",
		capDollars,
	)
}

type withdrawLimitQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// countWithdrawUsedToday 读取今日已用提现次数，无记录视为 0。
func countWithdrawUsedToday(ctx context.Context, querier withdrawLimitQuerier, userID int64, withdrawDate string) (int64, error) {
	var used int64
	err := querier.QueryRow(ctx,
		`SELECT used_count FROM wallet_daily_withdrawals
		  WHERE user_id = $1 AND withdraw_date = $2`,
		userID, withdrawDate,
	).Scan(&used)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return used, err
}

// bumpWithdrawUsedToday 把今日计数加一并返回加后的值。
func (service *Service) bumpWithdrawUsedToday(ctx context.Context, userID int64, withdrawDate string) (int64, error) {
	var used int64
	err := service.db.QueryRow(ctx,
		`INSERT INTO wallet_daily_withdrawals (user_id, withdraw_date, used_count, updated_at)
		 VALUES ($1, $2, 1, now())
		 ON CONFLICT (user_id, withdraw_date) DO UPDATE SET
		   used_count = wallet_daily_withdrawals.used_count + 1,
		   updated_at = now()
		 RETURNING used_count`,
		userID, withdrawDate,
	).Scan(&used)
	return used, err
}

// markWithdrawUsed 在提现产生副作用后计数。
//
// 写入失败只告警不回滚：资金操作已经完成，为一次计数失败而回滚会造成更严重的
// 不一致。代价是极端情况下用户当日可能多提现一次，可接受。
//
// 计数用自己的 context：提现主流程那份 55s 预算可能已被 new-api 入账耗尽，
// 复用它会让计数在「入账慢」这一最需要计数的场景下必然失败。
func (service *Service) markWithdrawUsed(ctx context.Context, userID int64, withdrawDate string, transactionID string, fallback int64) int64 {
	countCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), withdrawCountTimeout)
	defer cancel()

	used, err := service.bumpWithdrawUsedToday(countCtx, userID, withdrawDate)
	if err != nil {
		slog.Warn("提现每日次数计数写入失败",
			"userId", userID,
			"withdrawDate", withdrawDate,
			"walletTransactionId", transactionID,
			"error", err,
		)
		return fallback + 1
	}
	return used
}

// GetWithdrawDailyUsage 只读查询今日提现配额，供 GET /api/wallet 展示。
func (service *Service) GetWithdrawDailyUsage(ctx context.Context, userID int64) (WithdrawDailyUsage, error) {
	config, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return WithdrawDailyUsage{}, err
	}
	status, err := vip.Get(ctx, service.db, userID)
	if err != nil {
		return WithdrawDailyUsage{}, err
	}
	used, err := countWithdrawUsedToday(ctx, service.db, userID, todayChina())
	if err != nil {
		return WithdrawDailyUsage{}, err
	}

	limit := withdrawDailyLimitFor(config, status.Active)
	return WithdrawDailyUsage{
		Used:      used,
		Limit:     limit,
		Remaining: maxInt64(0, limit-used),
		ResetAtMs: nextChinaMidnightMillis(time.Now()),
	}, nil
}
