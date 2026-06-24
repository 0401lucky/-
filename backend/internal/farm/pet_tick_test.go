package farm

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProcessPetLazyStateAppliesDailyAndHourlyDecay(t *testing.T) {
	last := time.Date(2025, 1, 9, 0, 0, 0, 0, time.UTC).UnixMilli()
	now := time.Date(2025, 1, 10, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := FarmState{
		UserID:           1,
		Pet:              json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":20,"hunger":80,"cleanliness":80,"mood":70,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":2,"premium":1},"washToday":1,"waterToday":2,"playToday":2,"toyToday":1,"dailyResetAt":1736380800000}`),
		LastDailyResetAt: last,
		LastTickAt:       now - 2*60*60*1000,
		StolenTodayCount: 3,
		StolenByMap:      map[string]int64{"2": 1},
		MyStealMap:       map[string]int64{"3": 1},
	}

	if !processPetLazyState(&state, state.LastTickAt, now) {
		t.Fatalf("expected pet lazy state to change")
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["hunger"].(float64) >= 66 {
		t.Fatalf("expected hunger to decay daily and hourly, got %+v", pet["hunger"])
	}
	if pet["cleanliness"].(float64) >= 70 {
		t.Fatalf("expected cleanliness to decay, got %+v", pet["cleanliness"])
	}
	if pet["thirst"].(float64) >= 64 {
		t.Fatalf("expected thirst to decay, got %+v", pet["thirst"])
	}
	if pet["health"].(float64) <= 80 {
		t.Fatalf("expected good daily care to increase net health before hourly decay, got %+v", pet["health"])
	}
	feedToday := pet["feedToday"].(map[string]any)
	if feedToday["normal"].(float64) != 0 || feedToday["premium"].(float64) != 0 {
		t.Fatalf("expected feedToday reset, got %+v", feedToday)
	}
	if state.StolenTodayCount != 0 || len(state.StolenByMap) != 0 || len(state.MyStealMap) != 0 {
		t.Fatalf("expected daily steal counters reset: %+v %+v %+v", state.StolenTodayCount, state.StolenByMap, state.MyStealMap)
	}
}

func TestProcessPetLazyStateEndsFinishedNonStealTask(t *testing.T) {
	now := int64(100000)
	state := FarmState{
		UserID:     1,
		Pet:        json.RawMessage(`{"type":"dog","name":"豆豆","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"guard","taskStartAt":1,"taskEndAt":99999,"cooldownEndAt":200000,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":100000}`),
		LastTickAt: now,
	}
	if !processPetLazyState(&state, state.LastTickAt, now) {
		t.Fatalf("expected finished task to change pet")
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != nil || pet["taskStartAt"] != nil || pet["taskEndAt"] != nil {
		t.Fatalf("expected finished guard task to be cleared, got %+v", pet)
	}
	if pet["cooldownEndAt"] == nil {
		t.Fatalf("expected cooldown to be preserved")
	}
}

func TestProcessPetLazyStateStopsLowMoodWork(t *testing.T) {
	now := int64(100000)
	state := FarmState{
		UserID:     1,
		Pet:        json.RawMessage(`{"type":"rabbit","name":"团子","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":10,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"plant","taskStartAt":1,"taskEndAt":200000,"cooldownEndAt":300000,"stealTarget":{"userId":2,"landIndex":1,"cropId":"wheat"},"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":100000}`),
		Events:     json.RawMessage(`[]`),
		LastTickAt: now,
	}
	if !processPetLazyState(&state, state.LastTickAt, now) {
		t.Fatalf("expected low mood to stop work")
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != nil || pet["taskStartAt"] != nil || pet["taskEndAt"] != nil || pet["stealTarget"] != nil {
		t.Fatalf("expected low mood work fields cleared, got %+v", pet)
	}
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != "pet_task" {
		t.Fatalf("expected pet_task event, got %+v", events)
	}
}

func TestProcessPetWaterTaskWatersBeforeDueAndEndsTask(t *testing.T) {
	now := int64(60 * 60 * 1000)
	state := FarmState{
		UserID: 1,
		Pet:    json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"water","taskStartAt":0,"taskEndAt":3600000,"cooldownEndAt":7200000,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`),
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusThirsty,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      0,
				MatureAt:       2 * 60 * 60 * 1000,
				LastWaterAt:    0,
				NextWaterDueAt: 30 * 60 * 1000,
				WaterMissCount: 1,
				PlantedSeason:  getCurrentSeason(now),
			},
		}},
	}

	if !processPetWaterTask(&state, 0, now) {
		t.Fatalf("expected pet water task to change state")
	}
	crop := state.Lands[0].Crop
	if crop == nil {
		t.Fatalf("expected crop to remain")
	}
	if state.Lands[0].Status != LandStatusGrowing {
		t.Fatalf("expected pet water to restore growing status, got %s", state.Lands[0].Status)
	}
	if crop.LastWaterAt <= 0 || crop.LastWaterAt > now {
		t.Fatalf("expected auto water within task window, got %d", crop.LastWaterAt)
	}
	if crop.NextWaterDueAt <= now {
		t.Fatalf("unexpected nextWaterDueAt after pet water: %d", crop.NextWaterDueAt)
	}
	pet := decodePetForTest(t, state.Pet)
	if pet["currentTask"] != nil || pet["taskStartAt"] != nil || pet["taskEndAt"] != nil {
		t.Fatalf("expected ended water task cleared, got %+v", pet)
	}
	if pet["cooldownEndAt"] == nil {
		t.Fatalf("expected cooldown to be preserved")
	}
}

func TestProcessPetWaterTaskSkipsInvalidLands(t *testing.T) {
	now := int64(60 * 60 * 1000)
	state := FarmState{
		UserID: 1,
		Pet:    json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"currentTask":"water","taskStartAt":0,"taskEndAt":7200000,"cooldownEndAt":9000000,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`),
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusMature,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      0,
				MatureAt:       now - 1,
				LastWaterAt:    0,
				NextWaterDueAt: 30 * 60 * 1000,
				WaterMissCount: 1,
				PlantedSeason:  getCurrentSeason(now),
			},
		}},
	}

	if processPetWaterTask(&state, 0, now) {
		t.Fatalf("expected mature crop to be skipped while task remains active")
	}
	if state.Lands[0].Crop.LastWaterAt != 0 {
		t.Fatalf("expected mature crop water time unchanged, got %d", state.Lands[0].Crop.LastWaterAt)
	}
}

func TestProcessPassivePetPlantPlantsBestAvailableSeeds(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, now)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":["plant"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.SeedInventory = json.RawMessage(`{"wheat":1,"carrot":2,"lettuce":1}`)
	state.Events = json.RawMessage(`[]`)

	if !processPassivePetPlant(&state, now) {
		t.Fatalf("expected passive plant to change state")
	}
	if state.Lands[0].Crop == nil || state.Lands[0].Crop.CropID != CropLettuce {
		t.Fatalf("expected best spring seed lettuce first, got %+v", state.Lands[0].Crop)
	}
	if state.Lands[1].Crop == nil || state.Lands[1].Crop.CropID != CropCarrot {
		t.Fatalf("expected carrot second, got %+v", state.Lands[1].Crop)
	}
	if state.Lands[2].Crop == nil || state.Lands[2].Crop.CropID != CropCarrot {
		t.Fatalf("expected carrot third, got %+v", state.Lands[2].Crop)
	}
	if state.Lands[3].Crop == nil || state.Lands[3].Crop.CropID != CropWheat {
		t.Fatalf("expected wheat last, got %+v", state.Lands[3].Crop)
	}
	seeds := decodeIntMap(state.SeedInventory)
	if seeds["wheat"] != 0 || seeds["carrot"] != 0 || seeds["lettuce"] != 0 {
		t.Fatalf("expected seeds consumed, got %+v", seeds)
	}
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != "pet_task" {
		t.Fatalf("expected passive plant event, got %+v", events)
	}
}

func TestProcessPassivePetPlantRequiresAdultPlantSkill(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, now)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":10,"learnedSkills":["plant"]}`)

	if processPassivePetPlant(&state, now) {
		t.Fatalf("expected child pet not to passive plant")
	}
}

func TestProcessPassivePetHarvestHarvestsMatureCrops(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, now)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":60,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":["harvest"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	state.Events = json.RawMessage(`[]`)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      now - 60*60*1000,
		MatureAt:       now - 1,
		LastWaterAt:    now - 60*60*1000,
		NextWaterDueAt: now,
		WaterMissCount: 0,
		PlantedSeason:  getCurrentSeason(now),
		WeatherAtPlant: WeatherSunny,
	}

	total, count, ledgerID, changed := processPassivePetHarvest(&state, now)
	if !changed || count != 1 || total <= 0 || ledgerID == "" {
		t.Fatalf("expected passive harvest to change one crop, total=%d count=%d ledgerID=%q changed=%v", total, count, ledgerID, changed)
	}
	if state.Lands[0].Status != LandStatusEmpty || state.Lands[0].Crop != nil {
		t.Fatalf("expected harvested land to be empty, got %+v", state.Lands[0])
	}
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 2 || events[0].Type != "pet_task" || events[1].Type != "harvest" || events[1].Amount != total {
		t.Fatalf("unexpected passive harvest events: %+v total=%d", events, total)
	}
}

func TestProcessPassivePetHarvestRequiresAdultHarvestSkill(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(1, now)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":10,"learnedSkills":["harvest"]}`)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{
		CropID:        CropWheat,
		PlantedAt:     now - 60*60*1000,
		MatureAt:      now - 1,
		PlantedSeason: getCurrentSeason(now),
	}

	if _, _, _, changed := processPassivePetHarvest(&state, now); changed {
		t.Fatalf("expected child pet not to passive harvest")
	}
	if state.Lands[0].Status != LandStatusMature || state.Lands[0].Crop == nil {
		t.Fatalf("expected mature crop to stay unchanged, got %+v", state.Lands[0])
	}
}

func decodePetForTest(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var pet map[string]any
	if err := json.Unmarshal(raw, &pet); err != nil {
		t.Fatalf("decode pet failed: %v raw=%s", err, string(raw))
	}
	return pet
}
