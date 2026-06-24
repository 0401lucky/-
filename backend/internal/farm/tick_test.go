package farm

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestTickBasicCropStateMaturesAndWithers(t *testing.T) {
	now := time.Date(2026, 6, 23, 2, 30, 0, 0, time.UTC).UnixMilli()
	overripeNow := now + 49*60*60*1000
	birdNetUntil := overripeNow + 1
	state := FarmState{
		UserID: 1,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusGrowing,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      now - 2*60*60*1000,
				MatureAt:       now - 60*60*1000,
				NextWaterDueAt: now + 60*60*1000,
				BirdNetUntil:   &birdNetUntil,
				PlantedSeason:  getCurrentSeason(now),
			},
		}},
		Events:                json.RawMessage(`[]`),
		LastSeasonProcessedAt: now,
		LastTickAt:            now - 2*60*60*1000,
	}

	if !tickBasicCropState(&state, now) {
		t.Fatalf("expected mature tick to change state")
	}
	if state.Lands[0].Status != LandStatusMature {
		t.Fatalf("expected mature land, got %s", state.Lands[0].Status)
	}
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != "mature" || events[0].LandIndex != 1 {
		t.Fatalf("unexpected mature events: %+v", events)
	}

	if !tickBasicCropState(&state, overripeNow) {
		t.Fatalf("expected overripe tick to change state")
	}
	if state.Lands[0].Status != LandStatusWithered {
		t.Fatalf("expected overripe land to wither, got %s", state.Lands[0].Status)
	}
}

func TestTickBasicCropStateAdvancesWaterMisses(t *testing.T) {
	now := time.Date(2025, 1, 6, 2, 0, 0, 0, time.UTC).UnixMilli()
	state := FarmState{
		UserID: 1,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusGrowing,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      now - 3*60*60*1000,
				MatureAt:       now + 60*60*1000,
				NextWaterDueAt: now - 2*60*60*1000,
				WaterMissCount: 0,
				PlantedSeason:  getCurrentSeason(now),
			},
		}},
		Events:                json.RawMessage(`[]`),
		LastSeasonProcessedAt: now,
		LastTickAt:            now - 3*60*60*1000,
	}

	if !tickBasicCropState(&state, now) {
		t.Fatalf("expected water miss tick to change state")
	}
	if state.Lands[0].Status != LandStatusWithered {
		t.Fatalf("expected three missed windows to wither crop, got %s", state.Lands[0].Status)
	}
	if state.Lands[0].Crop == nil || state.Lands[0].Crop.WaterMissCount != 3 {
		t.Fatalf("unexpected water miss count: %+v", state.Lands[0].Crop)
	}
}

func TestTickBasicCropStateAppliesSeasonChange(t *testing.T) {
	now := time.Date(2025, 1, 12, 1, 0, 0, 0, time.UTC).UnixMilli()
	lastSeason := time.Date(2025, 1, 6, 1, 0, 0, 0, time.UTC).UnixMilli()
	state := FarmState{
		UserID: 1,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusGrowing,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      lastSeason,
				MatureAt:       now + 60*60*1000,
				NextWaterDueAt: now + 60*60*1000,
				PlantedSeason:  SeasonSpring,
			},
		}},
		Events:                json.RawMessage(`[]`),
		LastSeasonProcessedAt: lastSeason,
		LastTickAt:            lastSeason,
	}

	if getCurrentSeason(lastSeason) == getCurrentSeason(now) {
		t.Fatalf("test fixture should cross season")
	}
	if !tickBasicCropState(&state, now) {
		t.Fatalf("expected season tick to change state")
	}
	if state.Lands[0].Status != LandStatusWithered {
		t.Fatalf("expected cross-season crop to wither, got %s", state.Lands[0].Status)
	}
}

func TestApplyRainAutoWaterWatersUnmaturedCrops(t *testing.T) {
	now := int64(3 * 60 * 60 * 1000)
	state := FarmState{
		UserID: 1,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusThirsty,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      0,
				MatureAt:       now + 60*60*1000,
				LastWaterAt:    0,
				NextWaterDueAt: 30 * 60 * 1000,
				WaterMissCount: 1,
				PlantedSeason:  SeasonSpring,
			},
		}},
		Events:     json.RawMessage(`[]`),
		LastTickAt: 0,
	}

	if !applyRainAutoWater(&state, state.LastTickAt, now, SeasonSpring, WeatherLightRain) {
		t.Fatalf("expected light rain to water crop")
	}
	crop := state.Lands[0].Crop
	if crop == nil {
		t.Fatalf("expected crop to remain")
	}
	if state.Lands[0].Status != LandStatusGrowing {
		t.Fatalf("expected rain to restore growing status, got %s", state.Lands[0].Status)
	}
	if crop.LastWaterAt != now {
		t.Fatalf("expected latest rain cursor as lastWaterAt, got %d", crop.LastWaterAt)
	}
	if crop.NextWaterDueAt != now+30*60*1000 {
		t.Fatalf("unexpected next water due: %d", crop.NextWaterDueAt)
	}
	if crop.WaterMissCount != 1 {
		t.Fatalf("rain should not erase historical water misses, got %d", crop.WaterMissCount)
	}
}

func TestApplyRainAutoWaterSkipsMaturedCrops(t *testing.T) {
	now := int64(3 * 60 * 60 * 1000)
	state := FarmState{
		UserID: 1,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusThirsty,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      -60 * 60 * 1000,
				MatureAt:       0,
				LastWaterAt:    0,
				NextWaterDueAt: 30 * 60 * 1000,
				WaterMissCount: 1,
				PlantedSeason:  SeasonSpring,
			},
		}},
		Events:     json.RawMessage(`[]`),
		LastTickAt: 0,
	}

	if applyRainAutoWater(&state, state.LastTickAt, now, SeasonSpring, WeatherStorm) {
		t.Fatalf("expected rain to skip already mature crop")
	}
	if state.Lands[0].Status != LandStatusThirsty {
		t.Fatalf("expected land status to stay unchanged, got %s", state.Lands[0].Status)
	}
	if state.Lands[0].Crop.LastWaterAt != 0 {
		t.Fatalf("expected lastWaterAt to stay unchanged, got %d", state.Lands[0].Crop.LastWaterAt)
	}
}

func TestRunCrowChecksCanEatAttackableCrop(t *testing.T) {
	ts := int64(600000)
	state := findCrowHitState(t, ts)

	if !runCrowChecks(&state, ts, ts) {
		t.Fatalf("expected crow check to change state")
	}
	if state.Lands[0].Status != LandStatusEaten || state.Lands[0].Crop != nil {
		t.Fatalf("expected crow to eat crop, got %+v", state.Lands[0])
	}
	var events []farmEvent
	if err := json.Unmarshal(state.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != "crow_eat" {
		t.Fatalf("unexpected crow events: %+v", events)
	}
}

func TestRunCrowChecksSkipsBirdNetProtectedCrop(t *testing.T) {
	ts := int64(600000)
	state := findCrowHitState(t, ts)
	birdNetUntil := ts + 1
	state.Lands[0].Crop.BirdNetUntil = &birdNetUntil

	if runCrowChecks(&state, ts, ts) {
		t.Fatalf("expected bird net to prevent crow state change")
	}
	if state.Lands[0].Status != LandStatusGrowing || state.Lands[0].Crop == nil {
		t.Fatalf("expected protected crop to remain growing, got %+v", state.Lands[0])
	}
}

func findCrowHitState(t *testing.T, ts int64) FarmState {
	t.Helper()
	for userID := int64(1); userID <= 10000; userID++ {
		state := crowFixtureState(userID, ts)
		if event, ate := singleCrowCheck(&state, ts, newSeedRandom(eventIDSeed(userID, ts))); ate && event != nil && event.Type == "crow_eat" {
			return crowFixtureState(userID, ts)
		}
	}
	t.Fatalf("cannot find deterministic crow hit fixture")
	return FarmState{}
}

func crowFixtureState(userID int64, ts int64) FarmState {
	return FarmState{
		UserID: userID,
		Lands: []LandPlot{{
			Index:  1,
			Status: LandStatusGrowing,
			Crop: &CropInstance{
				CropID:         CropWheat,
				PlantedAt:      ts - crowInitialDelay - 1,
				MatureAt:       ts + 60*60*1000,
				LastWaterAt:    ts - 60*60*1000,
				NextWaterDueAt: ts + 60*60*1000,
				PlantedSeason:  getCurrentSeason(ts),
			},
		}},
		Events: json.RawMessage(`[]`),
	}
}

func eventIDSeed(userID int64, ts int64) string {
	return fmt.Sprintf("crow:%d:%d", userID, ts)
}
