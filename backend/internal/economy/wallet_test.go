package economy

import (
	"math"
	"testing"
)

// walletPreviewVector 是 Go 与 TypeScript 两份实现共用的输入输出向量。
// 修改这里时必须同步修改 src/lib/__tests__/wallet-rules.test.ts 的同名表。
type walletPreviewVector struct {
	name       string
	points     int64
	feePercent int64
	feePoints  int64
	netPoints  int64
	feeRate    float64
	dollars    float64
}

var walletPreviewVectors = []walletPreviewVector{
	{name: "min tier", points: 10, feePercent: 100, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9},
	{name: "hundred tier", points: 100, feePercent: 100, feePoints: 3, netPoints: 97, feeRate: 0.03, dollars: 9.7},
	{name: "thousand tier", points: 1000, feePercent: 100, feePoints: 20, netPoints: 980, feeRate: 0.02, dollars: 98},
	{name: "ten thousand tier", points: 10000, feePercent: 100, feePoints: 100, netPoints: 9900, feeRate: 0.01, dollars: 990},
	{name: "ceil fee", points: 101, feePercent: 100, feePoints: 4, netPoints: 97, feeRate: 0.03, dollars: 9.7},

	// 五折：向上取整让低额提现的折扣不显效，这是既定行为不是缺陷
	{name: "half off min tier stays one", points: 10, feePercent: 50, feePoints: 1, netPoints: 9, feeRate: 0.05, dollars: 0.9},
	{name: "half off hundred tier", points: 100, feePercent: 50, feePoints: 2, netPoints: 98, feeRate: 0.03, dollars: 9.8},
	{name: "half off thousand tier", points: 1000, feePercent: 50, feePoints: 10, netPoints: 990, feeRate: 0.02, dollars: 99},
	{name: "half off ten thousand tier", points: 10000, feePercent: 50, feePoints: 50, netPoints: 9950, feeRate: 0.01, dollars: 995},
	{name: "half off ceil fee", points: 101, feePercent: 50, feePoints: 2, netPoints: 99, feeRate: 0.03, dollars: 9.9},

	// 免手续费
	{name: "zero percent min tier", points: 10, feePercent: 0, feePoints: 0, netPoints: 10, feeRate: 0.05, dollars: 1},
	{name: "zero percent ten thousand tier", points: 10000, feePercent: 0, feePoints: 0, netPoints: 10000, feeRate: 0.01, dollars: 1000},

	// 判别向量：feePercent=28 时被禁的「先除后乘」写法会算出 8，正确的左结合写法算出 7。
	// 这条向量把「两边表达式逐字对齐」从注释约定升级为测试不变量，请勿删除。
	{name: "order sensitive", points: 1250, feePercent: 28, feePoints: 7, netPoints: 1243, feeRate: 0.02, dollars: 124.3},
}

func TestPreviewWithdrawMatchesWalletRules(t *testing.T) {
	for _, tt := range walletPreviewVectors {
		t.Run(tt.name, func(t *testing.T) {
			got := PreviewWithdraw(tt.points, tt.feePercent)
			if !got.OK {
				t.Fatalf("expected ok preview, got %+v", got)
			}
			if got.Deducted != tt.points ||
				got.FeePoints != tt.feePoints ||
				got.NetPoints != tt.netPoints ||
				got.FeeRate != tt.feeRate ||
				got.Dollars != tt.dollars {
				t.Fatalf("unexpected preview: got %+v, want fee=%d net=%d rate=%v dollars=%v",
					got, tt.feePoints, tt.netPoints, tt.feeRate, tt.dollars)
			}
		})
	}
}

func TestPreviewWithdrawRejectsInvalidValues(t *testing.T) {
	for _, points := range []int64{-1, 0, MinWithdrawPoints - 1} {
		if got := PreviewWithdraw(points, 100); got.OK {
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
