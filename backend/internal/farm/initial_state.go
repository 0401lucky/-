package farm

import (
	"encoding/json"
	"fmt"
)

const (
	initialPoints    = 100
	initialLandCount = 4
	maxLandCount     = 8
)

func newInitialState(userID int64, nowMs int64) FarmState {
	lands := make([]LandPlot, 0, maxLandCount)
	for i := 0; i < maxLandCount; i++ {
		status := LandStatusLocked
		if i < initialLandCount {
			status = LandStatusEmpty
		}
		lands = append(lands, LandPlot{Index: i + 1, Status: status, Crop: nil})
	}

	return FarmState{
		UserID:                userID,
		Points:                initialPoints,
		Lands:                 lands,
		ScarecrowUntil:        nil,
		BellUntil:             nil,
		Pet:                   json.RawMessage(`null`),
		StolenTodayCount:      0,
		StolenByMap:           map[string]int64{},
		MyStealMap:            map[string]int64{},
		Inventory:             json.RawMessage(`{}`),
		PurchasedSkillBooks:   json.RawMessage(`{}`),
		SeedInventory:         json.RawMessage(`{"wheat":4,"carrot":2,"lettuce":1}`),
		Events:                json.RawMessage(fmt.Sprintf(`[{"id":"farm_welcome_%d_%d","ts":%d,"type":"plant","text":"欢迎来到开心农场！已赠送新手种子礼包"}]`, userID, nowMs, nowMs)),
		LastDailyResetAt:      nowMs,
		LastSeasonProcessedAt: nowMs,
		LastTickAt:            nowMs,
		LastFridayEventDate:   "",
		Bonuses:               json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`),
		CreatedAt:             nowMs,
		UpdatedAt:             nowMs,
	}
}

func normalizeState(state FarmState, nowMs int64) FarmState {
	normalizeStateTimestamps(&state, nowMs)
	if state.UserID <= 0 {
		state.UserID = 0
	}
	if len(state.Lands) != maxLandCount {
		lands := make([]LandPlot, 0, maxLandCount)
		for i := 0; i < maxLandCount; i++ {
			if i < len(state.Lands) {
				land := state.Lands[i]
				if land.Index == 0 {
					land.Index = i + 1
				}
				lands = append(lands, land)
				continue
			}
			status := LandStatusLocked
			if i < initialLandCount {
				status = LandStatusEmpty
			}
			lands = append(lands, LandPlot{Index: i + 1, Status: status, Crop: nil})
		}
		state.Lands = lands
	}
	if state.StolenByMap == nil {
		state.StolenByMap = map[string]int64{}
	}
	if state.MyStealMap == nil {
		state.MyStealMap = map[string]int64{}
	}
	if isEmptyJSON(state.Pet) {
		state.Pet = json.RawMessage(`null`)
	}
	if isEmptyJSON(state.Inventory) {
		state.Inventory = json.RawMessage(`{}`)
	}
	if isEmptyJSON(state.PurchasedSkillBooks) {
		state.PurchasedSkillBooks = json.RawMessage(`{}`)
	}
	if isEmptyJSON(state.SeedInventory) {
		state.SeedInventory = json.RawMessage(`{"wheat":4,"carrot":2,"lettuce":1}`)
	}
	if isEmptyJSON(state.Events) {
		state.Events = json.RawMessage(`[]`)
	}
	if isEmptyJSON(state.Bonuses) {
		state.Bonuses = json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
	}
	if state.CreatedAt <= 0 {
		state.CreatedAt = nowMs
	}
	if state.UpdatedAt <= 0 {
		state.UpdatedAt = nowMs
	}
	if state.LastDailyResetAt <= 0 {
		state.LastDailyResetAt = state.CreatedAt
	}
	if state.LastSeasonProcessedAt <= 0 {
		state.LastSeasonProcessedAt = state.CreatedAt
	}
	if state.LastTickAt <= 0 {
		state.LastTickAt = state.CreatedAt
	}
	return state
}

const minimumMillisecondTimestamp = int64(100_000_000_000)

func normalizeFarmTimestamp(value int64, nowMs int64) int64 {
	if nowMs >= minimumMillisecondTimestamp && value > 0 && value < minimumMillisecondTimestamp {
		return value * 1000
	}
	return value
}

// Old farm snapshots imported from early clients could contain Unix seconds.
// Normalize them once at read time so crops and pet tasks do not expire years
// before their displayed dates.
func normalizeStateTimestamps(state *FarmState, nowMs int64) bool {
	if state == nil || nowMs < minimumMillisecondTimestamp {
		return false
	}
	changed := false
	stateFields := []*int64{
		&state.LastDailyResetAt, &state.LastSeasonProcessedAt, &state.LastTickAt,
		&state.CreatedAt, &state.UpdatedAt,
	}
	for _, field := range stateFields {
		if next := normalizeFarmTimestamp(*field, nowMs); next != *field {
			*field = next
			changed = true
		}
	}
	for index := range state.Lands {
		crop := state.Lands[index].Crop
		if crop == nil {
			continue
		}
		fields := []*int64{
			&crop.PlantedAt, &crop.MatureAt, &crop.LastWaterAt, &crop.NextWaterDueAt,
		}
		if crop.BirdNetUntil != nil {
			fields = append(fields, crop.BirdNetUntil)
		}
		for _, field := range fields {
			if next := normalizeFarmTimestamp(*field, nowMs); next != *field {
				*field = next
				changed = true
			}
		}
	}
	if pet, ok := decodePetMap(state.Pet); ok {
		for _, key := range []string{"taskStartAt", "taskEndAt", "cooldownEndAt", "dailyResetAt"} {
			if value, exists := pet[key]; exists && value != nil {
				current := int64(anyNumber(value))
				next := normalizeFarmTimestamp(current, nowMs)
				if next != current {
					pet[key] = float64(next)
					changed = true
				}
			}
		}
		if changed {
			state.Pet = encodeJSONOrDefault(pet, `null`)
		}
	}
	return changed
}

func isEmptyJSON(value json.RawMessage) bool {
	if len(value) == 0 {
		return true
	}
	return string(value) == "null"
}
