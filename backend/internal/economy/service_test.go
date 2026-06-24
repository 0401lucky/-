package economy

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSafeMulDetectsOverflow(t *testing.T) {
	if value, ok := safeMul(900, 3); !ok || value != 2700 {
		t.Fatalf("expected 2700 without overflow, got value=%d ok=%v", value, ok)
	}
	if _, ok := safeMul(1<<62, 8); ok {
		t.Fatalf("expected overflow to be rejected")
	}
}

func TestDefaultStoreItemsKeepExistingPrices(t *testing.T) {
	byID := map[string]defaultItem{}
	for _, item := range defaultItems {
		byID[item.ID] = item
	}

	if byID["card-draw-1"].PointsCost != 900 {
		t.Fatalf("card draw price drifted: %d", byID["card-draw-1"].PointsCost)
	}
	if byID["makeup-card-1"].PointsCost != 30 {
		t.Fatalf("makeup card price drifted: %d", byID["makeup-card-1"].PointsCost)
	}
	if byID["lottery-spin-1"].DailyLimit == nil || *byID["lottery-spin-1"].DailyLimit != 1 {
		t.Fatalf("lottery-spin-1 should keep daily limit 1")
	}
}

func TestIsRetryableTxError(t *testing.T) {
	if !isRetryableTxError(&pgconn.PgError{Code: "40001"}) {
		t.Fatalf("serialization failures should be retryable")
	}
	if !isRetryableTxError(&pgconn.PgError{Code: "40P01"}) {
		t.Fatalf("deadlocks should be retryable")
	}
	if isRetryableTxError(&pgconn.PgError{Code: "23505"}) {
		t.Fatalf("unique violations should not be retried")
	}
	if isRetryableTxError(errors.New("plain error")) {
		t.Fatalf("plain errors should not be retried")
	}
}
