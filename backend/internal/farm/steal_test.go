package farm

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestComputeStealSuccessRateAppliesPetAndTargetModifiers(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	bellUntil := now + 1
	guardEndAt := now + 60*60*1000
	thief := FarmState{
		UserID: 1,
		Pet:    json.RawMessage(`{"type":"cat","stage":"adult","growth":180,"hunger":80,"cleanliness":80,"mood":75,"thirst":80,"health":90}`),
	}
	target := FarmState{
		UserID:    2,
		BellUntil: &bellUntil,
		Pet:       json.RawMessage(`{"type":"dog","name":"豆豆","currentTask":"guard","taskEndAt":` + int64JSON(guardEndAt) + `}`),
	}

	rate := computeStealSuccessRate(thief, target, now)
	expected := 0.75 * 1.15 * 1.0 * 0.30 * 0.5
	if math.Abs(rate-expected) > 0.000001 {
		t.Fatalf("expected steal rate %.6f, got %.6f", expected, rate)
	}
}

func TestComputeStealSuccessRateReturnsZeroForCriticalPetState(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	thief := FarmState{
		UserID: 1,
		Pet:    json.RawMessage(`{"type":"rabbit","stage":"adult","growth":180,"hunger":20,"cleanliness":80,"mood":75,"thirst":80,"health":90}`),
	}

	if rate := computeStealSuccessRate(thief, FarmState{}, now); rate != 0 {
		t.Fatalf("expected critical hunger to block steal, got %.6f", rate)
	}
}

func TestApplyWholeStealOnTargetClearsCropAndWritesCounters(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	target := newInitialState(2, now)
	target.Events = json.RawMessage(`[]`)
	target.Lands[0].Status = LandStatusMature
	target.Lands[0].Crop = &CropInstance{
		CropID:         CropCarrot,
		PlantedAt:      now - 2*60*60*1000,
		MatureAt:       now - 1,
		LastWaterAt:    now - 2*60*60*1000,
		NextWaterDueAt: now,
		PlantedSeason:  getCurrentSeason(now),
	}

	if !applyWholeStealOnTarget(&target, 1, 0, 20, now) {
		t.Fatalf("expected whole steal to apply")
	}
	if target.Lands[0].Status != LandStatusEmpty || target.Lands[0].Crop != nil {
		t.Fatalf("expected stolen target land to be empty, got %+v", target.Lands[0])
	}
	if target.StolenTodayCount != 1 || target.StolenByMap["1"] != 1 {
		t.Fatalf("unexpected steal counters: count=%d map=%+v", target.StolenTodayCount, target.StolenByMap)
	}
	var events []farmEvent
	if err := json.Unmarshal(target.Events, &events); err != nil {
		t.Fatalf("decode events failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != "stolen_in" || events[0].CropID != CropCarrot || events[0].Amount != 20 {
		t.Fatalf("unexpected stolen_in event: %+v", events)
	}
}

func TestGetStealableMatureIndexesOnlyReturnsMatureCrops(t *testing.T) {
	now := time.Date(2025, 1, 6, 4, 0, 0, 0, time.UTC).UnixMilli()
	state := newInitialState(2, now)
	state.Lands[0].Status = LandStatusMature
	state.Lands[0].Crop = &CropInstance{CropID: CropWheat, MatureAt: now - 1}
	state.Lands[1].Status = LandStatusGrowing
	state.Lands[1].Crop = &CropInstance{CropID: CropCarrot, MatureAt: now + 1}
	state.Lands[2].Status = LandStatusMature
	state.Lands[2].Crop = nil

	indexes := getStealableMatureIndexes(state)
	if len(indexes) != 1 || indexes[0] != 0 {
		t.Fatalf("unexpected stealable indexes: %+v", indexes)
	}
}

func int64JSON(value int64) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

type fixedRNG struct {
	values []float64
	index  int
}

func (rng *fixedRNG) Float64() float64 {
	if len(rng.values) == 0 {
		return 0
	}
	value := rng.values[rng.index%len(rng.values)]
	rng.index++
	return value
}
