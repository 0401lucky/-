package notifications

import (
	"context"
	"errors"
	"testing"
)

func TestCountUnreadReturnsUnavailableWithoutDatabase(t *testing.T) {
	service := NewService(nil)

	_, err := service.CountUnread(context.Background(), 1001)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", err)
	}
}
