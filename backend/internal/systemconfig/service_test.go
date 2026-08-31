package systemconfig

import "testing"

func TestValidatorsAcceptBoundariesAndRejectOutOfRange(t *testing.T) {
	cases := []struct {
		name  string
		valid func(int64) bool
		low   int64
		high  int64
	}{
		{"dailyWithdrawLimit", ValidDailyWithdrawLimit, MinDailyWithdrawLimit, MaxDailyWithdrawLimit},
		{"vipDailyWithdrawLimit", ValidVIPDailyWithdrawLimit, MinDailyWithdrawLimit, MaxDailyWithdrawLimit},
		{"vipPricePoints", ValidVIPPricePoints, MinVIPPricePoints, MaxVIPPricePoints},
		{"vipDurationDays", ValidVIPDurationDays, MinVIPDurationDays, MaxVIPDurationDays},
		{"vipWithdrawFeePercent", ValidVIPWithdrawFeePercent, MinVIPWithdrawFeePercent, MaxVIPWithdrawFeePercent},
		{"vipDailyLotterySpins", ValidVIPDailyLotterySpins, MinVIPDailyLotterySpins, MaxVIPDailyLotterySpins},
		{"vipMaxTotalDays", ValidVIPMaxTotalDays, MinVIPMaxTotalDays, MaxVIPMaxTotalDays},
		{"withdrawBalanceCapDollars", ValidWithdrawBalanceCapDollars, MinWithdrawBalanceCapDollars, MaxWithdrawBalanceCapDollars},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.valid(tt.low) || !tt.valid(tt.high) {
				t.Fatalf("boundaries %d/%d should be valid", tt.low, tt.high)
			}
			if tt.valid(tt.low-1) || tt.valid(tt.high+1) {
				t.Fatalf("out-of-range values %d/%d should be invalid", tt.low-1, tt.high+1)
			}
		})
	}
}

func TestValidVIPDurationAgainstMaxTotal(t *testing.T) {
	// 上限小于月卡时长时，用户第一次购买就会被拒，功能不可用
	if ValidVIPDurationAgainstMaxTotal(30, 20) {
		t.Fatal("max < duration should be invalid")
	}
	// 相等是允许的：恰好只能买一次
	if !ValidVIPDurationAgainstMaxTotal(30, 30) {
		t.Fatal("max == duration should be valid")
	}
	if !ValidVIPDurationAgainstMaxTotal(30, 365) {
		t.Fatal("max > duration should be valid")
	}
}

func TestDefaultsSatisfyTheirOwnValidators(t *testing.T) {
	if !ValidDailyPointsLimit(DefaultDailyPointsLimit) ||
		!ValidDailyWithdrawLimit(DefaultDailyWithdrawLimit) ||
		!ValidVIPDailyWithdrawLimit(DefaultVIPDailyWithdrawLimit) ||
		!ValidVIPPricePoints(DefaultVIPPricePoints) ||
		!ValidVIPDurationDays(DefaultVIPDurationDays) ||
		!ValidVIPWithdrawFeePercent(DefaultVIPWithdrawFeePercent) ||
		!ValidVIPDailyLotterySpins(DefaultVIPDailyLotterySpins) ||
		!ValidVIPMaxTotalDays(DefaultVIPMaxTotalDays) ||
		!ValidWithdrawBalanceCapDollars(DefaultWithdrawBalanceCapDollars) {
		t.Fatal("every default value must satisfy its own validator")
	}
	if !ValidVIPDurationAgainstMaxTotal(DefaultVIPDurationDays, DefaultVIPMaxTotalDays) {
		t.Fatal("default duration/max pair must be valid")
	}
}
