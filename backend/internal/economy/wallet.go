package economy

import (
	"fmt"
	"math"
)

const (
	PointsPerDollar   = int64(10)
	MinWithdrawPoints = int64(10)
	MinTopupDollars   = int64(1)
)

type WithdrawTier struct {
	Min  int64
	Rate float64
}

var withdrawFeeTiers = []WithdrawTier{
	{Min: 10000, Rate: 0.01},
	{Min: 1000, Rate: 0.02},
	{Min: 100, Rate: 0.03},
	{Min: MinWithdrawPoints, Rate: 0.05},
}

type WithdrawPreview struct {
	OK        bool    `json:"ok"`
	Message   string  `json:"message,omitempty"`
	Deducted  int64   `json:"deducted"`
	FeePoints int64   `json:"feePoints"`
	NetPoints int64   `json:"netPoints"`
	FeeRate   float64 `json:"feeRate"`
	Dollars   float64 `json:"dollars"`
}

type TopupPreview struct {
	OK           bool   `json:"ok"`
	Message      string `json:"message,omitempty"`
	SpentDollars int64  `json:"spentDollars"`
	PointsGained int64  `json:"pointsGained"`
}

type WithdrawResult struct {
	Success   bool    `json:"success"`
	Message   string  `json:"message"`
	Balance   int64   `json:"balance,omitempty"`
	Dollars   float64 `json:"dollars,omitempty"`
	FeePoints int64   `json:"feePoints,omitempty"`
	Uncertain bool    `json:"uncertain,omitempty"`
}

type TopupResult struct {
	Success                   bool    `json:"success"`
	Message                   string  `json:"message"`
	Balance                   int64   `json:"balance,omitempty"`
	PointsGained              int64   `json:"pointsGained,omitempty"`
	NewAPIBalanceDollars      float64 `json:"newApiBalanceDollars,omitempty"`
	NewAPIBalanceWholeDollars int64   `json:"newApiBalanceWholeDollars,omitempty"`
	Uncertain                 bool    `json:"uncertain,omitempty"`
}

const (
	WalletOperationWithdraw = "withdraw"
	WalletOperationTopup    = "topup"

	WalletStatusPending   = "pending"
	WalletStatusSuccess   = "success"
	WalletStatusFailed    = "failed"
	WalletStatusUncertain = "uncertain"
)

type WalletTransaction struct {
	ID                        string   `json:"id"`
	UserID                    int64    `json:"userId"`
	Operation                 string   `json:"operation"`
	Status                    string   `json:"status"`
	PointsDelta               int64    `json:"pointsDelta"`
	DollarsDelta              float64  `json:"dollarsDelta"`
	RequestedPoints           *int64   `json:"requestedPoints,omitempty"`
	RequestedDollars          *float64 `json:"requestedDollars,omitempty"`
	FeePoints                 *int64   `json:"feePoints,omitempty"`
	NetPoints                 *int64   `json:"netPoints,omitempty"`
	Message                   string   `json:"message"`
	NewAPIQuota               *int64   `json:"newApiQuota,omitempty"`
	NewAPIUsedQuota           *int64   `json:"newApiUsedQuota,omitempty"`
	NewAPIBalanceDollars      *float64 `json:"newApiBalanceDollars,omitempty"`
	NewAPIBalanceWholeDollars *int64   `json:"newApiBalanceWholeDollars,omitempty"`
	CreatedAt                 int64    `json:"createdAt"`
	UpdatedAt                 int64    `json:"updatedAt"`
}

type BeginWalletTransactionInput struct {
	UserID           int64
	Operation        string
	PointsDelta      int64
	DollarsDelta     float64
	RequestedPoints  *int64
	RequestedDollars *float64
	FeePoints        *int64
	NetPoints        *int64
	Message          string
}

type UpdateWalletTransactionInput struct {
	ID                        string
	Status                    string
	Message                   string
	NewAPIQuota               *int64
	NewAPIUsedQuota           *int64
	NewAPIBalanceDollars      *float64
	NewAPIBalanceWholeDollars *int64
}

func GetWithdrawFeeRate(points int64) float64 {
	for _, tier := range withdrawFeeTiers {
		if points >= tier.Min {
			return tier.Rate
		}
	}
	return 0
}

func PreviewWithdraw(points int64) WithdrawPreview {
	if points <= 0 {
		return WithdrawPreview{Message: "积分数量必须为正整数"}
	}
	if points < MinWithdrawPoints {
		return WithdrawPreview{Message: fmt.Sprintf("最低提现 %d 积分", MinWithdrawPoints)}
	}

	feeRate := GetWithdrawFeeRate(points)
	feePoints := int64(math.Ceil(float64(points) * feeRate))
	netPoints := maxInt64(0, points-feePoints)
	dollars := math.Round((float64(netPoints)/float64(PointsPerDollar))*100) / 100

	return WithdrawPreview{
		OK:        true,
		Deducted:  points,
		FeePoints: feePoints,
		NetPoints: netPoints,
		FeeRate:   feeRate,
		Dollars:   dollars,
	}
}

func PreviewTopup(dollars float64) TopupPreview {
	if !isFinitePositive(dollars) {
		return TopupPreview{Message: "充值金额必须为正数"}
	}

	spentDollars := int64(math.Floor(dollars))
	if spentDollars < MinTopupDollars {
		return TopupPreview{Message: fmt.Sprintf("最低充值 $%d", MinTopupDollars)}
	}
	if spentDollars > math.MaxInt64/PointsPerDollar {
		return TopupPreview{Message: "充值金额过大，请减少金额后重试"}
	}

	return TopupPreview{
		OK:           true,
		SpentDollars: spentDollars,
		PointsGained: spentDollars * PointsPerDollar,
	}
}

func isFinitePositive(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value > 0
}
