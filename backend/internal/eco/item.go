package eco

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

const (
	clearTruckTrash            = int64(80)
	luckyFlashlightGenerations = int64(200)
	recycleGloveUses           = int64(50)
)

type BuyItemInput struct {
	UserID int64
	Key    string
	NowMs  int64
}

type BuyItemResult struct {
	Success        bool
	Message        string
	Balance        int64
	Key            string
	Cost           int64
	PurchasedToday int64
	RemainingToday int64
}

func (service *Service) BuyItem(ctx context.Context, input BuyItemInput) (BuyItemResult, error) {
	if input.UserID <= 0 {
		return BuyItemResult{}, errors.New("userID must be positive")
	}
	if !isItemKey(input.Key) {
		return BuyItemResult{Success: false, Message: "未知道具", Key: input.Key}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return BuyItemResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return BuyItemResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return BuyItemResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return BuyItemResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return BuyItemResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return BuyItemResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return BuyItemResult{}, err
	}

	dateKey := chinaDateKey(input.NowMs)
	def := ecoItemDefinitions[input.Key]
	purchasedToday := itemPurchaseCount(next, input.Key, dateKey)
	if purchasedToday >= def.DailyLimit {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return BuyItemResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return BuyItemResult{}, err
		}
		return BuyItemResult{
			Success:        false,
			Message:        "今日购买次数已用完",
			Balance:        balance,
			Key:            input.Key,
			Cost:           def.Cost,
			PurchasedToday: purchasedToday,
			RemainingToday: 0,
		}, tx.Commit(ctx)
	}

	balance, err := getBalanceForUpdate(ctx, tx, input.UserID)
	if err != nil {
		return BuyItemResult{}, err
	}
	if balance < def.Cost {
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return BuyItemResult{}, err
		}
		return BuyItemResult{
			Success:        false,
			Message:        "积分不足",
			Balance:        balance,
			Key:            input.Key,
			Cost:           def.Cost,
			PurchasedToday: purchasedToday,
			RemainingToday: maxInt64(0, def.DailyLimit-purchasedToday),
		}, tx.Commit(ctx)
	}

	nextBalance := balance - def.Cost
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		input.UserID,
	); err != nil {
		return BuyItemResult{}, err
	}
	if err := insertPointLog(ctx, tx, input.UserID, -def.Cost, "exchange", "环保行动道具·"+def.Name, nextBalance); err != nil {
		return BuyItemResult{}, err
	}
	if err := upsertItemPurchase(ctx, tx, input.UserID, input.Key, dateKey, purchasedToday+1); err != nil {
		return BuyItemResult{}, err
	}
	applyItemEffect(&next, input.Key)

	next.PointsSnapshot = nextBalance
	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return BuyItemResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return BuyItemResult{}, err
	}

	return BuyItemResult{
		Success:        true,
		Balance:        nextBalance,
		Key:            input.Key,
		Cost:           def.Cost,
		PurchasedToday: purchasedToday + 1,
		RemainingToday: maxInt64(0, def.DailyLimit-purchasedToday-1),
	}, nil
}

func applyItemEffect(snapshot *StateSnapshot, key string) {
	switch key {
	case "clear_truck":
		visibleSlots := int64(len(snapshot.VisiblePrizes))
		capacity := maxInt64(0, StorageCap(*snapshot)-visibleSlots)
		basePending := minInt64(maxInt64(0, snapshot.Pending), capacity)
		availableSlots := maxInt64(0, capacity-basePending)
		snapshot.Pending = basePending + minInt64(clearTruckTrash, availableSlots)
	case "lucky_flashlight":
		snapshot.LuckyGenerationsRemaining += luckyFlashlightGenerations
	case "recycle_glove":
		snapshot.GloveUsesRemaining += recycleGloveUses
	}
}

func itemPurchaseCount(snapshot StateSnapshot, key string, dateKey string) int64 {
	count := int64(0)
	for _, item := range snapshot.ItemPurchases {
		if item.ItemKey == key && item.PurchaseDate == dateKey {
			count = maxInt64(count, item.PurchaseCount)
		}
	}
	return count
}

func upsertItemPurchase(ctx context.Context, tx pgx.Tx, userID int64, key string, dateKey string, count int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_item_purchases (user_id, item_key, purchase_date, purchase_count, updated_at)
		 VALUES ($1, $2, $3::date, $4, now())
		 ON CONFLICT (user_id, item_key, purchase_date) DO UPDATE SET
		   purchase_count = excluded.purchase_count,
		   updated_at = now()`,
		userID,
		key,
		dateKey,
		count,
	)
	return err
}

func isItemKey(key string) bool {
	for _, candidate := range ItemKeys {
		if key == candidate {
			return true
		}
	}
	return false
}
