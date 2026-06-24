package economy

import (
	"math"
	"testing"
)

func TestPreviewWithdrawMatchesWalletRules(t *testing.T) {
	cases := []struct {
		name      string
		points    int64
		feePoints int64
		netPoints int64
		feeRate   float64
		dollars   float64
	}{
		{name: "min tier", points: 10, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9},
		{name: "hundred tier", points: 100, feePoints: 3, netPoints: 97, feeRate: 0.03, dollars: 9.7},
		{name: "thousand tier", points: 1000, feePoints: 20, netPoints: 980, feeRate: 0.02, dollars: 98},
		{name: "ten thousand tier", points: 10000, feePoints: 100, netPoints: 9900, feeRate: 0.01, dollars: 990},
		{name: "ceil fee", points: 101, feePoints: 4, netPoints: 97, feeRate: 0.03, dollars: 9.7},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got := PreviewWithdraw(tt.points)
			if !got.OK {
				t.Fatalf("expected ok preview, got %+v", got)
			}
			if got.Deducted != tt.points ||
				got.FeePoints != tt.feePoints ||
				got.NetPoints != tt.netPoints ||
				got.FeeRate != tt.feeRate ||
				got.Dollars != tt.dollars {
				t.Fatalf("unexpected preview: %+v", got)
			}
		})
	}
}

func TestPreviewWithdrawRejectsInvalidValues(t *testing.T) {
	for _, points := range []int64{-1, 0, MinWithdrawPoints - 1} {
		if got := PreviewWithdraw(points); got.OK {
			t.Fatalf("expected invalid withdraw preview for %d, got %+v", points, got)
		}
	}
}

func TestPreviewTopupMatchesWalletRules(t *testing.T) {
	got := PreviewTopup(3.9)
	if !got.OK {
		t.Fatalf("expected ok preview, got %+v", got)
	}
	if got.SpentDollars != 3 || got.PointsGained != 30 {
		t.Fatalf("unexpected topup preview: %+v", got)
	}
}

func TestPreviewTopupRejectsInvalidValues(t *testing.T) {
	for _, dollars := range []float64{-1, 0, math.NaN(), math.Inf(1)} {
		if got := PreviewTopup(dollars); got.OK {
			t.Fatalf("expected invalid topup preview for %v, got %+v", dollars, got)
		}
	}
}
