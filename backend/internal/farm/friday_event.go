package farm

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

const fridayEventCropDelayMs = int64(10 * 60 * 1000)

type inventoryItem struct {
	Count     int64 `json:"count"`
	UpdatedAt int64 `json:"updatedAt"`
}

type fridayEventFn func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string

var fridayRandomEvents = []fridayEventFn{
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		cropID := pickFridaySeedCrop(state, season, rng)
		addSeeds(state, cropID, 2)
		return fmt.Sprintf("周五随机事件：丰收商队路过，送来 %s种子 ×2", cropName(cropID))
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		addToInventory(state, "fert_normal", 1, nowMs)
		return "周五随机事件：园艺补给箱送达，获得普通肥料 ×1"
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		lands := getUnfinishedCropLandIndexes(state)
		if len(lands) == 0 {
			addToInventory(state, "cloud_bottle", 1, nowMs)
			return "周五随机事件：午后云雨没有找到作物，凝成了云朵瓶 ×1"
		}
		for _, index := range lands {
			land := &state.Lands[index]
			if land.Crop == nil {
				continue
			}
			intervalMs := computeActualWaterIntervalMs(land.Crop.CropID, season, weather)
			land.Crop.LastWaterAt = nowMs
			land.Crop.NextWaterDueAt = nowMs + intervalMs
			if land.Crop.WaterMissCount > 0 {
				land.Crop.WaterMissCount--
			}
			land.Status = LandStatusGrowing
		}
		return fmt.Sprintf("周五随机事件：午后云雨滋润了 %d 块未成熟作物", len(lands))
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		if len(state.Pet) == 0 || string(state.Pet) == "null" {
			addToInventory(state, "pet_milk", 1, nowMs)
			return "周五随机事件：邻居送来宠物牛奶 ×1，留给未来的小伙伴"
		}
		petName := improvePetMoodHealthThirst(state)
		return fmt.Sprintf("周五随机事件：%s今天心情特别好，情绪、健康和口渴值提升", petName)
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		lands := getUnfinishedCropLandIndexes(state)
		if len(lands) == 0 {
			return fmt.Sprintf("周五随机事件：干燥热风吹过仓库，%s", removeRandomSeed(state, rng))
		}
		for _, index := range lands {
			land := &state.Lands[index]
			if land.Crop == nil {
				continue
			}
			land.Crop.WaterMissCount = minInt64(2, land.Crop.WaterMissCount+1)
			land.Status = LandStatusThirsty
		}
		return fmt.Sprintf("周五随机事件：干燥热风来袭，%d 块未成熟作物变得口渴", len(lands))
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		lands := getUnfinishedCropLandIndexes(state)
		targetIndex, ok := pickRandomInt(lands, rng)
		if !ok || state.Lands[targetIndex].Crop == nil {
			return fmt.Sprintf("周五随机事件：杂草疯长到仓库边，%s", removeRandomSeed(state, rng))
		}
		target := &state.Lands[targetIndex]
		target.Crop.MatureAt += 10 * 60 * 1000
		return fmt.Sprintf("周五随机事件：第 %d 块地杂草疯长，%s成熟延后 10 分钟", target.Index, cropName(target.Crop.CropID))
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		targets := getCrowEventTargetIndexes(state, nowMs)
		targetIndex, ok := pickRandomInt(targets, rng)
		if !ok || state.Lands[targetIndex].Crop == nil {
			return fmt.Sprintf("周五随机事件：乌鸦侦察队扑了个空，%s", removeRandomSeed(state, rng))
		}
		target := &state.Lands[targetIndex]
		cropName := cropName(target.Crop.CropID)
		target.Status = LandStatusEaten
		target.Crop = nil
		return fmt.Sprintf("周五随机事件：乌鸦侦察队突袭，第 %d 块地的 %s 被吃掉了", target.Index, cropName)
	},
	func(state *FarmState, rng *seedRandom, nowMs int64, season Season, weather Weather) string {
		seedLoss := removeRandomSeed(state, rng)
		if !strings.Contains(seedLoss, "避开") {
			return fmt.Sprintf("周五随机事件：货车延误弄丢了一份货物，%s", seedLoss)
		}
		itemLoss, ok := removeRandomInventoryItem(state, rng)
		if ok {
			return fmt.Sprintf("周五随机事件：货车延误弄丢了一份货物，%s", itemLoss)
		}
		return "周五随机事件：货车延误，但仓库太空，什么都没有损失"
	},
}

func maybeApplyFridayEvent(state *FarmState, nowMs int64) bool {
	date := getChinaDateString(nowMs)
	if getChinaWeekday(nowMs) != 5 {
		return false
	}
	if state.LastFridayEventDate == date {
		return false
	}
	season := getCurrentSeason(nowMs)
	weather := getWeatherForDate(date, season)
	rng := newSeedRandom(fmt.Sprintf("farm-friday-event:%d:%s", state.UserID, date))
	index := int(math.Floor(rng.Float64() * float64(len(fridayRandomEvents))))
	if index < 0 || index >= len(fridayRandomEvents) {
		return false
	}
	text := fridayRandomEvents[index](state, rng, nowMs, season, weather)
	state.LastFridayEventDate = date
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "friday_event", nowMs, index),
		Ts:   nowMs,
		Type: "friday_event",
		Text: text,
	})
	return true
}

func getChinaWeekday(ts int64) int {
	return int(timeFromUnixMilli(ts + chinaTZOffsetMs).UTC().Weekday())
}

func pickFridaySeedCrop(state *FarmState, season Season, rng *seedRandom) CropID {
	plantable := getPlantableCrops(*state, season)
	if len(plantable) > 0 {
		return plantable[int(math.Floor(rng.Float64()*float64(len(plantable))))]
	}
	unlockedLandCount := 0
	for _, land := range state.Lands {
		if land.Status != LandStatusLocked {
			unlockedLandCount++
		}
	}
	unlocked := []CropID{}
	for _, crop := range cropDefs {
		if crop.UnlockLandCount <= unlockedLandCount {
			unlocked = append(unlocked, crop.ID)
		}
	}
	if len(unlocked) == 0 {
		return CropWheat
	}
	return unlocked[int(math.Floor(rng.Float64()*float64(len(unlocked))))]
}

func getUnfinishedCropLandIndexes(state *FarmState) []int {
	result := []int{}
	for i, land := range state.Lands {
		if land.Crop == nil {
			continue
		}
		if land.Status == LandStatusGrowing || land.Status == LandStatusThirsty {
			result = append(result, i)
		}
	}
	return result
}

func getCrowEventTargetIndexes(state *FarmState, nowMs int64) []int {
	result := []int{}
	for i, land := range state.Lands {
		if land.Crop == nil {
			continue
		}
		if land.Status != LandStatusGrowing && land.Status != LandStatusThirsty && land.Status != LandStatusMature {
			continue
		}
		if nowMs-land.Crop.PlantedAt < fridayEventCropDelayMs {
			continue
		}
		if land.Crop.BirdNetUntil != nil && *land.Crop.BirdNetUntil > nowMs {
			continue
		}
		result = append(result, i)
	}
	return result
}

func addSeeds(state *FarmState, cropID CropID, qty int64) {
	seeds := decodeIntMap(state.SeedInventory)
	seeds[string(cropID)] += qty
	state.SeedInventory = encodeJSONOrDefault(seeds, `{}`)
}

func removeRandomSeed(state *FarmState, rng *seedRandom) string {
	seeds := decodeIntMap(state.SeedInventory)
	keys := make([]string, 0, len(seeds))
	for key, count := range seeds {
		if count > 0 {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return "仓库正好没有种子，损失被避开了"
	}
	key := keys[int(math.Floor(rng.Float64()*float64(len(keys))))]
	seeds[key] = maxInt64(0, seeds[key]-1)
	state.SeedInventory = encodeJSONOrDefault(seeds, `{}`)
	return fmt.Sprintf("%s种子 -1", cropName(CropID(key)))
}

func addToInventory(state *FarmState, key string, qty int64, nowMs int64) {
	inventory := decodeInventory(state.Inventory)
	item := inventory[key]
	item.Count += qty
	item.UpdatedAt = nowMs
	inventory[key] = item
	state.Inventory = encodeJSONOrDefault(inventory, `{}`)
}

func removeRandomInventoryItem(state *FarmState, rng *seedRandom) (string, bool) {
	inventory := decodeInventory(state.Inventory)
	keys := make([]string, 0, len(inventory))
	for key, item := range inventory {
		if item.Count > 0 {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return "", false
	}
	key := keys[int(math.Floor(rng.Float64()*float64(len(keys))))]
	item := inventory[key]
	item.Count = maxInt64(0, item.Count-1)
	inventory[key] = item
	state.Inventory = encodeJSONOrDefault(inventory, `{}`)
	return fmt.Sprintf("%s -1", inventoryItemName(key)), true
}

func improvePetMoodHealthThirst(state *FarmState) string {
	var pet map[string]any
	if err := json.Unmarshal(state.Pet, &pet); err != nil || pet == nil {
		addToInventory(state, "pet_milk", 1, 0)
		return "宠物"
	}
	pet["mood"] = clampStat(anyNumber(pet["mood"]) + 12)
	pet["health"] = clampStat(anyNumber(pet["health"]) + 5)
	pet["thirst"] = clampStat(anyNumber(pet["thirst"]) + 8)
	name, _ := pet["name"].(string)
	petType, _ := pet["type"].(string)
	state.Pet = encodeJSONOrDefault(pet, `null`)
	if name != "" {
		return name
	}
	return activePet{Type: petType}.DisplayName()
}

func decodeIntMap(raw json.RawMessage) map[string]int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]int64{}
	}
	var result map[string]int64
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return map[string]int64{}
	}
	return result
}

func decodeInventory(raw json.RawMessage) map[string]inventoryItem {
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]inventoryItem{}
	}
	var result map[string]inventoryItem
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return map[string]inventoryItem{}
	}
	return result
}

func encodeJSONOrDefault(value any, fallback string) json.RawMessage {
	raw, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(fallback)
	}
	return raw
}

func clampStat(value float64) int64 {
	return minInt64(100, maxInt64(0, int64(math.Round(value))))
}

func anyNumber(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	default:
		return 0
	}
}

func pickRandomInt(values []int, rng *seedRandom) (int, bool) {
	if len(values) == 0 {
		return 0, false
	}
	return values[int(math.Floor(rng.Float64()*float64(len(values))))], true
}

func inventoryItemName(key string) string {
	names := map[string]string{
		"fert_normal":      "普通肥料",
		"fert_medium":      "中级肥料",
		"fert_premium":     "高级肥料",
		"scarecrow":        "稻草人",
		"birdnet":          "防鸟网",
		"bell":             "看守铃铛",
		"firework":         "驱鸟烟花",
		"cloud_bottle":     "云朵瓶",
		"speed_normal":     "加速券",
		"speed_premium":    "高级加速",
		"weather_tv":       "天气电视机",
		"pet_food_normal":  "普通宠粮",
		"pet_food_premium": "高级宠粮",
		"pet_milk":         "牛奶",
	}
	if name, ok := names[key]; ok {
		return name
	}
	return "道具"
}
