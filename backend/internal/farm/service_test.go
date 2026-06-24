package farm

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestServiceReturnsUnavailableWithoutStore(t *testing.T) {
	service := NewService(nil)
	if _, err := service.GetStatus(context.Background(), 1, 1); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("expected ErrUnavailable, got %v", err)
	}
}

func TestApplyPlantActionConsumesSeedAndPlantsCrop(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)

	result := applyPlantAction(&state, 0, CropWheat, nowMs)
	if !result.OK || result.Balance != initialPoints {
		t.Fatalf("unexpected plant result: %+v", result)
	}
	if state.Lands[0].Status != LandStatusGrowing || state.Lands[0].Crop == nil || state.Lands[0].Crop.CropID != CropWheat {
		t.Fatalf("expected wheat planted, got %+v", state.Lands[0])
	}
	if decodeIntMap(state.SeedInventory)["wheat"] != 3 {
		t.Fatalf("expected wheat seed consumed, got %s", string(state.SeedInventory))
	}
	var events []map[string]any
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) < 2 || events[len(events)-1]["type"] != "plant" {
		t.Fatalf("expected plant event appended, got %+v", events)
	}
}

func TestApplyPlantActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name      string
		mutate    func(*FarmState)
		plotIndex int
		cropID    CropID
		message   string
	}{
		{name: "bad land", plotIndex: 99, cropID: CropWheat, message: "无效土地"},
		{name: "locked land", plotIndex: 4, cropID: CropWheat, message: "土地未解锁"},
		{name: "unknown crop", plotIndex: 0, cropID: CropID("bad"), message: "未知作物"},
		{name: "season", plotIndex: 0, cropID: CropCorn, message: "当前季节不能种植该作物"},
		{name: "no seed", mutate: func(s *FarmState) {
			s.SeedInventory = json.RawMessage(`{}`)
		}, plotIndex: 0, cropID: CropWheat, message: "背包没有 小麦 种子，请先去商店购买"},
		{name: "not empty", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusGrowing
			s.Lands[0].Crop = &CropInstance{CropID: CropWheat}
		}, plotIndex: 0, cropID: CropWheat, message: "土地不为空"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			result := applyPlantAction(&candidate, testCase.plotIndex, testCase.cropID, nowMs)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestApplyWaterActionUpdatesCropAndFirstWaterBonus(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Lands[0].Status = LandStatusThirsty
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs - 1,
		WaterMissCount: 1,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}

	result := applyWaterAction(&state, 0, nowMs)
	if !result.OK || result.Bonus != firstWaterBonus {
		t.Fatalf("unexpected water result: %+v", result)
	}
	if state.Lands[0].Status != LandStatusGrowing || state.Lands[0].Crop.LastWaterAt != nowMs || state.Lands[0].Crop.NextWaterDueAt <= nowMs {
		t.Fatalf("expected watered crop, got %+v", state.Lands[0])
	}
	if !bonusFlag(state.Bonuses, "firstWater") {
		t.Fatalf("expected firstWater bonus flag")
	}
}

func TestApplyWaterActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	baseCrop := &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}

	cases := []struct {
		name      string
		mutate    func(*FarmState)
		plotIndex int
		message   string
	}{
		{name: "bad land", plotIndex: 99, message: "无效土地"},
		{name: "empty", plotIndex: 0, message: "土地上没有作物"},
		{name: "mature", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusMature
			crop := *baseCrop
			s.Lands[0].Crop = &crop
		}, plotIndex: 0, message: "作物已成熟"},
		{name: "withered", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusWithered
			crop := *baseCrop
			s.Lands[0].Crop = &crop
		}, plotIndex: 0, message: "作物已枯萎"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			result := applyWaterAction(&candidate, testCase.plotIndex, nowMs)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestApplyWaterAllActionWatersEligibleCrops(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	for index := 0; index < 4; index++ {
		state.Lands[index].Status = LandStatusGrowing
		state.Lands[index].Crop = &CropInstance{
			CropID:         CropWheat,
			PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
			MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs - 1,
			PlantedSeason:  SeasonSpring,
			WeatherAtPlant: WeatherSunny,
		}
	}
	state.Lands[1].Status = LandStatusThirsty
	state.Lands[2].Status = LandStatusMature
	state.Lands[2].Crop.MatureAt = nowMs - 1
	state.Lands[3].Status = LandStatusWithered

	result := applyWaterAllAction(&state, nowMs)
	if !result.OK || result.Count != 2 {
		t.Fatalf("unexpected water-all result: %+v", result)
	}
	for _, index := range []int{0, 1} {
		if state.Lands[index].Status != LandStatusGrowing || state.Lands[index].Crop.LastWaterAt != nowMs {
			t.Fatalf("expected land %d watered, got %+v", index, state.Lands[index])
		}
	}
	if state.Lands[2].Crop.LastWaterAt == nowMs || state.Lands[3].Crop.LastWaterAt == nowMs {
		t.Fatalf("mature/withered lands should not be watered: mature=%+v withered=%+v", state.Lands[2], state.Lands[3])
	}
}

func TestApplyHarvestActionClearsLandAndSetsFirstHarvestBonus(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}

	result := applyHarvestAction(&state, 0, nowMs)
	if !result.OK || result.Harvest == nil || result.Harvest.CropID != CropWheat || result.Harvest.FinalYield <= 0 || result.Bonus != firstHarvestBonus {
		t.Fatalf("unexpected harvest result: %+v harvest=%+v", result, result.Harvest)
	}
	if state.Lands[0].Status != LandStatusEmpty || state.Lands[0].Crop != nil {
		t.Fatalf("expected harvested land to be empty, got %+v", state.Lands[0])
	}
	if !bonusFlag(state.Bonuses, "firstHarvest") {
		t.Fatalf("expected firstHarvest bonus flag")
	}
}

func TestApplyHarvestActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	baseCrop := &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}

	cases := []struct {
		name      string
		mutate    func(*FarmState)
		plotIndex int
		message   string
	}{
		{name: "bad land", plotIndex: 99, message: "无效土地"},
		{name: "empty", plotIndex: 0, message: "土地上没有作物"},
		{name: "withered", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusWithered
			crop := *baseCrop
			s.Lands[0].Crop = &crop
		}, plotIndex: 0, message: "作物已枯萎"},
		{name: "not mature", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusGrowing
			crop := *baseCrop
			s.Lands[0].Crop = &crop
		}, plotIndex: 0, message: "作物未成熟"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			result := applyHarvestAction(&candidate, testCase.plotIndex, nowMs)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestApplyHarvestAllActionHarvestsAllMatureCrops(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	for index := 0; index < 2; index++ {
		state.Lands[index].Status = LandStatusMature
		state.Lands[index].Crop = &CropInstance{
			CropID:         CropWheat,
			PlantedAt:      nowMs - int64(time.Duration(index+1)*time.Hour/time.Millisecond),
			MatureAt:       nowMs - 1,
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs,
			WaterMissCount: 0,
			PlantedSeason:  SeasonSpring,
			WeatherAtPlant: WeatherSunny,
		}
	}
	state.Lands[2].Status = LandStatusGrowing
	state.Lands[2].Crop = &CropInstance{CropID: CropWheat, MatureAt: nowMs + int64(time.Hour/time.Millisecond)}

	result := applyHarvestAllAction(&state, nowMs)
	if !result.OK || len(result.Harvests) != 2 || result.Total <= 0 || result.Bonus != firstHarvestBonus {
		t.Fatalf("unexpected harvest-all result: %+v", result)
	}
	for _, index := range []int{0, 1} {
		if state.Lands[index].Status != LandStatusEmpty || state.Lands[index].Crop != nil {
			t.Fatalf("expected land %d empty after harvest-all, got %+v", index, state.Lands[index])
		}
	}
	if state.Lands[2].Status != LandStatusGrowing || state.Lands[2].Crop == nil {
		t.Fatalf("growing land should be unchanged, got %+v", state.Lands[2])
	}
	if !bonusFlag(state.Bonuses, "firstHarvest") {
		t.Fatalf("expected firstHarvest bonus flag")
	}
}

func TestApplyHarvestAllActionRejectsWhenNoMatureCrops(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)

	result := applyHarvestAllAction(&state, nowMs)
	if result.OK || result.Msg != "没有可收获的作物" {
		t.Fatalf("expected no harvestable crop response, got %+v", result)
	}
}

func TestApplyRemoveActionClearsWitheredAndEatenLand(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	for _, status := range []LandStatus{LandStatusWithered, LandStatusEaten} {
		t.Run(string(status), func(t *testing.T) {
			state := newInitialState(1, nowMs)
			state.Lands[0].Status = status
			state.Lands[0].Crop = &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
				MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
				LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
				NextWaterDueAt: nowMs,
				PlantedSeason:  SeasonSpring,
				WeatherAtPlant: WeatherSunny,
			}

			result := applyRemoveAction(&state, 0, nowMs)
			if !result.OK {
				t.Fatalf("expected remove success, got %+v", result)
			}
			if state.Lands[0].Status != LandStatusEmpty || state.Lands[0].Crop != nil {
				t.Fatalf("expected empty land after remove, got %+v", state.Lands[0])
			}
		})
	}
}

func TestApplyRemoveActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name      string
		mutate    func(*FarmState)
		plotIndex int
		message   string
	}{
		{name: "bad land", plotIndex: 99, message: "无效土地"},
		{name: "empty", plotIndex: 0, message: "该土地不需要清除"},
		{name: "growing", mutate: func(s *FarmState) {
			s.Lands[0].Status = LandStatusGrowing
			s.Lands[0].Crop = &CropInstance{CropID: CropWheat}
		}, plotIndex: 0, message: "该土地不需要清除"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			result := applyRemoveAction(&candidate, testCase.plotIndex, nowMs)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestPrepareAndApplyBuySeedsActionAddsInventory(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Points = 100
	state.SeedInventory = json.RawMessage(`{"wheat":4}`)

	plan, result := prepareBuySeedsAction(&state, CropWheat, 3)
	if !result.OK || plan.TotalCost != 15 {
		t.Fatalf("unexpected buy seeds plan=%+v result=%+v", plan, result)
	}
	result = applyBuySeedsAction(&state, plan, 85, nowMs)
	if !result.OK || result.Balance != 85 {
		t.Fatalf("unexpected buy seeds result: %+v", result)
	}
	if state.Points != 85 || decodeIntMap(state.SeedInventory)["wheat"] != 7 {
		t.Fatalf("expected points and seed inventory updated, points=%d seeds=%s", state.Points, string(state.SeedInventory))
	}
}

func TestPrepareBuySeedsActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name    string
		mutate  func(*FarmState)
		cropID  CropID
		qty     int64
		message string
	}{
		{name: "unknown crop", cropID: CropID("bad"), qty: 1, message: "未知作物"},
		{name: "zero qty", cropID: CropWheat, qty: 0, message: "数量无效"},
		{name: "too many", cropID: CropWheat, qty: 100, message: "数量无效"},
		{name: "locked crop", cropID: CropTomato, qty: 1, message: "作物尚未解锁"},
		{name: "insufficient points", mutate: func(s *FarmState) {
			s.Points = 4
		}, cropID: CropWheat, qty: 1, message: "积分不足"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			candidate.Points = 100
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			_, result := prepareBuySeedsAction(&candidate, testCase.cropID, testCase.qty)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestPrepareAndApplyBuyLandActionUnlocksLand(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Points = 100

	plan, result := prepareBuyLandAction(&state, 5)
	if !result.OK || plan.Price != 50 {
		t.Fatalf("unexpected buy land plan=%+v result=%+v", plan, result)
	}
	result = applyBuyLandAction(&state, plan, 50, nowMs)
	if !result.OK || result.Balance != 50 {
		t.Fatalf("unexpected buy land result: %+v", result)
	}
	if state.Lands[4].Status != LandStatusEmpty || state.Points != 50 {
		t.Fatalf("expected fifth land unlocked and points updated, land=%+v points=%d", state.Lands[4], state.Points)
	}
	var events []map[string]any
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	found := false
	for _, event := range events {
		if event["type"] == "land_buy" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected land_buy event, got %+v", events)
	}
}

func TestPrepareBuyLandActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name      string
		mutate    func(*FarmState)
		landIndex int
		message   string
	}{
		{name: "bad land", landIndex: 99, message: "无效土地编号"},
		{name: "already unlocked", landIndex: 4, message: "该土地已解锁"},
		{name: "previous locked", landIndex: 6, message: "请先解锁前一块土地"},
		{name: "insufficient points", mutate: func(s *FarmState) {
			s.Points = 49
		}, landIndex: 5, message: "积分不足"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := newInitialState(1, nowMs)
			candidate.Points = 100
			if testCase.mutate != nil {
				testCase.mutate(&candidate)
			}
			_, result := prepareBuyLandAction(&candidate, testCase.landIndex)
			if result.OK || result.Msg != testCase.message {
				t.Fatalf("expected %q, got %+v", testCase.message, result)
			}
		})
	}
}

func TestPrepareAndApplyBuyShopItemActionAddsInventory(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Points = 100

	item := shopItemDef{Key: "pet_food_normal", Name: "普通宠粮", Cost: 15, DailyLimit: 3}
	plan, result := prepareBuyShopItemAction(&state, item, true, 2, "2025-01-06", 0, itemUsesDailyLimit(item))
	if !result.OK || plan.TotalCost != 30 || !plan.UsesDailyLimit {
		t.Fatalf("unexpected shop buy plan=%+v result=%+v", plan, result)
	}
	result = applyBuyShopItemAction(&state, plan, 70, nowMs)
	if !result.OK || result.Balance != 70 {
		t.Fatalf("unexpected shop buy result: %+v", result)
	}
	inventory := decodeInventory(state.Inventory)
	if state.Points != 70 || inventory["pet_food_normal"].Count != 2 || inventory["pet_food_normal"].UpdatedAt != nowMs {
		t.Fatalf("expected points and inventory updated, points=%d inventory=%+v", state.Points, inventory)
	}
}

func TestPrepareBuyShopItemActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name          string
		mutate        func(*FarmState)
		item          shopItemDef
		exists        bool
		qty           int64
		countToday    int64
		dailyLimit    bool
		expectedMsg   string
		expectedLimit bool
	}{
		{name: "unknown", exists: false, qty: 1, expectedMsg: "未知道具"},
		{name: "bad qty", item: shopItemDef{Key: "fert_normal", Name: "普通肥料", Cost: 20}, exists: true, qty: 0, expectedMsg: "数量无效"},
		{name: "one time qty", item: shopItemDef{Key: "weather_tv", Name: "天气电视机", Cost: 120}, exists: true, qty: 2, expectedMsg: "该设备每个账号只能购买 1 台"},
		{name: "one time duplicate", mutate: func(state *FarmState) {
			addToInventory(state, "weather_tv", 1, nowMs)
		}, item: shopItemDef{Key: "weather_tv", Name: "天气电视机", Cost: 120}, exists: true, qty: 1, expectedMsg: "该设备已购买，不能重复购买"},
		{name: "daily limit", item: shopItemDef{Key: "pet_food_normal", Name: "普通宠粮", Cost: 15, DailyLimit: 3}, exists: true, qty: 2, countToday: 2, dailyLimit: true, expectedMsg: "今日限购 3 个"},
		{name: "insufficient", item: shopItemDef{Key: "fert_normal", Name: "普通肥料", Cost: 20}, exists: true, qty: 6, expectedMsg: "积分不足"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			state := newInitialState(1, nowMs)
			state.Points = 100
			if testCase.mutate != nil {
				testCase.mutate(&state)
			}
			_, result := prepareBuyShopItemAction(&state, testCase.item, testCase.exists, testCase.qty, "2025-01-06", testCase.countToday, testCase.dailyLimit)
			if result.OK || result.Msg != testCase.expectedMsg {
				t.Fatalf("expected %q, got %+v", testCase.expectedMsg, result)
			}
		})
	}
}

func TestApplyUseShopItemActionAppliesFertilizer(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	addToInventory(&state, "fert_normal", 1, nowMs)
	state.Lands[0].Status = LandStatusGrowing
	state.Lands[0].Crop = &CropInstance{
		CropID:              CropWheat,
		PlantedAt:           nowMs,
		MatureAt:            nowMs + computeActualGrowthMs(CropWheat, SeasonSpring),
		LastWaterAt:         nowMs,
		NextWaterDueAt:      nowMs + 30*60*1000,
		PlantedSeason:       SeasonSpring,
		WeatherAtPlant:      WeatherSunny,
		SpeedUsed:           0,
		SpeedReducedMinutes: 0,
	}
	plotIndex := 0
	previousMatureAt := state.Lands[0].Crop.MatureAt

	result := applyUseShopItemAction(&state, shopItemDefs["fert_normal"], true, &plotIndex, nowMs)
	if !result.OK {
		t.Fatalf("unexpected use item result: %+v", result)
	}
	if state.Lands[0].Crop.Fertilizer == nil || *state.Lands[0].Crop.Fertilizer != "normal" {
		t.Fatalf("expected normal fertilizer, got %+v", state.Lands[0].Crop.Fertilizer)
	}
	if state.Lands[0].Crop.MatureAt >= previousMatureAt {
		t.Fatalf("expected matureAt reduced, previous=%d got=%d", previousMatureAt, state.Lands[0].Crop.MatureAt)
	}
	if decodeInventory(state.Inventory)["fert_normal"].Count != 0 {
		t.Fatalf("expected fertilizer consumed, inventory=%s", string(state.Inventory))
	}
}

func TestApplyUseShopItemActionLearnsPetSkill(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":80,"thirst":80,"hydrationVersion":2,"health":90,"learnedSkills":[],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	addToInventory(&state, "pet_skill_water", 1, nowMs)

	result := applyUseShopItemAction(&state, shopItemDefs["pet_skill_water"], true, nil, nowMs)
	if !result.OK {
		t.Fatalf("unexpected skill learn result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if !petHasSkill(pet, "water") {
		t.Fatalf("expected water skill learned, pet=%+v", pet)
	}
	if decodeInventory(state.Inventory)["pet_skill_water"].Count != 0 {
		t.Fatalf("expected skill book consumed, inventory=%s", string(state.Inventory))
	}
}

func TestApplyUseShopItemActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)

	cases := []struct {
		name     string
		item     shopItemDef
		exists   bool
		expected string
	}{
		{name: "unknown", item: shopItemDef{}, exists: false, expected: "未知道具"},
		{name: "needs land", item: shopItemDefs["fert_normal"], exists: true, expected: "请选择土地"},
		{name: "stock missing", item: shopItemDefs["scarecrow"], exists: true, expected: "库存不足"},
		{name: "cannot direct use", item: shopItemDefs["pet_food_normal"], exists: true, expected: "该道具无法直接使用"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			candidate := state
			result := applyUseShopItemAction(&candidate, testCase.item, testCase.exists, nil, nowMs)
			if result.OK || result.Msg != testCase.expected {
				t.Fatalf("expected %q, got %+v", testCase.expected, result)
			}
		})
	}
}

func TestPrepareAndApplyAdoptPetActionCreatesPet(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)

	plan, result := prepareAdoptPetAction(&state, "cat", "  小   咪  ", nowMs)
	if !result.OK || !plan.FirstAdopt || plan.PetName != "小 咪" {
		t.Fatalf("unexpected adopt pet plan=%+v result=%+v", plan, result)
	}
	result = applyAdoptPetAction(&state, plan, 110, nowMs)
	if !result.OK || result.Balance != 110 {
		t.Fatalf("unexpected adopt pet result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["type"] != "cat" || pet["name"] != "小 咪" || pet["stage"] != "child" {
		t.Fatalf("unexpected pet payload: %+v", pet)
	}
	if !bonusFlag(state.Bonuses, "firstAdopt") || state.Points != 110 {
		t.Fatalf("expected first adopt bonus state, points=%d bonuses=%s", state.Points, string(state.Bonuses))
	}
}

func TestPrepareAdoptPetActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name     string
		mutate   func(*FarmState)
		petType  string
		expected string
	}{
		{name: "bad type", petType: "fox", expected: "参数无效"},
		{name: "already adopted", petType: "cat", mutate: func(state *FarmState) {
			state.Pet = newPetJSON("cat", "小咪", nowMs)
		}, expected: "你已领养过宠物"},
		{name: "insufficient repeat", petType: "dog", mutate: func(state *FarmState) {
			state.Bonuses = setBonusFlag(state.Bonuses, "firstAdopt", true)
			state.Points = 49
		}, expected: "积分不足"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			state := newInitialState(1, nowMs)
			state.Points = 100
			if testCase.mutate != nil {
				testCase.mutate(&state)
			}
			_, result := prepareAdoptPetAction(&state, testCase.petType, "", nowMs)
			if result.OK || result.Msg != testCase.expected {
				t.Fatalf("expected %q, got %+v", testCase.expected, result)
			}
		})
	}
}

func TestApplyFeedPetActionUpdatesPetAndConsumesInventory(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = newPetJSON("cat", "小咪", nowMs)
	addToInventory(&state, "pet_food_normal", 1, nowMs)

	result := applyFeedPetAction(&state, shopItemDefs["pet_food_normal"], true, "normal")
	if !result.OK {
		t.Fatalf("unexpected feed pet result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["hunger"].(float64) != 100 || pet["growth"].(float64) != 5 {
		t.Fatalf("unexpected fed pet stats: %+v", pet)
	}
	feedToday := pet["feedToday"].(map[string]any)
	if feedToday["normal"].(float64) != 1 {
		t.Fatalf("expected normal feed count 1, got %+v", feedToday)
	}
	if decodeInventory(state.Inventory)["pet_food_normal"].Count != 0 {
		t.Fatalf("expected food consumed, inventory=%s", string(state.Inventory))
	}
}

func TestApplyFeedPetActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name     string
		mutate   func(*FarmState)
		kind     string
		expected string
	}{
		{name: "bad kind", kind: "bad", expected: "参数无效"},
		{name: "no pet", kind: "normal", expected: "请先领养宠物"},
		{name: "stock missing", kind: "normal", mutate: func(state *FarmState) {
			state.Pet = newPetJSON("cat", "小咪", nowMs)
		}, expected: "库存不足，请先在商店购买普通宠粮"},
		{name: "daily limit", kind: "normal", mutate: func(state *FarmState) {
			state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":0,"hunger":80,"cleanliness":80,"mood":55,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":[],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":3,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
			addToInventory(state, "pet_food_normal", 1, nowMs)
		}, expected: "今日普通宠粮已用完"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			state := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&state)
			}
			result := applyFeedPetAction(&state, shopItemDefs["pet_food_normal"], true, testCase.kind)
			if result.OK || result.Msg != testCase.expected {
				t.Fatalf("expected %q, got %+v", testCase.expected, result)
			}
		})
	}
}

func TestApplyPetItemActionUpdatesPetStats(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = newPetJSON("cat", "小咪", nowMs)

	result := applyPetItemAction(&state, shopItemDefs["pet_water_basic"], true, "drink")
	if !result.OK {
		t.Fatalf("unexpected drink pet result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["thirst"].(float64) != 100 || pet["mood"].(float64) != 57 || pet["growth"].(float64) != 1 {
		t.Fatalf("unexpected pet stats after drink: %+v", pet)
	}
}

func TestApplyPetItemActionConsumesPaidItemAndAppliesDailyLimit(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = newPetJSON("cat", "小咪", nowMs)
	addToInventory(&state, "pet_wash", 1, nowMs)

	result := applyPetItemAction(&state, shopItemDefs["pet_wash"], true, "rest")
	if !result.OK {
		t.Fatalf("unexpected wash result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["washToday"].(float64) != 1 || pet["cleanliness"].(float64) != 100 {
		t.Fatalf("unexpected pet stats after wash: %+v", pet)
	}
	if decodeInventory(state.Inventory)["pet_wash"].Count != 0 {
		t.Fatalf("expected wash item consumed, inventory=%s", string(state.Inventory))
	}

	addToInventory(&state, "pet_wash", 1, nowMs)
	result = applyPetItemAction(&state, shopItemDefs["pet_wash"], true, "rest")
	if result.OK || result.Msg != "今日洗澡券已用完" {
		t.Fatalf("expected daily wash limit, got %+v", result)
	}
}

func TestApplyPetItemActionValidatesRules(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()

	cases := []struct {
		name     string
		mutate   func(*FarmState)
		item     shopItemDef
		exists   bool
		category string
		expected string
	}{
		{name: "unknown", exists: false, category: "drink", expected: "未知物品"},
		{name: "category mismatch", item: shopItemDefs["pet_milk"], exists: true, category: "care", expected: "物品类别不匹配"},
		{name: "no pet", item: shopItemDefs["pet_milk"], exists: true, category: "drink", expected: "请先领养宠物"},
		{name: "stock missing", item: shopItemDefs["pet_milk"], exists: true, category: "drink", mutate: func(state *FarmState) {
			state.Pet = newPetJSON("cat", "小咪", nowMs)
		}, expected: "库存不足，请先在商店购买牛奶"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			state := newInitialState(1, nowMs)
			if testCase.mutate != nil {
				testCase.mutate(&state)
			}
			result := applyPetItemAction(&state, testCase.item, testCase.exists, testCase.category)
			if result.OK || result.Msg != testCase.expected {
				t.Fatalf("expected %q, got %+v", testCase.expected, result)
			}
		})
	}
}

func TestApplyDispatchPetActionStartsWaterTaskWithCooldown(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = readyAdultPetJSON("cat", []string{"water"})

	result := applyDispatchPetAction(&state, "water", nowMs)
	if !result.OK {
		t.Fatalf("unexpected dispatch result: %+v", result)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != "water" {
		t.Fatalf("expected water task, got %+v", pet)
	}
	if pet["taskEndAt"].(float64) != float64(nowMs+180*60*1000) {
		t.Fatalf("unexpected taskEndAt: %+v", pet)
	}
	if pet["cooldownEndAt"].(float64) != float64(nowMs+(180+45)*60*1000) {
		t.Fatalf("unexpected cooldownEndAt: %+v", pet)
	}
}

func TestApplyDispatchPetActionHarvestsMatureCrops(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = readyAdultPetJSON("cat", []string{"harvest"})
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      nowMs - 2*60*60*1000,
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - 2*60*60*1000,
		NextWaterDueAt: nowMs - 60*60*1000,
		PlantedSeason:  SeasonSpring,
		WeatherAtPlant: WeatherSunny,
	}

	result := applyDispatchPetAction(&state, "harvest", nowMs)
	if !result.OK || result.Total <= 0 || len(result.Harvests) != 1 || result.Msg == "" {
		t.Fatalf("unexpected harvest dispatch result: %+v", result)
	}
	if state.Lands[0].Status != LandStatusEmpty || state.Lands[0].Crop != nil {
		t.Fatalf("expected harvested land to be empty, got %+v", state.Lands[0])
	}
	if !bonusFlag(state.Bonuses, "firstHarvest") || result.Bonus != firstHarvestBonus {
		t.Fatalf("expected first harvest bonus, result=%+v bonuses=%s", result, string(state.Bonuses))
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != "harvest" || pet["cooldownEndAt"].(float64) != float64(nowMs+120*60*1000) {
		t.Fatalf("unexpected pet task after harvest: %+v", pet)
	}
}

func TestApplyDispatchPetActionPlantsUpToLimit(t *testing.T) {
	nowMs := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, nowMs)
	state.Pet = readyAdultPetJSON("cat", []string{"plant"})

	result := applyDispatchPetAction(&state, "plant", nowMs)
	if !result.OK || result.Count != petAutoPlantMax || result.Msg == "" {
		t.Fatalf("unexpected plant dispatch result: %+v", result)
	}
	planted := 0
	for _, land := range state.Lands {
		if land.Crop != nil {
			planted++
		}
	}
	if planted != petAutoPlantMax {
		t.Fatalf("expected %d planted lands, got %d", petAutoPlantMax, planted)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != "plant" || pet["cooldownEndAt"].(float64) != float64(nowMs+120*60*1000) {
		t.Fatalf("unexpected pet task after plant: %+v", pet)
	}
}

func readyAdultPetJSON(petType string, skills []string) json.RawMessage {
	encodedSkills, _ := json.Marshal(skills)
	return json.RawMessage(`{"type":"` + petType + `","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":80,"thirst":80,"hydrationVersion":2,"health":90,"learnedSkills":` + string(encodedSkills) + `,"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
}
