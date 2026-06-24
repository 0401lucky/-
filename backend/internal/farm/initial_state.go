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

func isEmptyJSON(value json.RawMessage) bool {
	if len(value) == 0 {
		return true
	}
	return string(value) == "null"
}
