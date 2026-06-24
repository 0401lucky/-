package farm

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const (
	petDailyDecayHunger      = 14
	petDailyDecayCleanliness = 10
	petDailyDecayMood        = 8
	petDailyDecayThirst      = 16

	petHourlyDecayHunger         = 0.6
	petHourlyDecayCleanliness    = 0.45
	petHourlyDecayThirst         = 0.7
	petHourlyDecayMoodBase       = 0.3
	petHourlyDecayMoodBadStat    = 0.5
	petHourlyDecayHealthBase     = 0.15
	petHourlyDecayHealthCritical = 0.7

	petAdultGrowthThreshold = 160
	petMoodStopWork         = 15
	waterActionLeadMs       = int64(10 * 60 * 1000)
)

func processPetLazyState(state *FarmState, lastTickAt int64, nowMs int64) bool {
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return false
	}
	changed := false
	if normalizePetMap(pet) {
		changed = true
	}
	if processPetDailyDecayMap(state, pet, nowMs) {
		changed = true
	}
	if processPetTimeDecayMap(pet, lastTickAt, nowMs) {
		changed = true
	}
	if processPetTaskEndMap(pet, nowMs) {
		changed = true
	}
	if stopped, taskName := maybeStopPetWorkOnLowMoodMap(pet, nowMs); stopped {
		pushEvent(state, farmEvent{
			ID:   eventID(state.UserID, "pet_task_stop", nowMs, 0),
			Ts:   nowMs,
			Type: "pet_task",
			Text: fmt.Sprintf("情绪太低，宠物罢工，%s被中止", petTaskLabel(taskName)),
		})
		changed = true
	}
	if changed {
		state.Pet = encodeJSONOrDefault(pet, `null`)
	}
	return changed
}

func processPetWaterTask(state *FarmState, lastTickAt int64, nowMs int64) bool {
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return false
	}
	task, _ := pet["currentTask"].(string)
	if task != "water" {
		return false
	}
	taskStartAt, startOK := petOptionalInt64(pet, "taskStartAt")
	taskEndAt, endOK := petOptionalInt64(pet, "taskEndAt")
	if !startOK || !endOK {
		return false
	}
	startTick := maxInt64(lastTickAt, taskStartAt)
	stop := minInt64(nowMs, taskEndAt)
	changed := false
	if stop > startTick {
		for i := range state.Lands {
			land := &state.Lands[i]
			if land.Crop == nil {
				continue
			}
			if land.Status == LandStatusLocked || land.Status == LandStatusEmpty || land.Status == LandStatusMature ||
				land.Status == LandStatusWithered || land.Status == LandStatusEaten {
				continue
			}
			crop := land.Crop
			if crop.WaterMissCount >= 3 {
				continue
			}
			waterAt := maxInt64(maxInt64(crop.NextWaterDueAt-waterActionLeadMs, startTick), crop.PlantedAt)
			for waterAt <= stop && waterAt < crop.MatureAt {
				season := getCurrentSeason(waterAt)
				date := getChinaDateString(waterAt)
				weather := getWeatherForDate(date, season)
				intervalMs := computeActualWaterIntervalMs(crop.CropID, season, weather)
				crop.LastWaterAt = waterAt
				crop.NextWaterDueAt = waterAt + intervalMs
				land.Status = LandStatusGrowing
				changed = true
				waterAt = crop.NextWaterDueAt
			}
		}
	}
	if taskEndAt <= nowMs {
		pet["currentTask"] = nil
		pet["taskStartAt"] = nil
		pet["taskEndAt"] = nil
		changed = true
	}
	if changed {
		state.Pet = encodeJSONOrDefault(pet, `null`)
	}
	return changed
}

func processPassivePetPlant(state *FarmState, nowMs int64) bool {
	if !hasAdultPetSkill(state.Pet, "plant") {
		return false
	}
	season := getCurrentSeason(nowMs)
	date := getChinaDateString(nowMs)
	weather := getWeatherForDate(date, season)
	planted := []CropID{}
	for i := range state.Lands {
		if state.Lands[i].Status != LandStatusEmpty && state.Lands[i].Status != LandStatusEaten {
			continue
		}
		cropID, ok := pickPetPlantCrop(state, season)
		if !ok {
			break
		}
		if plantCropFromInventory(state, i, cropID, nowMs, season, weather) {
			planted = append(planted, cropID)
		}
	}
	if len(planted) == 0 {
		return false
	}
	names := make([]string, 0, len(planted))
	for _, cropID := range planted {
		names = append(names, cropName(cropID))
	}
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "pet_passive_plant", nowMs, len(planted)),
		Ts:   nowMs,
		Type: "pet_task",
		Text: fmt.Sprintf("宠物种菜被动触发，自动播种 %d 块：%s", len(planted), strings.Join(names, "、")),
	})
	return true
}

func hasAdultPetSkill(raw json.RawMessage, skill string) bool {
	pet, ok := decodePetMap(raw)
	if !ok {
		return false
	}
	if changed := normalizePetMap(pet); changed {
		// 被动判定只读，normalize 结果由调用链其他宠物 tick 写回。
		_ = changed
	}
	stage, _ := pet["stage"].(string)
	if stage != "adult" {
		return false
	}
	skills, ok := pet["learnedSkills"].([]any)
	if !ok {
		return false
	}
	for _, item := range skills {
		if value, _ := item.(string); value == skill {
			return true
		}
	}
	return false
}

func pickPetPlantCrop(state *FarmState, season Season) (CropID, bool) {
	unlockedLandCount := 0
	for _, land := range state.Lands {
		if land.Status != LandStatusLocked {
			unlockedLandCount++
		}
	}
	seeds := decodeIntMap(state.SeedInventory)
	var picked cropDef
	found := false
	for _, crop := range cropDefs {
		if !seasonContains(crop.Seasons, season) {
			continue
		}
		if crop.UnlockLandCount > unlockedLandCount {
			continue
		}
		if seeds[string(crop.ID)] <= 0 {
			continue
		}
		if !found || crop.BaseYield > picked.BaseYield || (crop.BaseYield == picked.BaseYield && crop.GrowthMinutes < picked.GrowthMinutes) {
			picked = crop
			found = true
		}
	}
	return picked.ID, found
}

func plantCropFromInventory(state *FarmState, landIndex int, cropID CropID, nowMs int64, season Season, weather Weather) bool {
	if landIndex < 0 || landIndex >= len(state.Lands) {
		return false
	}
	land := &state.Lands[landIndex]
	if land.Status != LandStatusEmpty && land.Status != LandStatusEaten {
		return false
	}
	seeds := decodeIntMap(state.SeedInventory)
	if seeds[string(cropID)] <= 0 {
		return false
	}
	seeds[string(cropID)]--
	state.SeedInventory = encodeJSONOrDefault(seeds, `{}`)
	land.Status = LandStatusGrowing
	land.Crop = &CropInstance{
		CropID:              cropID,
		PlantedAt:           nowMs,
		MatureAt:            nowMs + computeActualGrowthMs(cropID, season),
		LastWaterAt:         nowMs,
		NextWaterDueAt:      nowMs + computeActualWaterIntervalMs(cropID, season, weather),
		WaterMissCount:      0,
		Fertilizer:          nil,
		PlantedSeason:       season,
		WeatherAtPlant:      weather,
		BirdNetUntil:        nil,
		StolenAmount:        0,
		StolenCount:         0,
		SpeedUsed:           0,
		SpeedReducedMinutes: 0,
	}
	return true
}

func decodePetMap(raw json.RawMessage) (map[string]any, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false
	}
	var pet map[string]any
	if err := json.Unmarshal(raw, &pet); err != nil || pet == nil {
		return nil, false
	}
	return pet, true
}

func normalizePetMap(pet map[string]any) bool {
	changed := false
	petType, _ := pet["type"].(string)
	if petType == "" {
		petType = "cat"
		pet["type"] = petType
		changed = true
	}
	name, _ := pet["name"].(string)
	if name == "" {
		pet["name"] = activePet{Type: petType}.DisplayName()
		changed = true
	}
	for _, key := range []string{"growth", "hunger", "cleanliness", "mood", "thirst", "health"} {
		value := petNumber(pet, key)
		next := value
		if key == "growth" {
			next = math.Max(0, math.Floor(value))
		} else {
			next = clamp01To100(value)
		}
		if next != value {
			pet[key] = next
			changed = true
		}
	}
	if _, ok := pet["hydrationVersion"]; !ok {
		pet["hydrationVersion"] = float64(2)
		changed = true
	}
	if normalizePetStage(pet) {
		changed = true
	}
	if normalizePetCounterObject(pet, "feedToday", map[string]float64{"normal": 0, "premium": 0}) {
		changed = true
	}
	for _, key := range []string{"washToday", "waterToday", "playToday", "toyToday"} {
		value := petNumber(pet, key)
		if value < 0 {
			pet[key] = float64(0)
			changed = true
		}
	}
	if _, ok := pet["learnedSkills"].([]any); !ok {
		if _, exists := pet["learnedSkills"]; !exists {
			pet["learnedSkills"] = []any{}
			changed = true
		}
	}
	return changed
}

func processPetDailyDecayMap(state *FarmState, pet map[string]any, nowMs int64) bool {
	last := state.LastDailyResetAt
	if last <= 0 {
		last = int64(petNumber(pet, "dailyResetAt"))
	}
	if last <= 0 {
		last = nowMs
	}
	if getChinaDateString(last) == getChinaDateString(nowMs) {
		return false
	}
	days := (nowMs - last) / dayMs
	if days <= 0 {
		days = 1
	}
	if days > 7 {
		days = 7
	}

	pet["hunger"] = clamp01To100(petNumber(pet, "hunger") - petDailyDecayHunger*float64(days))
	pet["cleanliness"] = clamp01To100(petNumber(pet, "cleanliness") - petDailyDecayCleanliness*float64(days))
	pet["mood"] = clamp01To100(petNumber(pet, "mood") - petDailyDecayMood*float64(days))
	pet["thirst"] = clamp01To100(petNumber(pet, "thirst") - petDailyDecayThirst*float64(days))
	pet["health"] = clamp01To100(petNumber(pet, "health") + computePetDailyHealthDelta(pet)*float64(days))
	pet["feedToday"] = map[string]any{"normal": float64(0), "premium": float64(0)}
	pet["washToday"] = float64(0)
	pet["waterToday"] = float64(0)
	pet["playToday"] = float64(0)
	pet["toyToday"] = float64(0)
	pet["dailyResetAt"] = float64(nowMs)
	state.StolenTodayCount = 0
	state.StolenByMap = map[string]int64{}
	state.MyStealMap = map[string]int64{}
	state.LastDailyResetAt = nowMs
	normalizePetStage(pet)
	return true
}

func processPetTimeDecayMap(pet map[string]any, lastTickAt int64, nowMs int64) bool {
	if nowMs <= lastTickAt {
		return false
	}
	hours := float64(nowMs-lastTickAt) / float64(60*60*1000)
	if hours <= 0 {
		return false
	}
	pet["hunger"] = clamp01To100(petNumber(pet, "hunger") - petHourlyDecayHunger*hours)
	pet["cleanliness"] = clamp01To100(petNumber(pet, "cleanliness") - petHourlyDecayCleanliness*hours)
	pet["thirst"] = clamp01To100(petNumber(pet, "thirst") - petHourlyDecayThirst*hours)
	moodDrop := petHourlyDecayMoodBase
	if petNumber(pet, "hunger") < 30 {
		moodDrop += petHourlyDecayMoodBadStat
	}
	if petNumber(pet, "thirst") < 30 {
		moodDrop += petHourlyDecayMoodBadStat
	}
	if petNumber(pet, "cleanliness") < 30 {
		moodDrop += petHourlyDecayMoodBadStat
	}
	if petNumber(pet, "health") < 40 {
		moodDrop += petHourlyDecayMoodBadStat
	}
	pet["mood"] = clamp01To100(petNumber(pet, "mood") - moodDrop*hours)
	critical := petNumber(pet, "hunger") < 20 || petNumber(pet, "thirst") < 20 || petNumber(pet, "cleanliness") < 20 || petNumber(pet, "mood") < 20
	healthDrop := petHourlyDecayHealthBase
	if critical {
		healthDrop = petHourlyDecayHealthCritical
	}
	pet["health"] = clamp01To100(petNumber(pet, "health") - healthDrop*hours)
	normalizePetStage(pet)
	return true
}

func processPetTaskEndMap(pet map[string]any, nowMs int64) bool {
	task, _ := pet["currentTask"].(string)
	if task == "" {
		return false
	}
	taskEndAt, ok := petOptionalInt64(pet, "taskEndAt")
	if !ok || taskEndAt > nowMs || task == "steal" || task == "water" {
		return false
	}
	pet["currentTask"] = nil
	pet["taskStartAt"] = nil
	pet["taskEndAt"] = nil
	return true
}

func maybeStopPetWorkOnLowMoodMap(pet map[string]any, nowMs int64) (bool, string) {
	task, _ := pet["currentTask"].(string)
	if task == "" {
		return false, ""
	}
	if taskEndAt, ok := petOptionalInt64(pet, "taskEndAt"); ok && taskEndAt <= nowMs {
		return false, ""
	}
	if petNumber(pet, "mood") >= petMoodStopWork {
		return false, ""
	}
	pet["currentTask"] = nil
	pet["taskStartAt"] = nil
	pet["taskEndAt"] = nil
	pet["stealTarget"] = nil
	return true, task
}

func computePetDailyHealthDelta(pet map[string]any) float64 {
	if petNumber(pet, "hunger") < 15 || petNumber(pet, "cleanliness") < 15 || petNumber(pet, "thirst") < 10 {
		return -14
	}
	if petNumber(pet, "hunger") < 35 || petNumber(pet, "cleanliness") < 35 || petNumber(pet, "thirst") < 30 {
		return -7
	}
	if petNumber(pet, "mood") < 25 {
		return -4
	}
	if petNumber(pet, "hunger") >= 60 && petNumber(pet, "cleanliness") >= 60 && petNumber(pet, "thirst") >= 65 && petNumber(pet, "mood") >= 55 {
		return 5
	}
	return 0
}

func normalizePetStage(pet map[string]any) bool {
	stage := "child"
	if petNumber(pet, "growth") >= petAdultGrowthThreshold {
		stage = "adult"
	}
	if current, _ := pet["stage"].(string); current != stage {
		pet["stage"] = stage
		return true
	}
	return false
}

func normalizePetCounterObject(pet map[string]any, key string, defaults map[string]float64) bool {
	object, ok := pet[key].(map[string]any)
	if !ok || object == nil {
		object = map[string]any{}
		pet[key] = object
	}
	changed := !ok
	for name, fallback := range defaults {
		value, exists := object[name]
		number := anyNumber(value)
		if !exists || number < 0 {
			object[name] = fallback
			changed = true
		}
	}
	return changed
}

func petOptionalInt64(pet map[string]any, key string) (int64, bool) {
	value, exists := pet[key]
	if !exists || value == nil {
		return 0, false
	}
	return int64(anyNumber(value)), true
}

func petNumber(pet map[string]any, key string) float64 {
	return anyNumber(pet[key])
}

func clamp01To100(value float64) float64 {
	return math.Max(0, math.Min(100, value))
}

func petTaskLabel(task string) string {
	switch task {
	case "water":
		return "自动浇水"
	case "guard":
		return "守护庄园"
	case "chase_crow":
		return "赶乌鸦"
	case "steal":
		return "偷菜"
	case "harvest":
		return "收菜"
	case "plant":
		return "种菜"
	default:
		return "任务"
	}
}
