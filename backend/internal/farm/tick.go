package farm

import (
	"encoding/json"
	"fmt"
)

const (
	maxEvents        = 30
	crowBaseChance   = 0.08
	crowCheckWindow  = int64(10 * 60 * 1000)
	crowInitialDelay = int64(10 * 60 * 1000)
)

type farmEvent struct {
	ID        string `json:"id"`
	Ts        int64  `json:"ts"`
	Type      string `json:"type"`
	Text      string `json:"text"`
	CropID    CropID `json:"cropId,omitempty"`
	LandIndex int    `json:"landIndex,omitempty"`
	Amount    int64  `json:"amount,omitempty"`
}

func tickBasicCropState(state *FarmState, nowMs int64) bool {
	if state == nil {
		return false
	}
	changed := false
	season := getCurrentSeason(nowMs)
	date := getChinaDateString(nowMs)
	weather := getWeatherForDate(date, season)

	if processPetLazyState(state, state.LastTickAt, nowMs) {
		changed = true
	}

	if state.LastSeasonProcessedAt > 0 && getCurrentSeason(state.LastSeasonProcessedAt) != season {
		withered := 0
		for i := range state.Lands {
			land := &state.Lands[i]
			if land.Crop == nil || land.Status == LandStatusLocked || land.Status == LandStatusEmpty {
				continue
			}
			if land.Crop.PlantedSeason != season {
				land.Status = LandStatusWithered
				withered++
				changed = true
			}
		}
		if withered > 0 {
			pushEvent(state, farmEvent{
				ID:   eventID(state.UserID, "season", nowMs, 0),
				Ts:   nowMs,
				Type: "season_change",
				Text: fmt.Sprintf("换季到「%s」，%d 块上一季作物枯萎", seasonLabel(season), withered),
			})
		}
		state.LastSeasonProcessedAt = nowMs
		changed = true
	} else if state.LastSeasonProcessedAt <= 0 {
		state.LastSeasonProcessedAt = nowMs
		changed = true
	}

	if applyRainAutoWater(state, state.LastTickAt, nowMs, season, weather) {
		changed = true
	}
	if processPetWaterTask(state, state.LastTickAt, nowMs) {
		changed = true
	}

	for i := range state.Lands {
		land := &state.Lands[i]
		if land.Crop == nil {
			continue
		}
		if land.Status == LandStatusWithered || land.Status == LandStatusEaten {
			continue
		}
		crop := land.Crop
		if nowMs < crop.MatureAt {
			intervalMs := computeActualWaterIntervalMs(crop.CropID, season, weather)
			prevMissCount := crop.WaterMissCount
			nextMissCount, nextDue := computeWaterMissesAfterWindow(*crop, intervalMs, nowMs)
			if nextMissCount != crop.WaterMissCount || nextDue != crop.NextWaterDueAt {
				crop.WaterMissCount = nextMissCount
				crop.NextWaterDueAt = nextDue
				changed = true
			}
			if crop.WaterMissCount >= 3 && land.Status != LandStatusWithered {
				land.Status = LandStatusWithered
				changed = true
			} else if crop.WaterMissCount > prevMissCount && land.Status != LandStatusThirsty {
				land.Status = LandStatusThirsty
				changed = true
			}
			continue
		}
	}

	if runCrowChecks(state, state.LastTickAt, nowMs) {
		changed = true
	}
	if maybeApplyFridayEvent(state, nowMs) {
		changed = true
	}

	for i := range state.Lands {
		land := &state.Lands[i]
		if land.Crop == nil {
			continue
		}
		if land.Status == LandStatusWithered || land.Status == LandStatusEaten {
			continue
		}
		crop := land.Crop
		if nowMs < crop.MatureAt {
			continue
		}
		if land.Status == LandStatusGrowing || land.Status == LandStatusThirsty {
			land.Status = LandStatusMature
			pushEvent(state, farmEvent{
				ID:        eventID(state.UserID, "mature", crop.MatureAt, land.Index),
				Ts:        crop.MatureAt,
				Type:      "mature",
				Text:      fmt.Sprintf("%s 成熟了，快去收获", cropName(crop.CropID)),
				CropID:    crop.CropID,
				LandIndex: land.Index,
			})
			changed = true
		}
		if land.Status == LandStatusMature && nowMs > crop.MatureAt+48*60*60*1000 {
			land.Status = LandStatusWithered
			pushEvent(state, farmEvent{
				ID:     eventID(state.UserID, "wither", nowMs, land.Index),
				Ts:     nowMs,
				Type:   "wither",
				Text:   fmt.Sprintf("%s 过熟腐烂枯萎", cropName(crop.CropID)),
				CropID: crop.CropID,
			})
			changed = true
		}
	}

	if changed {
		state.LastTickAt = nowMs
		state.UpdatedAt = nowMs
	}
	return changed
}

func runCrowChecks(state *FarmState, lastTickAt int64, nowMs int64) bool {
	start := lastTickAt
	twentyFourHoursAgo := nowMs - 24*60*60*1000
	if start < twentyFourHoursAgo {
		start = twentyFourHoursAgo
	}
	cursor := ceilToStep(start, crowCheckWindow)
	changed := false
	for cursor <= nowMs {
		rng := newSeedRandom(fmt.Sprintf("crow:%d:%d", state.UserID, cursor))
		event, ateCrop := singleCrowCheck(state, cursor, rng)
		if event != nil {
			pushEvent(state, *event)
		}
		if ateCrop || event != nil {
			changed = true
		}
		cursor += crowCheckWindow
	}
	return changed
}

func singleCrowCheck(state *FarmState, ts int64, rng *seedRandom) (*farmEvent, bool) {
	date := getChinaDateString(ts)
	season := getCurrentSeason(ts)
	weather := getWeatherForDate(date, season)
	wf := weatherCrowFactor[weather]
	if wf <= 0 {
		return nil, false
	}
	sf := seasonCrowFactor[season]
	if sf <= 0 {
		sf = 1
	}
	pf := protectionFactor(state, ts)
	chance := crowBaseChance * wf * sf * pf
	if rng.Float64() >= chance {
		return nil, false
	}

	attackable := make([]int, 0, len(state.Lands))
	for i := range state.Lands {
		land := state.Lands[i]
		if land.Status != LandStatusGrowing && land.Status != LandStatusThirsty && land.Status != LandStatusMature {
			continue
		}
		if land.Crop == nil {
			continue
		}
		crop := land.Crop
		if ts-crop.PlantedAt < crowInitialDelay {
			continue
		}
		if crop.BirdNetUntil != nil && *crop.BirdNetUntil > ts {
			continue
		}
		attackable = append(attackable, i)
	}
	if len(attackable) == 0 {
		return nil, false
	}
	targetIdx := attackable[int(rng.Float64()*float64(len(attackable)))]
	land := &state.Lands[targetIdx]
	if land.Crop == nil {
		return nil, false
	}

	if pet, ok := activePetTask(state.Pet, "chase_crow", ts); ok {
		if rng.Float64() < petChaseSuccessRate(pet.Type) {
			return &farmEvent{
				ID:     eventID(state.UserID, "crow_chased", ts, land.Index),
				Ts:     ts,
				Type:   "crow_chased",
				Text:   fmt.Sprintf("%s 成功赶走了乌鸦！保住了 %s", pet.DisplayName(), cropName(land.Crop.CropID)),
				CropID: land.Crop.CropID,
			}, false
		}
	}

	cropName := cropName(land.Crop.CropID)
	land.Status = LandStatusEaten
	land.Crop = nil
	return &farmEvent{
		ID:   eventID(state.UserID, "crow_eat", ts, land.Index),
		Ts:   ts,
		Type: "crow_eat",
		Text: fmt.Sprintf("乌鸦吃掉了你的 %s", cropName),
	}, true
}

func protectionFactor(state *FarmState, ts int64) float64 {
	scarecrow := state.ScarecrowUntil != nil && *state.ScarecrowUntil > ts
	_, guarding := activePetTask(state.Pet, "guard", ts)
	switch {
	case scarecrow && guarding:
		return 0.25
	case scarecrow:
		return 0.40
	case guarding:
		return 0.50
	default:
		return 1
	}
}

type activePet struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

func (pet activePet) DisplayName() string {
	if pet.Name != "" {
		return pet.Name
	}
	switch pet.Type {
	case "cat":
		return "小白猫"
	case "dog":
		return "边牧"
	case "rabbit":
		return "兔子"
	case "red_panda":
		return "红熊猫"
	default:
		return "宠物"
	}
}

func activePetTask(raw json.RawMessage, task string, ts int64) (activePet, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return activePet{}, false
	}
	var pet struct {
		Type        string `json:"type"`
		Name        string `json:"name"`
		CurrentTask string `json:"currentTask"`
		TaskEndAt   *int64 `json:"taskEndAt"`
	}
	if err := json.Unmarshal(raw, &pet); err != nil {
		return activePet{}, false
	}
	if pet.CurrentTask != task || pet.TaskEndAt == nil || *pet.TaskEndAt <= ts {
		return activePet{}, false
	}
	return activePet{Type: pet.Type, Name: pet.Name}, true
}

func petChaseSuccessRate(petType string) float64 {
	switch petType {
	case "cat":
		return 0.65
	case "dog":
		return 0.80
	case "rabbit":
		return 0.70
	case "red_panda":
		return 0.75
	default:
		return 0
	}
}

func applyRainAutoWater(state *FarmState, lastTickAt int64, nowMs int64, season Season, weather Weather) bool {
	autoWaterMinutes := weatherAutoWaterMinutes[weather]
	if autoWaterMinutes <= 0 {
		return false
	}
	stepMs := autoWaterMinutes * 60 * 1000
	startTick := lastTickAt
	sixHoursAgo := nowMs - 6*60*60*1000
	if startTick < sixHoursAgo {
		startTick = sixHoursAgo
	}
	cursor := ceilToStep(startTick, stepMs)
	changed := false
	for cursor <= nowMs {
		for i := range state.Lands {
			land := &state.Lands[i]
			if land.Crop == nil {
				continue
			}
			if land.Status != LandStatusGrowing && land.Status != LandStatusThirsty {
				continue
			}
			crop := land.Crop
			if cursor < crop.PlantedAt || cursor >= crop.MatureAt {
				continue
			}
			intervalMs := computeActualWaterIntervalMs(crop.CropID, season, weather)
			nextWaterDueAt := cursor + intervalMs
			if crop.LastWaterAt != cursor || crop.NextWaterDueAt != nextWaterDueAt || land.Status != LandStatusGrowing {
				crop.LastWaterAt = cursor
				crop.NextWaterDueAt = nextWaterDueAt
				land.Status = LandStatusGrowing
				changed = true
			}
		}
		cursor += stepMs
	}
	return changed
}

func ceilToStep(value int64, step int64) int64 {
	if step <= 0 {
		return value
	}
	if value%step == 0 {
		return value
	}
	if value >= 0 {
		return ((value / step) + 1) * step
	}
	return (value / step) * step
}

func pushEvent(state *FarmState, event farmEvent) {
	rawEvent, err := json.Marshal(event)
	if err != nil {
		return
	}
	var events []json.RawMessage
	if len(state.Events) > 0 && string(state.Events) != "null" {
		_ = json.Unmarshal(state.Events, &events)
	}
	events = append([]json.RawMessage{rawEvent}, events...)
	if len(events) > maxEvents {
		events = events[:maxEvents]
	}
	rawEvents, err := json.Marshal(events)
	if err != nil {
		return
	}
	state.Events = rawEvents
}

func eventID(userID int64, kind string, ts int64, landIndex int) string {
	return fmt.Sprintf("farm_%s_%d_%d_%d", kind, userID, ts, landIndex)
}

func cropName(cropID CropID) string {
	if crop, ok := cropDefByID[cropID]; ok {
		return crop.Name
	}
	return string(cropID)
}

func seasonLabel(season Season) string {
	switch season {
	case SeasonSpring:
		return "春季"
	case SeasonSummer:
		return "夏季"
	case SeasonAutumn:
		return "秋季"
	case SeasonWinter:
		return "冬季"
	default:
		return string(season)
	}
}
