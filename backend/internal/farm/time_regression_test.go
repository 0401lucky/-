package farm

import (
	"encoding/json"
	"testing"
)

func TestComputeWitherTimelineUsesWaterWitherBeforeMaturity(t *testing.T) {
	planted := int64(1_800_000_000_000)
	crop := CropInstance{
		CropID:         CropTomato,
		PlantedAt:      planted,
		MatureAt:       planted + 5*60*60*1000,
		NextWaterDueAt: planted + 3*40*60*1000,
		WaterMissCount: 0,
		PlantedSeason:  SeasonAutumn,
		WeatherAtPlant: WeatherSunny,
	}
	witherAt, reason := computeWitherTimeline(crop, LandStatusGrowing)
	if reason != "water" || witherAt >= crop.MatureAt {
		t.Fatalf("expected pre-maturity water wither timeline, got at=%d reason=%q mature=%d", witherAt, reason, crop.MatureAt)
	}
}

func TestNormalizeStateTimestampsConvertsLegacySeconds(t *testing.T) {
	now := int64(1_800_000_000_000)
	state := newInitialState(1, now)
	state.LastTickAt = 1_800_000_000
	state.Lands[0].Status = LandStatusGrowing
	state.Lands[0].Crop = &CropInstance{
		CropID:         CropPumpkin,
		PlantedAt:      1_800_000_000,
		MatureAt:       1_800_021_600,
		LastWaterAt:    1_800_000_000,
		NextWaterDueAt: 1_800_005_400,
		PlantedSeason:  SeasonAutumn,
		WeatherAtPlant: WeatherSunny,
	}
	state.Pet = json.RawMessage(`{"type":"cat","currentTask":"chase_crow","taskStartAt":1800000000,"taskEndAt":1800014400,"cooldownEndAt":1800086400}`)
	state = normalizeState(state, now)
	if state.LastTickAt != 1_800_000_000_000 || state.Lands[0].Crop.MatureAt != 1_800_021_600_000 {
		t.Fatalf("legacy crop timestamps were not converted: %+v", state.Lands[0].Crop)
	}
	pet, ok := decodePetMap(state.Pet)
	if !ok || int64(anyNumber(pet["taskEndAt"])) != 1_800_014_400_000 {
		t.Fatalf("legacy pet timestamps were not converted: %s", string(state.Pet))
	}
}
