package systemconfig

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable = errors.New("system config database unavailable")
	ErrInvalid     = errors.New("system config invalid")
)

const (
	DefaultDailyPointsLimit = int64(5000)
	MinDailyPointsLimit     = int64(100)
	MaxDailyPointsLimit     = int64(100000)
)

const (
	DefaultDailyWithdrawLimit    = int64(4)
	DefaultVIPDailyWithdrawLimit = int64(8)
	MinDailyWithdrawLimit        = int64(1)
	MaxDailyWithdrawLimit        = int64(100)

	DefaultVIPPricePoints = int64(3000)
	MinVIPPricePoints     = int64(1)
	MaxVIPPricePoints     = int64(1000000)

	DefaultVIPDurationDays = int64(30)
	MinVIPDurationDays     = int64(1)
	MaxVIPDurationDays     = int64(365)

	DefaultVIPWithdrawFeePercent = int64(50)
	MinVIPWithdrawFeePercent     = int64(0)
	MaxVIPWithdrawFeePercent     = int64(100)

	DefaultVIPDailyLotterySpins = int64(2)
	MinVIPDailyLotterySpins     = int64(0)
	MaxVIPDailyLotterySpins     = int64(50)

	DefaultVIPMaxTotalDays = int64(365)
	MinVIPMaxTotalDays     = int64(1)
	MaxVIPMaxTotalDays     = int64(3650)
)

type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Config struct {
	DailyPointsLimit      int64   `json:"dailyPointsLimit"`
	DailyWithdrawLimit    int64   `json:"dailyWithdrawLimit"`
	VIPDailyWithdrawLimit int64   `json:"vipDailyWithdrawLimit"`
	VIPPricePoints        int64   `json:"vipPricePoints"`
	VIPDurationDays       int64   `json:"vipDurationDays"`
	VIPWithdrawFeePercent int64   `json:"vipWithdrawFeePercent"`
	VIPDailyLotterySpins  int64   `json:"vipDailyLotterySpins"`
	VIPMaxTotalDays       int64   `json:"vipMaxTotalDays"`
	UpdatedAt             *int64  `json:"updatedAt,omitempty"`
	UpdatedBy             *string `json:"updatedBy,omitempty"`
}

// UpdateInput 的每个字段为 nil 时会被重置为默认值，不是「保持原值」。
// 调用方必须一次性提交全部字段，漏传的字段会被静默重置。
type UpdateInput struct {
	DailyPointsLimit      *int64
	DailyWithdrawLimit    *int64
	VIPDailyWithdrawLimit *int64
	VIPPricePoints        *int64
	VIPDurationDays       *int64
	VIPWithdrawFeePercent *int64
	VIPDailyLotterySpins  *int64
	VIPMaxTotalDays       *int64
	UpdatedBy             string
	Now                   time.Time
}

type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, now: time.Now}
}

func NewServiceWithNow(db *pgxpool.Pool, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

func (service *Service) Get(ctx context.Context) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}
	return Get(ctx, service.db)
}

func (service *Service) Update(ctx context.Context, input UpdateInput) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}

	// nil 一律归一化为默认值，再统一校验。
	limit := valueOrDefault(input.DailyPointsLimit, DefaultDailyPointsLimit)
	withdrawLimit := valueOrDefault(input.DailyWithdrawLimit, DefaultDailyWithdrawLimit)
	vipWithdrawLimit := valueOrDefault(input.VIPDailyWithdrawLimit, DefaultVIPDailyWithdrawLimit)
	vipPrice := valueOrDefault(input.VIPPricePoints, DefaultVIPPricePoints)
	vipDuration := valueOrDefault(input.VIPDurationDays, DefaultVIPDurationDays)
	vipFeePercent := valueOrDefault(input.VIPWithdrawFeePercent, DefaultVIPWithdrawFeePercent)
	vipLotterySpins := valueOrDefault(input.VIPDailyLotterySpins, DefaultVIPDailyLotterySpins)
	vipMaxTotalDays := valueOrDefault(input.VIPMaxTotalDays, DefaultVIPMaxTotalDays)

	if !ValidDailyPointsLimit(limit) ||
		!ValidDailyWithdrawLimit(withdrawLimit) ||
		!ValidVIPDailyWithdrawLimit(vipWithdrawLimit) ||
		!ValidVIPPricePoints(vipPrice) ||
		!ValidVIPDurationDays(vipDuration) ||
		!ValidVIPWithdrawFeePercent(vipFeePercent) ||
		!ValidVIPDailyLotterySpins(vipLotterySpins) ||
		!ValidVIPMaxTotalDays(vipMaxTotalDays) ||
		!ValidVIPDurationAgainstMaxTotal(vipDuration, vipMaxTotalDays) {
		return Config{}, ErrInvalid
	}

	now := input.Now
	if now.IsZero() {
		now = service.now()
	}
	nowMs := now.UnixMilli()
	_, err := service.db.Exec(ctx,
		`INSERT INTO system_config (
		   id, daily_points_limit, daily_withdraw_limit, vip_daily_withdraw_limit,
		   vip_price_points, vip_duration_days, vip_withdraw_fee_percent,
		   vip_daily_lottery_spins, vip_max_total_days,
		   updated_at_ms, updated_by, updated_at
		 )
		 VALUES ('system', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		 ON CONFLICT (id) DO UPDATE SET
		   daily_points_limit = excluded.daily_points_limit,
		   daily_withdraw_limit = excluded.daily_withdraw_limit,
		   vip_daily_withdraw_limit = excluded.vip_daily_withdraw_limit,
		   vip_price_points = excluded.vip_price_points,
		   vip_duration_days = excluded.vip_duration_days,
		   vip_withdraw_fee_percent = excluded.vip_withdraw_fee_percent,
		   vip_daily_lottery_spins = excluded.vip_daily_lottery_spins,
		   vip_max_total_days = excluded.vip_max_total_days,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by,
		   updated_at = now()`,
		limit, withdrawLimit, vipWithdrawLimit, vipPrice, vipDuration,
		vipFeePercent, vipLotterySpins, vipMaxTotalDays,
		nowMs, emptyStringToNil(input.UpdatedBy),
	)
	if err != nil {
		return Config{}, err
	}
	return Get(ctx, service.db)
}

func valueOrDefault(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}

func Get(ctx context.Context, queryer QueryRower) (Config, error) {
	config := defaultConfig()
	var updatedBy *string
	var updatedAt int64
	err := queryer.QueryRow(ctx,
		`SELECT daily_points_limit, daily_withdraw_limit, vip_daily_withdraw_limit,
		        vip_price_points, vip_duration_days, vip_withdraw_fee_percent,
		        vip_daily_lottery_spins, vip_max_total_days,
		        updated_at_ms, updated_by
		   FROM system_config
		  WHERE id = 'system'`,
	).Scan(
		&config.DailyPointsLimit,
		&config.DailyWithdrawLimit,
		&config.VIPDailyWithdrawLimit,
		&config.VIPPricePoints,
		&config.VIPDurationDays,
		&config.VIPWithdrawFeePercent,
		&config.VIPDailyLotterySpins,
		&config.VIPMaxTotalDays,
		&updatedAt,
		&updatedBy,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return config, nil
	}
	if err != nil {
		return Config{}, err
	}

	// 任一列越界都回落到默认值，避免脏数据把下游算崩。
	fallbacks := defaultConfig()
	if !ValidDailyPointsLimit(config.DailyPointsLimit) {
		config.DailyPointsLimit = fallbacks.DailyPointsLimit
	}
	if !ValidDailyWithdrawLimit(config.DailyWithdrawLimit) {
		config.DailyWithdrawLimit = fallbacks.DailyWithdrawLimit
	}
	if !ValidVIPDailyWithdrawLimit(config.VIPDailyWithdrawLimit) {
		config.VIPDailyWithdrawLimit = fallbacks.VIPDailyWithdrawLimit
	}
	if !ValidVIPPricePoints(config.VIPPricePoints) {
		config.VIPPricePoints = fallbacks.VIPPricePoints
	}
	if !ValidVIPDurationDays(config.VIPDurationDays) {
		config.VIPDurationDays = fallbacks.VIPDurationDays
	}
	if !ValidVIPWithdrawFeePercent(config.VIPWithdrawFeePercent) {
		config.VIPWithdrawFeePercent = fallbacks.VIPWithdrawFeePercent
	}
	if !ValidVIPDailyLotterySpins(config.VIPDailyLotterySpins) {
		config.VIPDailyLotterySpins = fallbacks.VIPDailyLotterySpins
	}
	if !ValidVIPMaxTotalDays(config.VIPMaxTotalDays) {
		config.VIPMaxTotalDays = fallbacks.VIPMaxTotalDays
	}
	if !ValidVIPDurationAgainstMaxTotal(config.VIPDurationDays, config.VIPMaxTotalDays) {
		config.VIPDurationDays = fallbacks.VIPDurationDays
		config.VIPMaxTotalDays = fallbacks.VIPMaxTotalDays
	}

	if updatedAt > 1 {
		config.UpdatedAt = &updatedAt
	}
	config.UpdatedBy = updatedBy
	return config, nil
}

func defaultConfig() Config {
	return Config{
		DailyPointsLimit:      DefaultDailyPointsLimit,
		DailyWithdrawLimit:    DefaultDailyWithdrawLimit,
		VIPDailyWithdrawLimit: DefaultVIPDailyWithdrawLimit,
		VIPPricePoints:        DefaultVIPPricePoints,
		VIPDurationDays:       DefaultVIPDurationDays,
		VIPWithdrawFeePercent: DefaultVIPWithdrawFeePercent,
		VIPDailyLotterySpins:  DefaultVIPDailyLotterySpins,
		VIPMaxTotalDays:       DefaultVIPMaxTotalDays,
	}
}

func DailyPointsLimit(ctx context.Context, queryer QueryRower) (int64, error) {
	config, err := Get(ctx, queryer)
	if err != nil {
		return 0, err
	}
	return config.DailyPointsLimit, nil
}

func ValidDailyPointsLimit(limit int64) bool {
	return limit >= MinDailyPointsLimit && limit <= MaxDailyPointsLimit
}

func ValidDailyWithdrawLimit(limit int64) bool {
	return limit >= MinDailyWithdrawLimit && limit <= MaxDailyWithdrawLimit
}

func ValidVIPDailyWithdrawLimit(limit int64) bool {
	return limit >= MinDailyWithdrawLimit && limit <= MaxDailyWithdrawLimit
}

func ValidVIPPricePoints(points int64) bool {
	return points >= MinVIPPricePoints && points <= MaxVIPPricePoints
}

func ValidVIPDurationDays(days int64) bool {
	return days >= MinVIPDurationDays && days <= MaxVIPDurationDays
}

func ValidVIPWithdrawFeePercent(percent int64) bool {
	return percent >= MinVIPWithdrawFeePercent && percent <= MaxVIPWithdrawFeePercent
}

func ValidVIPDailyLotterySpins(spins int64) bool {
	return spins >= MinVIPDailyLotterySpins && spins <= MaxVIPDailyLotterySpins
}

func ValidVIPMaxTotalDays(days int64) bool {
	return days >= MinVIPMaxTotalDays && days <= MaxVIPMaxTotalDays
}

// ValidVIPDurationAgainstMaxTotal 校验累计时长上限不低于月卡时长。
// 若上限更小，非 VIP 用户第一次购买就会被上限拒绝（0 + 时长 > 上限），功能直接不可用。
func ValidVIPDurationAgainstMaxTotal(durationDays int64, maxTotalDays int64) bool {
	return maxTotalDays >= durationDays
}

func emptyStringToNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
