package economy

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"

	"github.com/jackc/pgx/v5"
)

// CodeWithdrawDailyLimit 标识「今日提现次数已用完」。
const CodeWithdrawDailyLimit = "WITHDRAW_DAILY_LIMIT"

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
func (service *Service) markWithdrawUsed(ctx context.Context, userID int64, withdrawDate string, fallback int64) int64 {
	used, err := service.bumpWithdrawUsedToday(ctx, userID, withdrawDate)
	if err != nil {
		slog.Warn("提现每日次数计数写入失败", "userId", userID, "withdrawDate", withdrawDate, "error", err)
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
