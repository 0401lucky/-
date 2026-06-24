package farm

import (
	"encoding/json"
	"time"
)

type StateRecord struct {
	Exists       bool
	UserID       int64
	StateJSON    json.RawMessage
	LastTickAtMs int64
	UpdatedAtMs  int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type DailyPurchase struct {
	UserID        int64
	PurchaseDate  string
	ItemKey       string
	PurchaseCount int64
	UpdatedAtMs   int64
}
