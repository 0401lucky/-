package economy

import (
	"testing"
	"time"
)

func TestVIPPurchaseWindowStartsFromNowWithoutMembership(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)

	newExpiresAt, ceiling := vipPurchaseWindow(now, time.Time{}, false, 30, 365)

	if want := now.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
	if want := now.Add(365 * 24 * time.Hour); !ceiling.Equal(want) {
		t.Fatalf("ceiling = %v, want %v", ceiling, want)
	}
	if newExpiresAt.After(ceiling) {
		t.Fatal("first purchase should never exceed the ceiling under default config")
	}
}

func TestVIPPurchaseWindowAccumulatesFromUnexpiredMembership(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	current := now.Add(10 * 24 * time.Hour)

	newExpiresAt, _ := vipPurchaseWindow(now, current, true, 30, 365)

	if want := current.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
}

func TestVIPPurchaseWindowRestartsFromNowWhenExpired(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	expired := now.Add(-10 * 24 * time.Hour)

	newExpiresAt, _ := vipPurchaseWindow(now, expired, true, 30, 365)

	if want := now.Add(30 * 24 * time.Hour); !newExpiresAt.Equal(want) {
		t.Fatalf("newExpiresAt = %v, want %v", newExpiresAt, want)
	}
}

func TestVIPPurchaseWindowAllowsExactCeiling(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	// 剩余 335 天 + 月卡 30 天 = 365 天，恰好等于上限，应当允许
	current := now.Add(335 * 24 * time.Hour)

	newExpiresAt, ceiling := vipPurchaseWindow(now, current, true, 30, 365)

	if newExpiresAt.After(ceiling) {
		t.Fatalf("exact ceiling must be allowed: newExpiresAt=%v ceiling=%v", newExpiresAt, ceiling)
	}
}

func TestVIPPurchaseWindowRejectsOverCeiling(t *testing.T) {
	now := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	// 剩余 336 天 + 30 天 = 366 天 > 365
	current := now.Add(336 * 24 * time.Hour)

	newExpiresAt, ceiling := vipPurchaseWindow(now, current, true, 30, 365)

	if !newExpiresAt.After(ceiling) {
		t.Fatalf("over-ceiling purchase must be rejected: newExpiresAt=%v ceiling=%v", newExpiresAt, ceiling)
	}
}
