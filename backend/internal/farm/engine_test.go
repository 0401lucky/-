package farm

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFarmEngineCalendarAndWeather(t *testing.T) {
	now := time.Date(2026, 6, 23, 2, 30, 0, 0, time.UTC).UnixMilli()

	if got := getChinaDateString(now); got != "2026-06-23" {
		t.Fatalf("unexpected china date: %s", got)
	}
	if got := getChinaMidnight(now); got != time.Date(2026, 6, 22, 16, 0, 0, 0, time.UTC).UnixMilli() {
		t.Fatalf("unexpected china midnight: %d", got)
	}
	if got := getWeatherForDate("2025-01-05", SeasonSpring); got != WeatherCloudy {
		t.Fatalf("unexpected spring weather golden: %s", got)
	}
	if got := getWeatherForDate("2025-06-23", SeasonSummer); got != WeatherLightRain {
		t.Fatalf("unexpected summer weather golden: %s", got)
	}
	if got := getWeatherForDate("2026-06-24", SeasonWinter); got != WeatherSunny {
		t.Fatalf("unexpected winter weather golden: %s", got)
	}
	if nextDaily := getNextDailyResetMs(now); nextDaily <= 0 || nextDaily > dayMs {
		t.Fatalf("unexpected next daily reset: %d", nextDaily)
	}
	if nextSeason := getNextSeasonChangeMs(now); nextSeason <= 0 || nextSeason > weekMs {
		t.Fatalf("unexpected next season change: %d", nextSeason)
	}
}

func TestBuildComputedLandsAndPlantableCrops(t *testing.T) {
	now := int64(60 * 60 * 1000)
	birdNetUntil := now + 1000
	state := FarmState{
		Lands: []LandPlot{
			{
				Index:  1,
				Status: LandStatusGrowing,
				Crop: &CropInstance{
					CropID:         CropWheat,
					PlantedAt:      0,
					MatureAt:       2 * 60 * 60 * 1000,
					NextWaterDueAt: 30 * 60 * 1000,
					WaterMissCount: 0,
					BirdNetUntil:   &birdNetUntil,
				},
			},
			{Index: 2, Status: LandStatusEmpty},
			{Index: 3, Status: LandStatusEmpty},
			{Index: 4, Status: LandStatusEmpty},
			{Index: 5, Status: LandStatusLocked},
		},
	}

	lands := buildComputedLands(state, now)
	if len(lands) != 5 {
		t.Fatalf("unexpected computed land count: %d", len(lands))
	}
	if lands[0].Status != LandStatusThirsty {
		t.Fatalf("expected overdue crop to be thirsty, got %s", lands[0].Status)
	}
	if lands[0].Stage == nil || *lands[0].Stage != CropStageGrowing {
		t.Fatalf("unexpected crop stage: %v", lands[0].Stage)
	}
	if lands[0].GrowthProgress != 0.5 {
		t.Fatalf("unexpected growth progress: %f", lands[0].GrowthProgress)
	}
	if !lands[0].NetActive {
		t.Fatalf("expected bird net to be active")
	}

	plantable := getPlantableCrops(state, SeasonSpring)
	if len(plantable) != 3 || plantable[0] != CropWheat || plantable[1] != CropCarrot || plantable[2] != CropLettuce {
		t.Fatalf("unexpected spring plantable crops: %+v", plantable)
	}
}

func TestStatusResponseJSONShape(t *testing.T) {
	stage := CropStageMature
	response := StatusResponse{
		State: FarmState{
			UserID:        1,
			Points:        100,
			Lands:         []LandPlot{{Index: 1, Status: LandStatusMature}},
			Pet:           json.RawMessage(`null`),
			Inventory:     json.RawMessage(`{}`),
			SeedInventory: json.RawMessage(`{}`),
			Events:        json.RawMessage(`[]`),
			Bonuses:       json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`),
		},
		ComputedLands: []ComputedLand{{
			Index:          1,
			Status:         LandStatusMature,
			Stage:          &stage,
			GrowthProgress: 1,
			OverripeFactor: 1,
		}},
		World: WorldState{Date: "2026-06-23", Weather: WeatherSunny, Season: SeasonSpring, GeneratedAt: 1},
		WeatherForecast: WeatherForecast{
			Tomorrow: WorldState{Date: "2026-06-24", Weather: WeatherCloudy, Season: SeasonSpring, GeneratedAt: 1},
		},
		ShopDailyPurchases: map[string]int64{"pet_food_normal": 2},
		ServerNow:          1,
		PlantableCrops:     []CropID{CropWheat},
		NextSeasonInMs:     1000,
		NextDailyInMs:      2000,
	}

	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal status response failed: %v", err)
	}
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode status response failed: %v raw=%s", err, string(raw))
	}
	for _, field := range []string{
		"state", "computedLands", "world", "weatherForecast", "shopDailyPurchases",
		"serverNow", "plantableCrops", "nextSeasonInMs", "nextDailyInMs",
	} {
		if _, ok := object[field]; !ok {
			t.Fatalf("status response missing field %s: %s", field, string(raw))
		}
	}
	computedLands, ok := object["computedLands"].([]any)
	if !ok || len(computedLands) != 1 {
		t.Fatalf("computedLands has unexpected shape: %s", string(raw))
	}
	computedLand, ok := computedLands[0].(map[string]any)
	if !ok {
		t.Fatalf("computed land has unexpected shape: %s", string(raw))
	}
	for _, field := range []string{"index", "status", "stage", "growthProgress", "remainingMs", "nextWaterRemainingMs"} {
		if _, ok := computedLand[field]; !ok {
			t.Fatalf("computed land missing field %s: %s", field, string(raw))
		}
	}
}
