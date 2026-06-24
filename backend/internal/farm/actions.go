package farm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
)

const firstWaterBonus = int64(5)
const firstAdoptBonus = int64(10)
const petAdoptCost = int64(50)
const petAutoPlantMax = 3

type ActionResult struct {
	OK       bool            `json:"ok"`
	Msg      string          `json:"msg,omitempty"`
	Balance  int64           `json:"balance,omitempty"`
	Bonus    int64           `json:"bonus,omitempty"`
	Count    int64           `json:"count,omitempty"`
	Total    int64           `json:"total,omitempty"`
	Harvest  *harvestResult  `json:"-"`
	Harvests []harvestResult `json:"-"`
}

type buySeedsPlan struct {
	Crop      cropDef
	Qty       int64
	TotalCost int64
}

type buyLandPlan struct {
	LandIndex int
	LandPos   int
	Price     int64
}

type buyShopItemPlan struct {
	Item           shopItemDef
	Qty            int64
	TotalCost      int64
	PurchaseDate   string
	CountToday     int64
	UsesDailyLimit bool
}

type adoptPetPlan struct {
	PetType    string
	PetName    string
	FirstAdopt bool
}

func (service *Service) ExecutePlant(ctx context.Context, userID int64, plotIndex int, cropID CropID, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyPlantAction(&state, plotIndex, cropID, nowMs)
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if !result.OK {
		if err := tx.Commit(ctx); err != nil {
			return ActionResult{}, err
		}
		return result, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteWater(ctx context.Context, userID int64, plotIndex int, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyWaterAction(&state, plotIndex, nowMs)
	if result.OK && result.Bonus > 0 {
		balance, _, err := service.store.addFarmPointsTx(
			ctx,
			tx,
			userID,
			result.Bonus,
			fmt.Sprintf("farm_first_water_%d", userID),
			"农场首次浇水奖励",
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		state.Points = balance
		result.Balance = balance
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteWaterAll(ctx context.Context, userID int64, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyWaterAllAction(&state, nowMs)
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteHarvest(ctx context.Context, userID int64, plotIndex int, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyHarvestAction(&state, plotIndex, nowMs)
	if result.OK && result.Harvest != nil {
		harvest := *result.Harvest
		balance, _, err := service.store.addFarmPointsTx(
			ctx,
			tx,
			userID,
			harvest.FinalYield,
			fmt.Sprintf("farm_harvest_%d_%s", userID, harvest.StableComponent),
			fmt.Sprintf("农场收获: %s（%s）", harvest.CropName, harvest.Quality),
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		state.Points = balance
		result.Balance = balance
		if result.Bonus > 0 {
			balance, _, err = service.store.addFarmPointsTx(
				ctx,
				tx,
				userID,
				result.Bonus,
				fmt.Sprintf("farm_first_harvest_%d", userID),
				"农场首次收获奖励",
				nowMs,
			)
			if err != nil {
				return ActionResult{}, err
			}
			state.Points = balance
			result.Balance = balance
		}
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteHarvestAll(ctx context.Context, userID int64, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyHarvestAllAction(&state, nowMs)
	if result.OK {
		balance, _, err := service.store.addFarmPointsTx(
			ctx,
			tx,
			userID,
			result.Total,
			manualHarvestAllLedgerID(userID, result.Harvests),
			fmt.Sprintf("农场一键收获: %d 块", len(result.Harvests)),
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		state.Points = balance
		result.Balance = balance
		if result.Bonus > 0 {
			balance, _, err = service.store.addFarmPointsTx(
				ctx,
				tx,
				userID,
				result.Bonus,
				fmt.Sprintf("farm_first_harvest_%d", userID),
				"农场首次收获奖励",
				nowMs,
			)
			if err != nil {
				return ActionResult{}, err
			}
			state.Points = balance
			result.Balance = balance
		}
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteRemove(ctx context.Context, userID int64, plotIndex int, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyRemoveAction(&state, plotIndex, nowMs)
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteBuySeeds(ctx context.Context, userID int64, cropID CropID, qty int64, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	plan, result := prepareBuySeedsAction(&state, cropID, qty)
	if result.OK {
		balance, deducted, err := service.store.deductFarmPointsTx(
			ctx,
			tx,
			userID,
			plan.TotalCost,
			"exchange",
			fmt.Sprintf("农场购买种子: %s x%d", plan.Crop.Name, plan.Qty),
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		if !deducted {
			state.Points = balance
			result = ActionResult{OK: false, Msg: "积分不足", Balance: balance}
		} else {
			result = applyBuySeedsAction(&state, plan, balance, nowMs)
		}
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteBuyLand(ctx context.Context, userID int64, landIndex int, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	plan, result := prepareBuyLandAction(&state, landIndex)
	if result.OK {
		balance := state.Points
		if plan.Price > 0 {
			var deducted bool
			balance, deducted, err = service.store.deductFarmPointsTx(
				ctx,
				tx,
				userID,
				plan.Price,
				"exchange",
				fmt.Sprintf("农场购买第 %d 块土地", plan.LandIndex),
				nowMs,
			)
			if err != nil {
				return ActionResult{}, err
			}
			if !deducted {
				state.Points = balance
				result = ActionResult{OK: false, Msg: "积分不足", Balance: balance}
			}
		}
		if result.OK {
			result = applyBuyLandAction(&state, plan, balance, nowMs)
		}
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteBuyShopItem(ctx context.Context, userID int64, key string, qty int64, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	item, exists, err := service.store.getEffectiveShopItemDefTx(ctx, tx, key)
	if err != nil {
		return ActionResult{}, err
	}
	countToday := int64(0)
	purchaseDate := getChinaDateString(nowMs)
	usesDailyLimit := itemUsesDailyLimit(item)
	if exists && usesDailyLimit {
		countToday, err = service.store.getDailyPurchaseCountForUpdateTx(ctx, tx, userID, purchaseDate, item.Key, nowMs)
		if err != nil {
			return ActionResult{}, err
		}
	}

	plan, result := prepareBuyShopItemAction(&state, item, exists, qty, purchaseDate, countToday, usesDailyLimit)
	if result.OK {
		balance := state.Points
		if plan.TotalCost > 0 {
			var deducted bool
			balance, deducted, err = service.store.deductFarmPointsTx(
				ctx,
				tx,
				userID,
				plan.TotalCost,
				"exchange",
				fmt.Sprintf("农场购买: %s x%d", plan.Item.Name, plan.Qty),
				nowMs,
			)
			if err != nil {
				return ActionResult{}, err
			}
			if !deducted {
				state.Points = balance
				result = ActionResult{OK: false, Msg: "积分不足", Balance: balance}
			}
		}
		if result.OK {
			if plan.UsesDailyLimit {
				if err := service.store.incrementDailyPurchaseTx(ctx, tx, userID, plan.PurchaseDate, plan.Item.Key, plan.Qty, nowMs); err != nil {
					return ActionResult{}, err
				}
			}
			result = applyBuyShopItemAction(&state, plan, balance, nowMs)
		}
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteUseShopItem(ctx context.Context, userID int64, key string, plotIndex *int, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)

	item, exists, err := service.store.getEffectiveShopItemDefTx(ctx, tx, key)
	if err != nil {
		return ActionResult{}, err
	}
	result := applyUseShopItemAction(&state, item, exists, plotIndex, nowMs)
	if result.OK {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteAdoptPet(ctx context.Context, userID int64, petType string, name string, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	plan, result := prepareAdoptPetAction(&state, petType, name, nowMs)
	if result.OK && !plan.FirstAdopt {
		balance, deducted, err := service.store.deductFarmPointsTx(
			ctx,
			tx,
			userID,
			petAdoptCost,
			"exchange",
			"农场再次领养宠物",
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		if !deducted {
			state.Points = balance
			result = ActionResult{OK: false, Msg: "积分不足", Balance: balance}
		} else {
			result = applyAdoptPetAction(&state, plan, balance, nowMs)
		}
	}
	if result.OK && plan.FirstAdopt {
		balance, _, err := service.store.addFarmPointsTx(
			ctx,
			tx,
			userID,
			firstAdoptBonus,
			fmt.Sprintf("farm_first_adopt_%d", userID),
			"农场首次领养奖励",
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		result = applyAdoptPetAction(&state, plan, balance, nowMs)
		result.Bonus = firstAdoptBonus
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteFeedPet(ctx context.Context, userID int64, kind string, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	processPetLazyState(&state, state.LastTickAt, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	itemKey := "pet_food_normal"
	if kind == "premium" {
		itemKey = "pet_food_premium"
	}
	item, exists, err := service.store.getEffectiveShopItemDefTx(ctx, tx, itemKey)
	if err != nil {
		return ActionResult{}, err
	}
	result := applyFeedPetAction(&state, item, exists, kind)
	if result.OK {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteUsePetItem(ctx context.Context, userID int64, itemKey string, expectedCategory string, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	processPetLazyState(&state, state.LastTickAt, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	item, exists, err := service.store.getEffectiveShopItemDefTx(ctx, tx, itemKey)
	if err != nil {
		return ActionResult{}, err
	}
	result := applyPetItemAction(&state, item, exists, expectedCategory)
	if result.OK {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func (service *Service) ExecuteDispatchPet(ctx context.Context, userID int64, task string, nowMs int64) (ActionResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return ActionResult{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}
	if !isAllowedDispatchPetTask(task) {
		return ActionResult{OK: false, Msg: "任务参数无效"}, nil
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, userID, nowMs)
	if err != nil {
		return ActionResult{}, err
	}
	state = normalizeState(state, nowMs)
	tickBasicCropState(&state, nowMs)
	processPetLazyState(&state, state.LastTickAt, nowMs)
	if err := syncStatePointsTx(ctx, tx, userID, &state); err != nil {
		return ActionResult{}, err
	}

	result := applyDispatchPetAction(&state, task, nowMs)
	if result.OK && task == "harvest" && result.Total > 0 {
		balance, _, err := service.store.addFarmPointsTx(
			ctx,
			tx,
			userID,
			result.Total,
			petHarvestLedgerID(userID, result.Harvests),
			fmt.Sprintf("宠物收菜: %d 块", len(result.Harvests)),
			nowMs,
		)
		if err != nil {
			return ActionResult{}, err
		}
		state.Points = balance
		result.Balance = balance
		if result.Bonus > 0 {
			balance, _, err = service.store.addFarmPointsTx(
				ctx,
				tx,
				userID,
				result.Bonus,
				fmt.Sprintf("farm_first_harvest_%d", userID),
				"农场首次收获奖励",
				nowMs,
			)
			if err != nil {
				return ActionResult{}, err
			}
			state.Points = balance
			result.Balance = balance
		}
	}
	if result.OK {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	if err := service.store.saveStateTx(ctx, tx, state, nowMs); err != nil {
		return ActionResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return result, nil
}

func isAllowedDispatchPetTask(task string) bool {
	switch task {
	case "water", "guard", "chase_crow", "harvest", "plant":
		return true
	default:
		return false
	}
}

func applyPlantAction(state *FarmState, plotIndex int, cropID CropID, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if plotIndex < 0 || plotIndex >= len(state.Lands) {
		return ActionResult{OK: false, Msg: "无效土地"}
	}
	land := &state.Lands[plotIndex]
	if land.Status == LandStatusLocked {
		return ActionResult{OK: false, Msg: "土地未解锁"}
	}
	if land.Status != LandStatusEmpty && land.Status != LandStatusEaten {
		return ActionResult{OK: false, Msg: "土地不为空"}
	}

	crop, ok := cropDefByID[cropID]
	if !ok {
		return ActionResult{OK: false, Msg: "未知作物"}
	}
	season := getCurrentSeason(nowMs)
	if !seasonContains(crop.Seasons, season) {
		return ActionResult{OK: false, Msg: "当前季节不能种植该作物"}
	}
	unlockedLandCount := 0
	for _, item := range state.Lands {
		if item.Status != LandStatusLocked {
			unlockedLandCount++
		}
	}
	if crop.UnlockLandCount > unlockedLandCount {
		return ActionResult{OK: false, Msg: "该作物尚未解锁"}
	}

	seeds := decodeIntMap(state.SeedInventory)
	if seeds[string(cropID)] < 1 {
		return ActionResult{OK: false, Msg: fmt.Sprintf("背包没有 %s 种子，请先去商店购买", crop.Name)}
	}
	weather := getWeatherForDate(getChinaDateString(nowMs), season)
	if !plantCropFromInventory(state, plotIndex, cropID, nowMs, season, weather) {
		return ActionResult{OK: false, Msg: "种植失败"}
	}
	pushEvent(state, farmEvent{
		ID:     eventID(state.UserID, "plant", nowMs, land.Index),
		Ts:     nowMs,
		Type:   "plant",
		Text:   fmt.Sprintf("种下了 %s", crop.Name),
		CropID: cropID,
	})
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	return ActionResult{OK: true, Balance: state.Points}
}

func applyWaterAction(state *FarmState, plotIndex int, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if plotIndex < 0 || plotIndex >= len(state.Lands) {
		return ActionResult{OK: false, Msg: "无效土地"}
	}
	land := &state.Lands[plotIndex]
	if land.Crop == nil {
		return ActionResult{OK: false, Msg: "土地上没有作物"}
	}
	if land.Status == LandStatusMature {
		return ActionResult{OK: false, Msg: "作物已成熟"}
	}
	if land.Status == LandStatusWithered {
		return ActionResult{OK: false, Msg: "作物已枯萎"}
	}

	season := getCurrentSeason(nowMs)
	weather := getWeatherForDate(getChinaDateString(nowMs), season)
	interval := computeActualWaterIntervalMs(land.Crop.CropID, season, weather)
	land.Crop.LastWaterAt = nowMs
	land.Crop.NextWaterDueAt = nowMs + interval
	land.Status = LandStatusGrowing
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs

	result := ActionResult{OK: true, Balance: state.Points}
	if !bonusFlag(state.Bonuses, "firstWater") {
		state.Bonuses = setBonusFlag(state.Bonuses, "firstWater", true)
		result.Bonus = firstWaterBonus
	}
	return result
}

func applyWaterAllAction(state *FarmState, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	season := getCurrentSeason(nowMs)
	weather := getWeatherForDate(getChinaDateString(nowMs), season)
	count := int64(0)
	for i := range state.Lands {
		land := &state.Lands[i]
		if land.Crop == nil {
			continue
		}
		switch land.Status {
		case LandStatusMature, LandStatusWithered, LandStatusEaten, LandStatusLocked, LandStatusEmpty:
			continue
		}
		interval := computeActualWaterIntervalMs(land.Crop.CropID, season, weather)
		land.Crop.LastWaterAt = nowMs
		land.Crop.NextWaterDueAt = nowMs + interval
		land.Status = LandStatusGrowing
		count++
	}
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	return ActionResult{OK: true, Count: count, Balance: state.Points}
}

func applyHarvestAction(state *FarmState, plotIndex int, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if plotIndex < 0 || plotIndex >= len(state.Lands) {
		return ActionResult{OK: false, Msg: "无效土地"}
	}
	land := &state.Lands[plotIndex]
	if land.Crop == nil {
		return ActionResult{OK: false, Msg: "土地上没有作物"}
	}
	if land.Status == LandStatusWithered {
		return ActionResult{OK: false, Msg: "作物已枯萎"}
	}
	if land.Status != LandStatusMature {
		return ActionResult{OK: false, Msg: "作物未成熟"}
	}
	harvest, ok := doHarvestSingle(state, plotIndex, nowMs)
	if !ok {
		return ActionResult{OK: false, Msg: "作物未成熟"}
	}
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	result := ActionResult{OK: true, Harvest: &harvest, Balance: state.Points}
	if !bonusFlag(state.Bonuses, "firstHarvest") {
		state.Bonuses = setBonusFlag(state.Bonuses, "firstHarvest", true)
		result.Bonus = firstHarvestBonus
	}
	return result
}

func applyHarvestAllAction(state *FarmState, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	results := []harvestResult{}
	total := int64(0)
	for index := range state.Lands {
		if state.Lands[index].Status != LandStatusMature || state.Lands[index].Crop == nil {
			continue
		}
		harvest, ok := doHarvestSingle(state, index, nowMs)
		if !ok {
			continue
		}
		results = append(results, harvest)
		total += harvest.FinalYield
	}
	if len(results) == 0 {
		return ActionResult{OK: false, Msg: "没有可收获的作物"}
	}
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	result := ActionResult{OK: true, Harvests: results, Total: total, Balance: state.Points}
	if !bonusFlag(state.Bonuses, "firstHarvest") {
		state.Bonuses = setBonusFlag(state.Bonuses, "firstHarvest", true)
		result.Bonus = firstHarvestBonus
	}
	return result
}

func applyDispatchPetAction(state *FarmState, task string, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if !isAllowedDispatchPetTask(task) {
		return ActionResult{OK: false, Msg: "任务参数无效"}
	}

	switch task {
	case "harvest":
		ready := validatePetSkillReady(state.Pet, task, nowMs)
		if !ready.OK {
			return ActionResult{OK: false, Msg: ready.Msg}
		}
		matureIndexes := make([]int, 0, len(state.Lands))
		for index, land := range state.Lands {
			if land.Status == LandStatusMature && land.Crop != nil {
				matureIndexes = append(matureIndexes, index)
			}
		}
		if len(matureIndexes) == 0 {
			return ActionResult{OK: false, Msg: "没有成熟作物可收"}
		}
		if dispatched := dispatchPetTask(state, task, nowMs, stealTarget{}); !dispatched.OK {
			return ActionResult{OK: false, Msg: dispatched.Msg}
		}
		results := make([]harvestResult, 0, len(matureIndexes))
		total := int64(0)
		for _, index := range matureIndexes {
			harvest, ok := doHarvestSingle(state, index, nowMs)
			if !ok {
				continue
			}
			results = append(results, harvest)
			total += harvest.FinalYield
		}
		if len(results) == 0 {
			return ActionResult{OK: false, Msg: "没有成熟作物可收"}
		}
		pushEvent(state, farmEvent{
			ID:   eventID(state.UserID, "pet_harvest", nowMs, len(results)),
			Ts:   nowMs,
			Type: "pet_task",
			Text: fmt.Sprintf("宠物收菜技能发动，收获 %d 块作物，获得 %d 积分", len(results), total),
		})
		result := ActionResult{
			OK:       true,
			Msg:      fmt.Sprintf("宠物收菜完成：%d 块，+%d 积分", len(results), total),
			Balance:  state.Points,
			Total:    total,
			Harvests: results,
		}
		if !bonusFlag(state.Bonuses, "firstHarvest") {
			state.Bonuses = setBonusFlag(state.Bonuses, "firstHarvest", true)
			result.Bonus = firstHarvestBonus
		}
		return result
	case "plant":
		ready := validatePetSkillReady(state.Pet, task, nowMs)
		if !ready.OK {
			return ActionResult{OK: false, Msg: ready.Msg}
		}
		emptyIndexes := make([]int, 0, petAutoPlantMax)
		for index, land := range state.Lands {
			if land.Status == LandStatusEmpty || land.Status == LandStatusEaten {
				emptyIndexes = append(emptyIndexes, index)
				if len(emptyIndexes) >= petAutoPlantMax {
					break
				}
			}
		}
		if len(emptyIndexes) == 0 {
			return ActionResult{OK: false, Msg: "没有空地可种"}
		}
		season := getCurrentSeason(nowMs)
		weather := getWeatherForDate(getChinaDateString(nowMs), season)
		planted := make([]CropID, 0, len(emptyIndexes))
		for _, index := range emptyIndexes {
			cropID, ok := pickPetPlantCrop(state, season)
			if !ok {
				break
			}
			if plantCropFromInventory(state, index, cropID, nowMs, season, weather) {
				planted = append(planted, cropID)
			}
		}
		if len(planted) == 0 {
			return ActionResult{OK: false, Msg: "没有当前季节可播种的种子"}
		}
		if dispatched := dispatchPetTask(state, task, nowMs, stealTarget{}); !dispatched.OK {
			return ActionResult{OK: false, Msg: dispatched.Msg}
		}
		names := make([]string, 0, len(planted))
		for _, cropID := range planted {
			names = append(names, cropName(cropID))
		}
		pushEvent(state, farmEvent{
			ID:   eventID(state.UserID, "pet_plant", nowMs, len(planted)),
			Ts:   nowMs,
			Type: "pet_task",
			Text: fmt.Sprintf("宠物种菜技能发动，自动播种 %d 块：%s", len(planted), strings.Join(names, "、")),
		})
		return ActionResult{
			OK:      true,
			Msg:     fmt.Sprintf("宠物种菜完成：播种 %d 块", len(planted)),
			Balance: state.Points,
			Count:   int64(len(planted)),
		}
	default:
		dispatched := dispatchPetTask(state, task, nowMs, stealTarget{})
		if !dispatched.OK {
			return ActionResult{OK: false, Msg: dispatched.Msg}
		}
		return ActionResult{OK: true, Balance: state.Points}
	}
}

func prepareBuySeedsAction(state *FarmState, cropID CropID, qty int64) (buySeedsPlan, ActionResult) {
	if state == nil {
		return buySeedsPlan{}, ActionResult{OK: false, Msg: "农场状态无效"}
	}
	crop, ok := cropDefByID[cropID]
	if !ok {
		return buySeedsPlan{}, ActionResult{OK: false, Msg: "未知作物"}
	}
	if qty <= 0 || qty > 99 {
		return buySeedsPlan{}, ActionResult{OK: false, Msg: "数量无效"}
	}
	unlockedLandCount := 0
	for _, land := range state.Lands {
		if land.Status != LandStatusLocked {
			unlockedLandCount++
		}
	}
	if crop.UnlockLandCount > unlockedLandCount {
		return buySeedsPlan{}, ActionResult{OK: false, Msg: "作物尚未解锁"}
	}
	totalCost := crop.SeedCost * qty
	if state.Points < totalCost {
		return buySeedsPlan{}, ActionResult{OK: false, Msg: "积分不足", Balance: state.Points}
	}
	return buySeedsPlan{Crop: crop, Qty: qty, TotalCost: totalCost}, ActionResult{OK: true}
}

func applyBuySeedsAction(state *FarmState, plan buySeedsPlan, balance int64, nowMs int64) ActionResult {
	seeds := decodeIntMap(state.SeedInventory)
	seeds[string(plan.Crop.ID)] += plan.Qty
	state.SeedInventory = encodeJSONOrDefault(seeds, `{}`)
	state.Points = balance
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	return ActionResult{OK: true, Balance: balance}
}

func prepareBuyLandAction(state *FarmState, landIndex int) (buyLandPlan, ActionResult) {
	if state == nil {
		return buyLandPlan{}, ActionResult{OK: false, Msg: "农场状态无效"}
	}
	landPos := -1
	for index := range state.Lands {
		if state.Lands[index].Index == landIndex {
			landPos = index
			break
		}
	}
	if landPos < 0 {
		return buyLandPlan{}, ActionResult{OK: false, Msg: "无效土地编号"}
	}
	if state.Lands[landPos].Status != LandStatusLocked {
		return buyLandPlan{}, ActionResult{OK: false, Msg: "该土地已解锁"}
	}
	for _, land := range state.Lands {
		if land.Index == landIndex-1 && land.Status == LandStatusLocked {
			return buyLandPlan{}, ActionResult{OK: false, Msg: "请先解锁前一块土地"}
		}
	}
	price := landUnlockPrices[landIndex]
	if state.Points < price {
		return buyLandPlan{}, ActionResult{OK: false, Msg: "积分不足", Balance: state.Points}
	}
	return buyLandPlan{LandIndex: landIndex, LandPos: landPos, Price: price}, ActionResult{OK: true}
}

func applyBuyLandAction(state *FarmState, plan buyLandPlan, balance int64, nowMs int64) ActionResult {
	land := &state.Lands[plan.LandPos]
	land.Status = LandStatusEmpty
	land.Crop = nil
	state.Points = balance
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "land_buy", nowMs, plan.LandIndex),
		Ts:   nowMs,
		Type: "land_buy",
		Text: fmt.Sprintf("开垦了第 %d 块土地（-%d积分）", plan.LandIndex, plan.Price),
	})
	return ActionResult{OK: true, Balance: balance}
}

func prepareBuyShopItemAction(state *FarmState, item shopItemDef, exists bool, qty int64, purchaseDate string, countToday int64, usesDailyLimit bool) (buyShopItemPlan, ActionResult) {
	if state == nil {
		return buyShopItemPlan{}, ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if !exists {
		return buyShopItemPlan{}, ActionResult{OK: false, Msg: "未知道具"}
	}
	if qty <= 0 || qty > 99 {
		return buyShopItemPlan{}, ActionResult{OK: false, Msg: "数量无效"}
	}
	if oneTimeShopItems[item.Key] {
		if qty != 1 {
			return buyShopItemPlan{}, ActionResult{OK: false, Msg: "该设备每个账号只能购买 1 台"}
		}
		if decodeInventory(state.Inventory)[item.Key].Count > 0 {
			return buyShopItemPlan{}, ActionResult{OK: false, Msg: "该设备已购买，不能重复购买"}
		}
	}
	if usesDailyLimit && item.DailyLimit > 0 && countToday+qty > item.DailyLimit {
		return buyShopItemPlan{}, ActionResult{OK: false, Msg: fmt.Sprintf("今日限购 %d 个", item.DailyLimit)}
	}
	totalCost := item.Cost * qty
	if state.Points < totalCost {
		return buyShopItemPlan{}, ActionResult{OK: false, Msg: "积分不足", Balance: state.Points}
	}
	return buyShopItemPlan{
		Item:           item,
		Qty:            qty,
		TotalCost:      totalCost,
		PurchaseDate:   purchaseDate,
		CountToday:     countToday,
		UsesDailyLimit: usesDailyLimit,
	}, ActionResult{OK: true}
}

func applyBuyShopItemAction(state *FarmState, plan buyShopItemPlan, balance int64, nowMs int64) ActionResult {
	addToInventory(state, plan.Item.Key, plan.Qty, nowMs)
	state.Points = balance
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	return ActionResult{OK: true, Balance: balance}
}

func itemUsesDailyLimit(item shopItemDef) bool {
	return item.DailyLimit > 0 && !petSkillBookItems[item.Key]
}

func prepareAdoptPetAction(state *FarmState, petType string, name string, nowMs int64) (adoptPetPlan, ActionResult) {
	if state == nil {
		return adoptPetPlan{}, ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if !isValidPetType(petType) {
		return adoptPetPlan{}, ActionResult{OK: false, Msg: "参数无效"}
	}
	if len(state.Pet) > 0 && string(state.Pet) != "null" {
		return adoptPetPlan{}, ActionResult{OK: false, Msg: "你已领养过宠物"}
	}
	firstAdopt := !bonusFlag(state.Bonuses, "firstAdopt")
	if !firstAdopt && state.Points < petAdoptCost {
		return adoptPetPlan{}, ActionResult{OK: false, Msg: "积分不足", Balance: state.Points}
	}
	return adoptPetPlan{
		PetType:    petType,
		PetName:    normalizePetName(petType, name),
		FirstAdopt: firstAdopt,
	}, ActionResult{OK: true}
}

func applyAdoptPetAction(state *FarmState, plan adoptPetPlan, balance int64, nowMs int64) ActionResult {
	state.Pet = newPetJSON(plan.PetType, plan.PetName, nowMs)
	if plan.FirstAdopt {
		state.Bonuses = setBonusFlag(state.Bonuses, "firstAdopt", true)
	}
	state.Points = balance
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	text := fmt.Sprintf("领养了 %s（%s）！", plan.PetName, petTypeLabel(plan.PetType))
	if !plan.FirstAdopt {
		text = fmt.Sprintf("%s -%d 积分", text, petAdoptCost)
	}
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "pet_adopted", nowMs, 0),
		Ts:   nowMs,
		Type: "pet_adopted",
		Text: text,
	})
	return ActionResult{OK: true, Balance: balance}
}

func isValidPetType(petType string) bool {
	switch petType {
	case "cat", "dog", "rabbit", "red_panda":
		return true
	default:
		return false
	}
}

func normalizePetName(petType string, name string) string {
	parts := strings.Fields(name)
	cleaned := strings.Join(parts, " ")
	runes := []rune(cleaned)
	if len(runes) > 12 {
		cleaned = string(runes[:12])
	}
	if cleaned != "" {
		return cleaned
	}
	return petTypeLabel(petType)
}

func petTypeLabel(petType string) string {
	return activePet{Type: petType}.DisplayName()
}

func newPetJSON(petType string, name string, nowMs int64) json.RawMessage {
	return encodeJSONOrDefault(map[string]any{
		"type":             petType,
		"name":             name,
		"stage":            "child",
		"growth":           float64(0),
		"hunger":           float64(80),
		"cleanliness":      float64(80),
		"mood":             float64(55),
		"thirst":           float64(80),
		"hydrationVersion": float64(2),
		"health":           float64(85),
		"learnedSkills":    []any{},
		"currentTask":      nil,
		"taskStartAt":      nil,
		"taskEndAt":        nil,
		"cooldownEndAt":    nil,
		"stealTarget":      nil,
		"feedToday": map[string]any{
			"normal":  float64(0),
			"premium": float64(0),
		},
		"washToday":    float64(0),
		"waterToday":   float64(0),
		"playToday":    float64(0),
		"toyToday":     float64(0),
		"dailyResetAt": float64(nowMs),
	}, `null`)
}

func applyFeedPetAction(state *FarmState, item shopItemDef, exists bool, kind string) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if kind != "normal" && kind != "premium" {
		return ActionResult{OK: false, Msg: "参数无效"}
	}
	if !exists {
		return ActionResult{OK: false, Msg: "未知物品"}
	}
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return ActionResult{OK: false, Msg: "请先领养宠物"}
	}
	normalizePetMap(pet)

	feedToday, _ := pet["feedToday"].(map[string]any)
	if feedToday == nil {
		feedToday = map[string]any{"normal": float64(0), "premium": float64(0)}
	}
	if kind == "normal" {
		if anyNumber(feedToday["normal"]) >= 3 {
			return ActionResult{OK: false, Msg: "今日普通宠粮已用完"}
		}
	} else if anyNumber(feedToday["premium"]) >= 1 {
		return ActionResult{OK: false, Msg: "今日高级宠粮已用完"}
	}

	if item.Cost > 0 && !consumeFromInventory(state, item.Key, 1) {
		return ActionResult{OK: false, Msg: fmt.Sprintf("库存不足，请先在商店购买%s", item.Name)}
	}
	if kind == "normal" {
		feedToday["normal"] = anyNumber(feedToday["normal"]) + 1
		pet["hunger"] = clamp01To100(petNumber(pet, "hunger") + 25)
		pet["thirst"] = clamp01To100(petNumber(pet, "thirst") + 4)
		pet["mood"] = clamp01To100(petNumber(pet, "mood") + 2)
		pet["health"] = clamp01To100(petNumber(pet, "health") + 2)
		pet["growth"] = math.Max(0, math.Floor(petNumber(pet, "growth")+5))
	} else {
		feedToday["premium"] = anyNumber(feedToday["premium"]) + 1
		pet["hunger"] = clamp01To100(petNumber(pet, "hunger") + 45)
		pet["thirst"] = clamp01To100(petNumber(pet, "thirst") + 2)
		pet["mood"] = clamp01To100(petNumber(pet, "mood") + 5)
		pet["health"] = clamp01To100(petNumber(pet, "health") + 5)
		pet["growth"] = math.Max(0, math.Floor(petNumber(pet, "growth")+12))
	}
	pet["feedToday"] = feedToday
	normalizePetStage(pet)
	state.Pet = encodeJSONOrDefault(pet, `null`)
	return ActionResult{OK: true, Balance: state.Points}
}

type petItemEffect struct {
	Category    string
	Daily       string
	Hunger      float64
	Cleanliness float64
	Mood        float64
	Thirst      float64
	Health      float64
	Growth      float64
}

var petItemEffects = map[string]petItemEffect{
	"pet_food_normal":  {Category: "feed", Daily: "feedNormal", Hunger: 25, Thirst: 4, Mood: 2, Health: 2, Growth: 5},
	"pet_food_premium": {Category: "feed", Daily: "feedPremium", Hunger: 45, Thirst: 2, Mood: 5, Health: 5, Growth: 12},
	"pet_water_basic":  {Category: "drink", Thirst: 35, Mood: 2, Growth: 1},
	"pet_milk":         {Category: "drink", Thirst: 45, Hunger: 5, Mood: 4, Growth: 3},
	"pet_coconut":      {Category: "drink", Thirst: 65, Health: 5, Mood: 5, Growth: 4},
	"pet_care_basic":   {Category: "care", Health: 12, Mood: 3, Growth: 2},
	"pet_vitamin":      {Category: "care", Health: 25, Mood: 5, Growth: 5},
	"pet_supplement":   {Category: "care", Health: 45, Mood: 8, Hunger: 10, Growth: 8},
	"pet_rest_basic":   {Category: "rest", Cleanliness: 20, Mood: 2, Growth: 1},
	"pet_nest":         {Category: "rest", Cleanliness: 35, Mood: 5, Health: 3, Growth: 4},
	"pet_blanket":      {Category: "rest", Cleanliness: 55, Mood: 8, Health: 5, Growth: 6},
	"pet_wash":         {Category: "rest", Daily: "wash", Cleanliness: 35, Mood: 4, Health: 3, Growth: 4},
	"pet_play_basic":   {Category: "play", Mood: 12, Health: 4, Hunger: -5, Thirst: -6, Cleanliness: -5, Growth: 3},
	"pet_yarn_ball":    {Category: "play", Mood: 20, Health: 7, Hunger: -8, Thirst: -10, Cleanliness: -8, Growth: 6},
	"pet_frisbee":      {Category: "play", Mood: 30, Health: 12, Hunger: -12, Thirst: -14, Cleanliness: -12, Growth: 10},
	"pet_toy":          {Category: "play", Daily: "toy", Mood: 22, Thirst: -5, Cleanliness: -4, Hunger: -3, Health: 4, Growth: 8},
}

func applyPetItemAction(state *FarmState, item shopItemDef, exists bool, expectedCategory string) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if !exists {
		return ActionResult{OK: false, Msg: "未知物品"}
	}
	effect, ok := petItemEffects[item.Key]
	if !ok || effect.Category != expectedCategory {
		return ActionResult{OK: false, Msg: "物品类别不匹配"}
	}
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return ActionResult{OK: false, Msg: "请先领养宠物"}
	}
	normalizePetMap(pet)
	if limitResult := applyPetDailyCounter(pet, effect.Daily); !limitResult.OK {
		return limitResult
	}
	if item.Cost > 0 && !consumeFromInventory(state, item.Key, 1) {
		return ActionResult{OK: false, Msg: fmt.Sprintf("库存不足，请先在商店购买%s", item.Name)}
	}
	applyPetEffectValues(pet, effect)
	state.Pet = encodeJSONOrDefault(pet, `null`)
	return ActionResult{OK: true, Balance: state.Points}
}

func applyPetDailyCounter(pet map[string]any, daily string) ActionResult {
	switch daily {
	case "":
		return ActionResult{OK: true}
	case "feedNormal", "feedPremium":
		feedToday, _ := pet["feedToday"].(map[string]any)
		if feedToday == nil {
			feedToday = map[string]any{"normal": float64(0), "premium": float64(0)}
		}
		if daily == "feedNormal" {
			if anyNumber(feedToday["normal"]) >= 3 {
				return ActionResult{OK: false, Msg: "今日普通宠粮已用完"}
			}
			feedToday["normal"] = anyNumber(feedToday["normal"]) + 1
		} else {
			if anyNumber(feedToday["premium"]) >= 1 {
				return ActionResult{OK: false, Msg: "今日高级宠粮已用完"}
			}
			feedToday["premium"] = anyNumber(feedToday["premium"]) + 1
		}
		pet["feedToday"] = feedToday
	case "wash":
		if petNumber(pet, "washToday") >= 1 {
			return ActionResult{OK: false, Msg: "今日洗澡券已用完"}
		}
		pet["washToday"] = petNumber(pet, "washToday") + 1
	case "toy":
		if petNumber(pet, "toyToday") >= 1 {
			return ActionResult{OK: false, Msg: "今日玩具球已用完"}
		}
		pet["toyToday"] = petNumber(pet, "toyToday") + 1
	case "water":
		if petNumber(pet, "waterToday") >= 3 {
			return ActionResult{OK: false, Msg: "今日喂水次数已用完"}
		}
		pet["waterToday"] = petNumber(pet, "waterToday") + 1
	case "play":
		if petNumber(pet, "playToday") >= 3 {
			return ActionResult{OK: false, Msg: "今日陪玩次数已用完"}
		}
		pet["playToday"] = petNumber(pet, "playToday") + 1
	}
	return ActionResult{OK: true}
}

func applyPetEffectValues(pet map[string]any, effect petItemEffect) {
	if effect.Hunger != 0 {
		pet["hunger"] = clamp01To100(petNumber(pet, "hunger") + effect.Hunger)
	}
	if effect.Cleanliness != 0 {
		pet["cleanliness"] = clamp01To100(petNumber(pet, "cleanliness") + effect.Cleanliness)
	}
	if effect.Mood != 0 {
		pet["mood"] = clamp01To100(petNumber(pet, "mood") + effect.Mood)
	}
	if effect.Thirst != 0 {
		pet["thirst"] = clamp01To100(petNumber(pet, "thirst") + effect.Thirst)
	}
	if effect.Health != 0 {
		pet["health"] = clamp01To100(petNumber(pet, "health") + effect.Health)
	}
	if effect.Growth != 0 {
		pet["growth"] = math.Max(0, math.Floor(petNumber(pet, "growth")+effect.Growth))
	}
	normalizePetStage(pet)
}

func applyUseShopItemAction(state *FarmState, item shopItemDef, exists bool, plotIndex *int, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if !exists {
		return ActionResult{OK: false, Msg: "未知道具"}
	}

	if skill, ok := petSkillBookToSkill[item.Key]; ok {
		return applyLearnPetSkillItem(state, item.Key, skill, nowMs)
	}

	if fertilizerType, ok := fertilizerItemToType(item.Key); ok {
		if plotIndex == nil {
			return ActionResult{OK: false, Msg: "请选择土地"}
		}
		land, ok := landBySliceIndex(state, *plotIndex)
		if !ok || land.Crop == nil {
			return ActionResult{OK: false, Msg: "土地上没有作物"}
		}
		if land.Status == LandStatusMature || nowMs >= land.Crop.MatureAt {
			return ActionResult{OK: false, Msg: "作物已成熟，不能再施肥"}
		}
		if land.Status == LandStatusWithered || land.Status == LandStatusEaten {
			return ActionResult{OK: false, Msg: "该土地无法施肥"}
		}
		if land.Crop.Fertilizer != nil && *land.Crop.Fertilizer != "" {
			return ActionResult{OK: false, Msg: "该作物已使用过肥料"}
		}
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		previousMatureAt := land.Crop.MatureAt
		nextMatureAt := land.Crop.PlantedAt + computeActualGrowthMsWithFertilizer(land.Crop.CropID, land.Crop.PlantedSeason, fertilizerType)
		land.Crop.Fertilizer = &fertilizerType
		if nextMatureAt < previousMatureAt {
			land.Crop.MatureAt = nextMatureAt
		}
		pushEvent(state, farmEvent{
			ID:   eventID(state.UserID, "use_fertilizer", nowMs, land.Index),
			Ts:   nowMs,
			Type: "plant",
			Text: fmt.Sprintf("给第 %d 块地的 %s 使用了%s", land.Index, cropName(land.Crop.CropID), fertilizerDisplayName(fertilizerType)),
		})
		return ActionResult{OK: true, Balance: state.Points}
	}

	switch item.Key {
	case "scarecrow":
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		baseTs := nowMs
		if state.ScarecrowUntil != nil && *state.ScarecrowUntil > baseTs {
			baseTs = *state.ScarecrowUntil
		}
		until := baseTs + item.DurationMinutes*60*1000
		state.ScarecrowUntil = &until
		pushEvent(state, farmEvent{ID: eventID(state.UserID, "use_scarecrow", nowMs, 0), Ts: nowMs, Type: "pet_task", Text: "使用稻草人，全农场乌鸦概率降低"})
		return ActionResult{OK: true, Balance: state.Points}
	case "bell":
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		baseTs := nowMs
		if state.BellUntil != nil && *state.BellUntil > baseTs {
			baseTs = *state.BellUntil
		}
		until := baseTs + item.DurationMinutes*60*1000
		state.BellUntil = &until
		pushEvent(state, farmEvent{ID: eventID(state.UserID, "use_bell", nowMs, 0), Ts: nowMs, Type: "pet_task", Text: "使用看守铃铛，偷菜成功率降低"})
		return ActionResult{OK: true, Balance: state.Points}
	case "birdnet":
		if plotIndex == nil {
			return ActionResult{OK: false, Msg: "请选择土地"}
		}
		land, ok := landBySliceIndex(state, *plotIndex)
		if !ok || land.Crop == nil {
			return ActionResult{OK: false, Msg: "土地上没有作物"}
		}
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		until := nowMs + item.DurationMinutes*60*1000
		land.Crop.BirdNetUntil = &until
		return ActionResult{OK: true, Balance: state.Points}
	case "firework":
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		for index := range state.Lands {
			if state.Lands[index].Status == LandStatusEaten {
				state.Lands[index].Status = LandStatusEmpty
			}
		}
		pushEvent(state, farmEvent{ID: eventID(state.UserID, "use_firework", nowMs, 0), Ts: nowMs, Type: "pet_task", Text: "驱鸟烟花点燃，乌鸦惊飞"})
		return ActionResult{OK: true, Balance: state.Points}
	case "cloud_bottle":
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		season := getCurrentSeason(nowMs)
		weather := getWeatherForDate(getChinaDateString(nowMs), season)
		for index := range state.Lands {
			land := &state.Lands[index]
			if land.Crop == nil {
				continue
			}
			if land.Status == LandStatusMature || land.Status == LandStatusWithered || land.Status == LandStatusEaten {
				continue
			}
			intervalMs := computeActualWaterIntervalMs(land.Crop.CropID, season, weather)
			land.Crop.LastWaterAt = nowMs
			land.Crop.NextWaterDueAt = nowMs + intervalMs
			land.Status = LandStatusGrowing
		}
		pushEvent(state, farmEvent{ID: eventID(state.UserID, "use_cloud_bottle", nowMs, 0), Ts: nowMs, Type: "water_rain", Text: "云朵瓶为所有未成熟作物浇水"})
		return ActionResult{OK: true, Balance: state.Points}
	case "last_supper":
		if len(state.Pet) == 0 || string(state.Pet) == "null" {
			return ActionResult{OK: false, Msg: "当前没有宠物"}
		}
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		petName := currentPetDisplayName(state.Pet)
		state.Pet = jsonNull()
		pushEvent(state, farmEvent{ID: eventID(state.UserID, "use_last_supper", nowMs, 0), Ts: nowMs, Type: "pet_task", Text: fmt.Sprintf("使用最后的晚餐，%s离开了庄园", petName)})
		return ActionResult{OK: true, Balance: state.Points}
	case "speed_normal", "speed_premium":
		if plotIndex == nil {
			return ActionResult{OK: false, Msg: "请选择土地"}
		}
		land, ok := landBySliceIndex(state, *plotIndex)
		if !ok || land.Crop == nil {
			return ActionResult{OK: false, Msg: "土地上没有作物"}
		}
		if nowMs >= land.Crop.MatureAt {
			return ActionResult{OK: false, Msg: "作物已成熟"}
		}
		if land.Crop.SpeedUsed >= 1 {
			return ActionResult{OK: false, Msg: "该作物已用过加速券"}
		}
		if !consumeFromInventory(state, item.Key, 1) {
			return ActionResult{OK: false, Msg: "库存不足"}
		}
		crop, ok := cropDefByID[land.Crop.CropID]
		if !ok {
			return ActionResult{OK: false, Msg: "未知作物"}
		}
		reduceMin := item.SpeedReduceMinutes
		if reduceMin <= 0 {
			reduceMin = 10
			if item.Key == "speed_premium" {
				reduceMin = 30
			}
		}
		maxReduceMin := int64(math.Floor(float64(crop.GrowthMinutes) * 0.5))
		allowReduce := minInt64(reduceMin, maxReduceMin-land.Crop.SpeedReducedMinutes)
		if allowReduce <= 0 {
			return ActionResult{OK: false, Msg: "已达到加速上限"}
		}
		land.Crop.MatureAt = maxInt64(nowMs+5*60*1000, land.Crop.MatureAt-allowReduce*60*1000)
		land.Crop.SpeedReducedMinutes += allowReduce
		land.Crop.SpeedUsed++
		return ActionResult{OK: true, Balance: state.Points}
	}

	return ActionResult{OK: false, Msg: "该道具无法直接使用"}
}

func fertilizerItemToType(key string) (string, bool) {
	switch key {
	case "fert_normal":
		return "normal", true
	case "fert_medium":
		return "medium", true
	case "fert_premium":
		return "premium", true
	default:
		return "", false
	}
}

func fertilizerDisplayName(fertilizerType string) string {
	switch fertilizerType {
	case "normal":
		return "普通肥料"
	case "medium":
		return "中级肥料"
	case "premium":
		return "高级肥料"
	default:
		return "肥料"
	}
}

func computeActualGrowthMsWithFertilizer(cropID CropID, season Season, fertilizerType string) int64 {
	base := computeActualGrowthMs(cropID, season)
	factor := 1.0
	switch fertilizerType {
	case "normal":
		factor = 0.90
	case "medium":
		factor = 0.80
	case "premium":
		factor = 0.65
	}
	return int64(math.Round(float64(base) * factor))
}

func landBySliceIndex(state *FarmState, plotIndex int) (*LandPlot, bool) {
	if state == nil || plotIndex < 0 || plotIndex >= len(state.Lands) {
		return nil, false
	}
	return &state.Lands[plotIndex], true
}

func consumeFromInventory(state *FarmState, key string, qty int64) bool {
	if state == nil || qty <= 0 {
		return false
	}
	inventory := decodeInventory(state.Inventory)
	item := inventory[key]
	if item.Count < qty {
		return false
	}
	item.Count -= qty
	inventory[key] = item
	state.Inventory = encodeJSONOrDefault(inventory, `{}`)
	return true
}

func applyLearnPetSkillItem(state *FarmState, itemKey string, skill string, nowMs int64) ActionResult {
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return ActionResult{OK: false, Msg: "请先领养宠物"}
	}
	normalizePetMap(pet)
	if stage, _ := pet["stage"].(string); stage != "adult" {
		return ActionResult{OK: false, Msg: "宠物成年后才能学习技能书"}
	}
	if petHasSkill(pet, skill) {
		return ActionResult{OK: false, Msg: fmt.Sprintf("宠物已经学会%s", petSkillLabels[skill])}
	}
	if !consumeFromInventory(state, itemKey, 1) {
		return ActionResult{OK: false, Msg: "库存不足"}
	}
	skills, _ := pet["learnedSkills"].([]any)
	pet["learnedSkills"] = append(skills, skill)
	state.Pet = encodeJSONOrDefault(pet, `null`)
	petName, _ := pet["name"].(string)
	if petName == "" {
		petType, _ := pet["type"].(string)
		petName = activePet{Type: petType}.DisplayName()
	}
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "pet_learn_skill", nowMs, len(skills)+1),
		Ts:   nowMs,
		Type: "pet_task",
		Text: fmt.Sprintf("%s 学会了%s技能", petName, petSkillLabels[skill]),
	})
	return ActionResult{OK: true, Balance: state.Points}
}

func currentPetDisplayName(raw json.RawMessage) string {
	pet, ok := decodePetMap(raw)
	if !ok {
		return "宠物"
	}
	name, _ := pet["name"].(string)
	if name != "" {
		return name
	}
	petType, _ := pet["type"].(string)
	return activePet{Type: petType}.DisplayName()
}

func jsonNull() json.RawMessage {
	return json.RawMessage(`null`)
}

func applyRemoveAction(state *FarmState, plotIndex int, nowMs int64) ActionResult {
	if state == nil {
		return ActionResult{OK: false, Msg: "农场状态无效"}
	}
	if plotIndex < 0 || plotIndex >= len(state.Lands) {
		return ActionResult{OK: false, Msg: "无效土地"}
	}
	land := &state.Lands[plotIndex]
	if land.Status != LandStatusWithered && land.Status != LandStatusEaten {
		return ActionResult{OK: false, Msg: "该土地不需要清除"}
	}
	land.Status = LandStatusEmpty
	land.Crop = nil
	state.LastTickAt = nowMs
	state.UpdatedAt = nowMs
	return ActionResult{OK: true, Balance: state.Points}
}

func manualHarvestAllLedgerID(userID int64, results []harvestResult) string {
	parts := make([]string, 0, len(results))
	for _, result := range results {
		parts = append(parts, result.StableComponent)
	}
	return fmt.Sprintf("farm_harvest_all_%d_%s", userID, strings.Join(parts, "-"))
}

func petHarvestLedgerID(userID int64, results []harvestResult) string {
	parts := make([]string, 0, len(results))
	for _, result := range results {
		parts = append(parts, result.StableComponent)
	}
	return fmt.Sprintf("farm_pet_harvest_%d_%s", userID, strings.Join(parts, "-"))
}

func syncStatePointsTx(ctx context.Context, tx pgx.Tx, userID int64, state *FarmState) error {
	var balance int64
	err := tx.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	state.Points = balance
	return nil
}
