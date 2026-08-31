package economy

import (
	"context"
	"fmt"
	"time"

	"redemption/backend/internal/systemconfig"
	"redemption/backend/internal/vip"
)

// WalletVIPBenefits 恒定下发（无论用户是否 VIP），用于非 VIP 用户看到「开通后能得到什么」。
type WalletVIPBenefits struct {
	DailyWithdrawLimit int64 `json:"dailyWithdrawLimit"`
	WithdrawFeePercent int64 `json:"withdrawFeePercent"`
	DailyLotterySpins  int64 `json:"dailyLotterySpins"`
}

type WalletVIPView struct {
	Active       bool   `json:"active"`
	ExpiresAt    *int64 `json:"expiresAt,omitempty"` // 毫秒；从未购买过时省略
	PricePoints  int64  `json:"pricePoints"`
	DurationDays int64  `json:"durationDays"`
	MaxTotalDays int64  `json:"maxTotalDays"`
	// CanPurchase 只反映累计时长上限，不含余额。余额够不够由前端自行比较。
	CanPurchase           bool              `json:"canPurchase"`
	PurchaseBlockedReason string            `json:"purchaseBlockedReason,omitempty"`
	Benefits              WalletVIPBenefits `json:"benefits"`
}

type WalletOverview struct {
	Balance           int64 `json:"balance"`
	PointsPerDollar   int64 `json:"pointsPerDollar"`
	MinWithdrawPoints int64 `json:"minWithdrawPoints"`
	MinTopupDollars   int64 `json:"minTopupDollars"`
	// FeePercent 是当前用户适用的手续费百分比，非 VIP 为 100。仅供前端预览展示，
	// 后端在实际提现时会重新计算，因此不构成安全面。
	FeePercent    int64              `json:"feePercent"`
	DailyWithdraw WithdrawDailyUsage `json:"dailyWithdraw"`
	VIP           WalletVIPView      `json:"vip"`
}

// GetWalletOverview 聚合钱包页首屏所需的全部本地数据。
// 刻意不查询 new-api：账户额度由前端懒加载 GET /api/store/topup，
// 避免把外部服务调用拖进首屏关键路径。
func (service *Service) GetWalletOverview(ctx context.Context, userID int64) (WalletOverview, error) {
	config, err := systemconfig.Get(ctx, service.db)
	if err != nil {
		return WalletOverview{}, err
	}

	var balance int64
	if err := service.db.QueryRow(ctx,
		`SELECT COALESCE((SELECT balance FROM point_accounts WHERE user_id = $1), 0)`,
		userID,
	).Scan(&balance); err != nil {
		return WalletOverview{}, err
	}

	// 到期时间要参与算术，必须取未截断的 GetExpiry 而不是毫秒精度的 vip.Get。
	currentExpiry, hasMembership, err := vip.GetExpiry(ctx, service.db, userID)
	if err != nil {
		return WalletOverview{}, err
	}

	// 提现配额直接复用 GetWithdrawDailyUsage，不在这里重新组装一份：
	// 重复实现迟早会与限次主流程算出不同的口径。代价是它内部会再查一次
	// system_config 与 vip_memberships，钱包页首屏不是热路径，这个取舍可接受。
	dailyWithdraw, err := service.GetWithdrawDailyUsage(ctx, userID)
	if err != nil {
		return WalletOverview{}, err
	}

	now := time.Now()
	active := hasMembership && currentExpiry.After(now)

	// 与 PurchaseVIP 步骤 5 完全同一套判定，避免前后端各算一遍。
	newExpiresAt, ceiling := vipPurchaseWindow(
		now, currentExpiry, hasMembership,
		config.VIPDurationDays, config.VIPMaxTotalDays,
	)
	canPurchase := !newExpiresAt.After(ceiling)
	blockedReason := ""
	if !canPurchase {
		blockedReason = fmt.Sprintf("VIP 剩余时长已达上限 %d 天，请在临近到期时再购买", config.VIPMaxTotalDays)
	}

	vipView := WalletVIPView{
		Active:                active,
		PricePoints:           config.VIPPricePoints,
		DurationDays:          config.VIPDurationDays,
		MaxTotalDays:          config.VIPMaxTotalDays,
		CanPurchase:           canPurchase,
		PurchaseBlockedReason: blockedReason,
		Benefits: WalletVIPBenefits{
			DailyWithdrawLimit: config.VIPDailyWithdrawLimit,
			WithdrawFeePercent: config.VIPWithdrawFeePercent,
			DailyLotterySpins:  config.VIPDailyLotterySpins,
		},
	}
	if hasMembership {
		milliseconds := currentExpiry.UnixMilli()
		vipView.ExpiresAt = &milliseconds
	}

	return WalletOverview{
		Balance:           balance,
		PointsPerDollar:   PointsPerDollar,
		MinWithdrawPoints: MinWithdrawPoints,
		MinTopupDollars:   MinTopupDollars,
		FeePercent:        withdrawFeePercentFor(config, active),
		DailyWithdraw:     dailyWithdraw,
		VIP:               vipView,
	}, nil
}
