package farm

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestMaybeApplyFridayEventAddsSeedsOncePerChinaDate(t *testing.T) {
	now := fridayNoonUTC()
	userID := findFridayEventUser(t, now, 0)
	state := fridayEventBaseState(userID, now)

	if !maybeApplyFridayEvent(&state, now) {
		t.Fatalf("expected friday seed event to apply")
	}
	if maybeApplyFridayEvent(&state, now+60*60*1000) {
		t.Fatalf("expected friday event to run once per china date")
	}
	if state.LastFridayEventDate != "2025-01-10" {
		t.Fatalf("unexpected last friday event date: %s", state.LastFridayEventDate)
	}
	seeds := decodeIntMap(state.SeedInventory)
	if seeds["wheat"]+seeds["carrot"]+seeds["lettuce"] < 9 {
		t.Fatalf("expected seed event to add two seeds, got %+v", seeds)
	}
	assertLatestFridayEvent(t, state, "丰收商队")
}

func TestMaybeApplyFridayEventSkipsNonFriday(t *testing.T) {
	now := time.Date(2025, 1, 9, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := fridayEventBaseState(1, now)

	if maybeApplyFridayEvent(&state, now) {
		t.Fatalf("expected non-friday event to be skipped")
	}
	if state.LastFridayEventDate != "" {
		t.Fatalf("unexpected friday event date: %s", state.LastFridayEventDate)
	}
}

func TestMaybeApplyFridayRainEventWatersUnfinishedCrops(t *testing.T) {
	now := fridayNoonUTC()
	userID := findFridayEventUser(t, now, 2)
	state := fridayEventBaseState(userID, now)
	state.Lands[0].Status = LandStatusThirsty
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      now - 60*60*1000,
		MatureAt:       now + 60*60*1000,
		LastWaterAt:    now - 60*60*1000,
		NextWaterDueAt: now - 30*60*1000,
		WaterMissCount: 2,
		PlantedSeason:  getCurrentSeason(now),
	}

	if !maybeApplyFridayEvent(&state, now) {
		t.Fatalf("expected friday rain event to apply")
	}
	if state.Lands[0].Status != LandStatusGrowing {
		t.Fatalf("expected rain event to restore growing status, got %s", state.Lands[0].Status)
	}
	if state.Lands[0].Crop == nil || state.Lands[0].Crop.LastWaterAt != now || state.Lands[0].Crop.WaterMissCount != 1 {
		t.Fatalf("unexpected crop after friday rain: %+v", state.Lands[0].Crop)
	}
	assertLatestFridayEvent(t, state, "午后云雨")
}

func TestMaybeApplyFridayCrowEventEatsTargetCrop(t *testing.T) {
	now := fridayNoonUTC()
	userID := findFridayEventUser(t, now, 6)
	state := fridayEventBaseState(userID, now)
	state.Lands[0].Status = LandStatusGrowing
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropWheat,
		PlantedAt:      now - fridayEventCropDelayMs - 1,
		MatureAt:       now + 60*60*1000,
		LastWaterAt:    now - 60*60*1000,
		NextWaterDueAt: now + 60*60*1000,
		PlantedSeason:  getCurrentSeason(now),
	}

	if !maybeApplyFridayEvent(&state, now) {
		t.Fatalf("expected friday crow event to apply")
	}
	if state.Lands[0].Status != LandStatusEaten || state.Lands[0].Crop != nil {
		t.Fatalf("expected friday crow event to eat crop, got %+v", state.Lands[0])
	}
	assertLatestFridayEvent(t, state, "乌鸦侦察队突袭")
}

func fridayNoonUTC() int64 {
	return time.Date(2025, 1, 10, 4, 0, 0, 0, time.UTC).UnixMilli()
}

func findFridayEventUser(t *testing.T, nowMs int64, targetIndex int) int64 {
	t.Helper()
	date := getChinaDateString(nowMs)
	for userID := int64(1); userID <= 10000; userID++ {
		rng := newSeedRandom(fmt.Sprintf("farm-friday-event:%d:%s", userID, date))
		index := int(rng.Float64() * float64(len(fridayRandomEvents)))
		if index == targetIndex {
			return userID
		}
	}
	t.Fatalf("cannot find friday event user for index %d", targetIndex)
	return 0
}

func fridayEventBaseState(userID int64, nowMs int64) FarmState {
	state := newInitialState(userID, nowMs)
	state.Events = json.RawMessage(`[]`)
	return state
}

func assertLatestFridayEvent(t *testing.T, state FarmState, textPart string) {
	t.Helper()
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v raw=%s", err, string(state.Events))
	}
	if len(events) == 0 || events[0].Type != "friday_event" {
		t.Fatalf("expected latest friday event, got %+v", events)
	}
	if !strings.Contains(events[0].Text, textPart) {
		t.Fatalf("expected latest friday event to contain %q, got %q", textPart, events[0].Text)
	}
}
