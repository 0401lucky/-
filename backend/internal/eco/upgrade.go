package eco

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

var (
	upgradeCostsByKey = map[string][]int64{
		"spawn":   {50, 90, 160, 280, 480, 820, 1400, 2400},
		"storage": {40, 70, 120, 200, 340, 580, 980, 1600},
		"value":   {180, 360, 720, 1400, 2600},
		"auto":    {250, 450, 850, 1600, 3000, 5600},
	}
	upgradeNameByKey = map[string]string{
		"spawn":   "刷新速度",
		"storage": "回收袋容量",
		"value":   "积分价格",
		"auto":    "自动回收机器人",
	}
)

type BuyUpgradeInput struct {
	UserID int64
	Key    string
	NowMs  int64
}

type BuyUpgradeResult struct {
	Success bool
	Message string
	Balance int64
	Key     string
	Level   int64
	Cost    int64
}

func (service *Service) BuyUpgrade(ctx context.Context, input BuyUpgradeInput) (BuyUpgradeResult, error) {
	if input.UserID <= 0 {
		return BuyUpgradeResult{}, errors.New("userID must be positive")
	}
	if !isUpgradeKey(input.Key) {
		return BuyUpgradeResult{Success: false, Message: "未知升级项", Key: input.Key}, nil
	}
	if input.NowMs <= 0 {
		input.NowMs = nowMillis()
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return BuyUpgradeResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := ensurePlaceholderUser(ctx, tx, input.UserID); err != nil {
		return BuyUpgradeResult{}, err
	}
	if err := ensurePointAccount(ctx, tx, input.UserID); err != nil {
		return BuyUpgradeResult{}, err
	}
	if err := ensureEcoState(ctx, tx, input.UserID, input.NowMs); err != nil {
		return BuyUpgradeResult{}, err
	}

	snapshot, err := service.loadCollectStateForUpdate(ctx, tx, input.UserID, input.NowMs)
	if err != nil {
		return BuyUpgradeResult{}, err
	}
	next, tick, err := service.advanceStateForUpdate(ctx, tx, snapshot, input.NowMs, true)
	if err != nil {
		return BuyUpgradeResult{}, err
	}
	if _, err := service.creditTrash(ctx, tx, &next, tick.AutoCollected, input.NowMs, "自动回收"); err != nil {
		return BuyUpgradeResult{}, err
	}

	level := UpgradeLevel(next, input.Key)
	cost, ok := upgradeCost(input.Key, level)
	if !ok {
		balance, err := getBalance(ctx, tx, input.UserID)
		if err != nil {
			return BuyUpgradeResult{}, err
		}
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return BuyUpgradeResult{}, err
		}
		return BuyUpgradeResult{Success: false, Message: "该项已满级", Balance: balance, Key: input.Key, Level: level}, tx.Commit(ctx)
	}

	balance, err := getBalanceForUpdate(ctx, tx, input.UserID)
	if err != nil {
		return BuyUpgradeResult{}, err
	}
	if balance < cost {
		next.PointsSnapshot = balance
		next.UpdatedAtMs = input.NowMs
		if err := saveEcoState(ctx, tx, next); err != nil {
			return BuyUpgradeResult{}, err
		}
		return BuyUpgradeResult{Success: false, Message: "积分不足", Balance: balance, Key: input.Key, Level: level, Cost: cost}, tx.Commit(ctx)
	}

	nextBalance := balance - cost
	if _, err := tx.Exec(ctx,
		`UPDATE point_accounts SET balance = $1, updated_at = now() WHERE user_id = $2`,
		nextBalance,
		input.UserID,
	); err != nil {
		return BuyUpgradeResult{}, err
	}
	if err := insertPointLog(ctx, tx, input.UserID, -cost, "exchange", fmt.Sprintf("环保行动升级·%s Lv%d", upgradeNameByKey[input.Key], level+1), nextBalance); err != nil {
		return BuyUpgradeResult{}, err
	}
	if err := upsertUpgrade(ctx, tx, input.UserID, input.Key, level+1); err != nil {
		return BuyUpgradeResult{}, err
	}

	next.Upgrades[input.Key] = level + 1
	next.PointsSnapshot = nextBalance
	next.UpdatedAtMs = input.NowMs
	if err := saveEcoState(ctx, tx, next); err != nil {
		return BuyUpgradeResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return BuyUpgradeResult{}, err
	}

	return BuyUpgradeResult{
		Success: true,
		Balance: nextBalance,
		Key:     input.Key,
		Level:   level + 1,
		Cost:    cost,
	}, nil
}

func upgradeCost(key string, level int64) (int64, bool) {
	costs := upgradeCostsByKey[key]
	if level < 0 || level >= int64(len(costs)) {
		return 0, false
	}
	return costs[level], true
}

func upsertUpgrade(ctx context.Context, tx pgx.Tx, userID int64, key string, level int64) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO eco_user_upgrades (user_id, upgrade_key, level, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id, upgrade_key) DO UPDATE SET
		   level = excluded.level,
		   updated_at = now()`,
		userID,
		key,
		level,
	)
	return err
}
