package farm

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

type Service struct {
	store *Store
}

func NewService(store *Store) *Service {
	return &Service{store: store}
}

func (service *Service) GetStatus(ctx context.Context, userID int64, nowMs int64) (StatusResponse, error) {
	if service == nil || service.store == nil {
		return StatusResponse{}, ErrUnavailable
	}
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}

	record, err := service.store.GetState(ctx, userID)
	if err != nil {
		return StatusResponse{}, err
	}

	var state FarmState
	if record.Exists {
		if err := json.Unmarshal(record.StateJSON, &state); err != nil {
			return StatusResponse{}, err
		}
	} else {
		state = newInitialState(userID, nowMs)
		balance, err := service.store.EnsureInitialPointGrant(ctx, userID, initialPoints, nowMs)
		if err != nil {
			return StatusResponse{}, err
		}
		if balance > 0 {
			state.Points = balance
		}
		stateJSON, err := json.Marshal(state)
		if err != nil {
			return StatusResponse{}, err
		}
		if err := service.store.SaveState(ctx, StateRecord{
			UserID:       userID,
			StateJSON:    stateJSON,
			LastTickAtMs: nowMs,
			UpdatedAtMs:  nowMs,
		}); err != nil {
			return StatusResponse{}, err
		}
	}
	if state.UserID <= 0 {
		state.UserID = userID
	}
	state = normalizeState(state, nowMs)
	stateChanged := tickBasicCropState(&state, nowMs)
	passiveChanged, err := service.processPassivePetSkills(ctx, userID, &state, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}
	pointsChanged, err := service.syncPointsFromLedger(ctx, userID, record.Exists, &state, nowMs)
	if err != nil {
		return StatusResponse{}, err
	}
	if stateChanged || passiveChanged || pointsChanged {
		if err := service.saveState(ctx, userID, state, nowMs); err != nil {
			return StatusResponse{}, err
		}
	}

	date := getChinaDateString(nowMs)
	season := getCurrentSeason(nowMs)
	weather := getWeatherForDate(date, season)
	tomorrowAtMidnight := getChinaMidnight(nowMs) + dayMs
	tomorrowSeason := getCurrentSeason(tomorrowAtMidnight)
	tomorrowDate := getChinaDateString(tomorrowAtMidnight)
	tomorrowWeather := getWeatherForDate(tomorrowDate, tomorrowSeason)
	purchases, err := service.store.ListDailyPurchases(ctx, userID, date)
	if err != nil {
		return StatusResponse{}, err
	}

	return StatusResponse{
		State:         state,
		ComputedLands: buildComputedLands(state, nowMs),
		World: WorldState{
			Date:        date,
			Weather:     weather,
			Season:      season,
			GeneratedAt: nowMs,
		},
		WeatherForecast: WeatherForecast{
			Tomorrow: WorldState{
				Date:        tomorrowDate,
				Weather:     tomorrowWeather,
				Season:      tomorrowSeason,
				GeneratedAt: nowMs,
			},
		},
		ShopDailyPurchases: purchases,
		ServerNow:          nowMs,
		PlantableCrops:     getPlantableCrops(state, season),
		NextSeasonInMs:     getNextSeasonChangeMs(nowMs),
		NextDailyInMs:      getNextDailyResetMs(nowMs),
	}, nil
}

func (service *Service) processPassivePetSkills(ctx context.Context, userID int64, state *FarmState, nowMs int64) (bool, error) {
	changed := false
	total, count, ledgerID, harvested := processPassivePetHarvest(state, nowMs)
	if harvested {
		balance := state.Points
		if total > 0 {
			nextBalance, _, err := service.store.AddFarmPoints(
				ctx,
				userID,
				total,
				ledgerID,
				fmt.Sprintf("宠物被动收菜: %d 块", count),
				nowMs,
			)
			if err != nil {
				return false, err
			}
			balance = nextBalance
		}
		if !bonusFlag(state.Bonuses, "firstHarvest") {
			state.Bonuses = setBonusFlag(state.Bonuses, "firstHarvest", true)
			nextBalance, _, err := service.store.AddFarmPoints(
				ctx,
				userID,
				firstHarvestBonus,
				fmt.Sprintf("farm_first_harvest_%d", userID),
				"农场首次收获奖励",
				nowMs,
			)
			if err != nil {
				return false, err
			}
			balance = nextBalance
		}
		state.Points = balance
		changed = true
	}
	if processPassivePetPlant(state, nowMs) {
		changed = true
	}
	if changed {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	return changed, nil
}

func (service *Service) syncPointsFromLedger(ctx context.Context, userID int64, recordExisted bool, state *FarmState, nowMs int64) (bool, error) {
	balance, exists, err := service.store.GetPointBalance(ctx, userID)
	if err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	if !recordExisted && balance <= 0 {
		return false, nil
	}
	if state.Points == balance {
		return false, nil
	}
	state.Points = balance
	state.UpdatedAt = nowMs
	return true, nil
}

func (service *Service) saveState(ctx context.Context, userID int64, state FarmState, nowMs int64) error {
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return service.store.SaveState(ctx, StateRecord{
		UserID:       userID,
		StateJSON:    stateJSON,
		LastTickAtMs: state.LastTickAt,
		UpdatedAtMs:  nowMs,
	})
}

var timeNowMs = func() int64 {
	return timeNow().UnixMilli()
}

var timeNow = func() time.Time {
	return time.Now()
}
