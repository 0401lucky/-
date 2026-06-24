package farm

import (
	"fmt"
	"math"
	"time"
)

const (
	chinaTZOffsetMs = int64(8 * 60 * 60 * 1000)
	dayMs           = int64(24 * 60 * 60 * 1000)
	weekMs          = int64(7 * 24 * 60 * 60 * 1000)
	seasonEpochDate = "2025-01-05"
)

var seasonOrder = []Season{SeasonSpring, SeasonSummer, SeasonAutumn, SeasonWinter}

type cropDef struct {
	ID              CropID
	Name            string
	Seasons         []Season
	SeedCost        int64
	GrowthMinutes   int64
	WaterMinutes    int64
	BaseYield       int64
	UnlockLandCount int
}

var cropDefs = []cropDef{
	{ID: CropWheat, Name: "小麦", Seasons: []Season{SeasonSpring, SeasonAutumn}, SeedCost: 5, GrowthMinutes: 30, WaterMinutes: 30, BaseYield: 12, UnlockLandCount: 4},
	{ID: CropCarrot, Name: "胡萝卜", Seasons: []Season{SeasonSpring, SeasonAutumn}, SeedCost: 8, GrowthMinutes: 60, WaterMinutes: 30, BaseYield: 20, UnlockLandCount: 4},
	{ID: CropLettuce, Name: "生菜", Seasons: []Season{SeasonSpring}, SeedCost: 10, GrowthMinutes: 90, WaterMinutes: 30, BaseYield: 28, UnlockLandCount: 4},
	{ID: CropTomato, Name: "番茄", Seasons: []Season{SeasonSummer}, SeedCost: 18, GrowthMinutes: 120, WaterMinutes: 40, BaseYield: 48, UnlockLandCount: 5},
	{ID: CropPotato, Name: "土豆", Seasons: []Season{SeasonWinter, SeasonSpring}, SeedCost: 20, GrowthMinutes: 150, WaterMinutes: 60, BaseYield: 55, UnlockLandCount: 5},
	{ID: CropStrawberry, Name: "草莓", Seasons: []Season{SeasonSpring, SeasonSummer}, SeedCost: 25, GrowthMinutes: 180, WaterMinutes: 45, BaseYield: 75, UnlockLandCount: 6},
	{ID: CropCorn, Name: "玉米", Seasons: []Season{SeasonSummer, SeasonAutumn}, SeedCost: 35, GrowthMinutes: 240, WaterMinutes: 60, BaseYield: 105, UnlockLandCount: 7},
	{ID: CropPumpkin, Name: "南瓜", Seasons: []Season{SeasonAutumn}, SeedCost: 45, GrowthMinutes: 360, WaterMinutes: 90, BaseYield: 150, UnlockLandCount: 8},
}

var landUnlockPrices = map[int]int64{
	1: 0,
	2: 0,
	3: 0,
	4: 0,
	5: 50,
	6: 100,
	7: 150,
	8: 200,
}

var cropDefByID = func() map[CropID]cropDef {
	result := map[CropID]cropDef{}
	for _, crop := range cropDefs {
		result[crop.ID] = crop
	}
	return result
}()

var seasonWaterFactor = map[Season]float64{
	SeasonSpring: 1.00,
	SeasonSummer: 0.85,
	SeasonAutumn: 1.00,
	SeasonWinter: 1.20,
}

var seasonGrowthFactor = map[Season]float64{
	SeasonSpring: 0.95,
	SeasonSummer: 0.90,
	SeasonAutumn: 1.00,
	SeasonWinter: 1.15,
}

var weatherWaterFactor = map[Weather]float64{
	WeatherSunny:     1.00,
	WeatherCloudy:    1.10,
	WeatherLightRain: 1.00,
	WeatherStorm:     1.00,
	WeatherHot:       0.80,
	WeatherWind:      1.00,
	WeatherSnow:      1.20,
	WeatherFog:       1.00,
}

var weatherAutoWaterMinutes = map[Weather]int64{
	WeatherSunny:     0,
	WeatherCloudy:    0,
	WeatherLightRain: 30,
	WeatherStorm:     15,
	WeatherHot:       0,
	WeatherWind:      0,
	WeatherSnow:      0,
	WeatherFog:       0,
}

var weatherCrowFactor = map[Weather]float64{
	WeatherSunny:     1.00,
	WeatherCloudy:    0.90,
	WeatherLightRain: 0.40,
	WeatherStorm:     0.00,
	WeatherHot:       1.20,
	WeatherWind:      1.50,
	WeatherSnow:      0.30,
	WeatherFog:       0.70,
}

var seasonCrowFactor = map[Season]float64{
	SeasonSpring: 1.00,
	SeasonSummer: 1.20,
	SeasonAutumn: 1.00,
	SeasonWinter: 0.70,
}

var seasonWeatherProb = map[Season][]struct {
	weather Weather
	prob    float64
}{
	SeasonSpring: {
		{WeatherSunny, 0.30}, {WeatherCloudy, 0.25}, {WeatherLightRain, 0.30}, {WeatherStorm, 0.05}, {WeatherWind, 0.10},
	},
	SeasonSummer: {
		{WeatherSunny, 0.25}, {WeatherCloudy, 0.10}, {WeatherLightRain, 0.20}, {WeatherStorm, 0.15}, {WeatherHot, 0.30},
	},
	SeasonAutumn: {
		{WeatherSunny, 0.40}, {WeatherCloudy, 0.25}, {WeatherLightRain, 0.10}, {WeatherWind, 0.20}, {WeatherFog, 0.05},
	},
	SeasonWinter: {
		{WeatherSunny, 0.25}, {WeatherCloudy, 0.25}, {WeatherWind, 0.15}, {WeatherSnow, 0.30}, {WeatherFog, 0.05},
	},
}

func getChinaDateString(ts int64) string {
	d := time.UnixMilli(ts + chinaTZOffsetMs).UTC()
	return d.Format("2006-01-02")
}

func getChinaMidnight(ts int64) int64 {
	day := floorDiv(ts+chinaTZOffsetMs, dayMs)
	return day*dayMs - chinaTZOffsetMs
}

func getCurrentSeason(ts int64) Season {
	epoch := parseEpochDate(seasonEpochDate)
	seasonIndex := floorDiv(getChinaMidnight(ts)-epoch, weekMs)
	i := int(((seasonIndex % 4) + 4) % 4)
	return seasonOrder[i]
}

func getNextSeasonChangeMs(now int64) int64 {
	epoch := parseEpochDate(seasonEpochDate)
	elapsed := getChinaMidnight(now) - epoch
	currentWeek := floorDiv(elapsed, weekMs)
	nextSeasonStart := epoch + (currentWeek+1)*weekMs
	return maxInt64(0, nextSeasonStart-now)
}

func getNextDailyResetMs(now int64) int64 {
	today := getChinaMidnight(now)
	return maxInt64(0, today+dayMs-now)
}

func parseEpochDate(value string) int64 {
	t, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(fmt.Sprintf("invalid farm season epoch %q: %v", value, err))
	}
	return t.UnixMilli() - chinaTZOffsetMs
}

func getWeatherForDate(dateStr string, season Season) Weather {
	rng := newSeedRandom(fmt.Sprintf("weather:%s:%s", dateStr, season))
	r := rng.Float64()
	dist := seasonWeatherProb[season]
	if len(dist) == 0 {
		dist = seasonWeatherProb[SeasonSpring]
	}
	acc := 0.0
	for _, item := range dist {
		acc += item.prob
		if r < acc {
			return item.weather
		}
	}
	return dist[0].weather
}

func computeCropStage(progress float64) CropStage {
	if progress >= 1 {
		return CropStageMature
	}
	if progress >= 0.5 {
		return CropStageGrowing
	}
	if progress >= 0.2 {
		return CropStageSprout
	}
	return CropStageSeed
}

func computeGrowthProgress(crop CropInstance, now int64) float64 {
	if now >= crop.MatureAt {
		return 1
	}
	total := crop.MatureAt - crop.PlantedAt
	if total <= 0 {
		return 1
	}
	return math.Max(0, float64(now-crop.PlantedAt)/float64(total))
}

func computeOverripeFactor(crop CropInstance, now int64) float64 {
	if now < crop.MatureAt {
		return 1
	}
	hours := float64(now-crop.MatureAt) / float64(60*60*1000)
	switch {
	case hours <= 12:
		return 1
	case hours <= 24:
		return 0.8
	case hours <= 48:
		return 0.5
	default:
		return 0
	}
}

func computeActualWaterIntervalMs(cropID CropID, season Season, weather Weather) int64 {
	crop, ok := cropDefByID[cropID]
	if !ok {
		return 30 * 60 * 1000
	}
	seasonFactor := seasonWaterFactor[season]
	if seasonFactor == 0 {
		seasonFactor = 1
	}
	weatherFactor := weatherWaterFactor[weather]
	if weatherFactor == 0 {
		weatherFactor = 1
	}
	return int64(math.Round(float64(crop.WaterMinutes) * seasonFactor * weatherFactor * 60 * 1000))
}

func computeActualGrowthMs(cropID CropID, season Season) int64 {
	crop, ok := cropDefByID[cropID]
	if !ok {
		return 30 * 60 * 1000
	}
	seasonFactor := seasonGrowthFactor[season]
	if seasonFactor == 0 {
		seasonFactor = 1
	}
	return int64(math.Round(float64(crop.GrowthMinutes) * seasonFactor * 60 * 1000))
}

func computeWaterMissesAfterWindow(crop CropInstance, intervalMs int64, now int64) (int64, int64) {
	checkUntil := now
	if crop.MatureAt < checkUntil {
		checkUntil = crop.MatureAt
	}
	nextDue := crop.NextWaterDueAt
	missCount := crop.WaterMissCount
	for checkUntil > nextDue && missCount < 3 {
		missCount++
		nextDue += intervalMs
	}
	return missCount, nextDue
}

func isPerfectCare(crop CropInstance, now int64) bool {
	return crop.WaterMissCount == 0 && crop.StolenCount == 0 && now < crop.MatureAt+12*60*60*1000
}

func estimateQualityHint(crop CropInstance, now int64) *Quality {
	if now < crop.MatureAt {
		return nil
	}
	quality := QualityNormal
	if isPerfectCare(crop, now) {
		quality = QualitySilver
	}
	return &quality
}

func buildComputedLands(state FarmState, now int64) []ComputedLand {
	lands := make([]ComputedLand, 0, len(state.Lands))
	scarecrowActive := state.ScarecrowUntil != nil && *state.ScarecrowUntil > now
	bellActive := state.BellUntil != nil && *state.BellUntil > now
	for _, plot := range state.Lands {
		computed := ComputedLand{
			Index:                plot.Index,
			Status:               plot.Status,
			Crop:                 plot.Crop,
			Stage:                nil,
			GrowthProgress:       0,
			RemainingMs:          0,
			NextWaterRemainingMs: 0,
			OverripeFactor:       1,
			ExpectedQualityHint:  nil,
			ScarecrowActive:      scarecrowActive,
			BellActive:           bellActive,
			NetActive:            plot.Crop != nil && plot.Crop.BirdNetUntil != nil && *plot.Crop.BirdNetUntil > now,
		}

		switch {
		case plot.Status == LandStatusLocked:
			computed.Status = LandStatusLocked
		case plot.Status == LandStatusWithered:
			computed.Status = LandStatusWithered
		case plot.Status == LandStatusEaten:
			computed.Status = LandStatusEaten
		case plot.Crop == nil:
			computed.Status = LandStatusEmpty
		default:
			crop := *plot.Crop
			if crop.WaterMissCount >= 3 {
				computed.Status = LandStatusWithered
				computed.Crop = nil
				break
			}
			progress := computeGrowthProgress(crop, now)
			stage := computeCropStage(progress)
			computed.Stage = &stage
			computed.GrowthProgress = progress
			computed.RemainingMs = maxInt64(0, crop.MatureAt-now)
			computed.OverripeFactor = computeOverripeFactor(crop, now)
			computed.ExpectedQualityHint = estimateQualityHint(crop, now)
			if stage == CropStageMature {
				computed.Status = LandStatusMature
				computed.RemainingMs = 0
				computed.NextWaterRemainingMs = 0
			} else if plot.Status == LandStatusThirsty && crop.WaterMissCount > 0 {
				computed.Status = LandStatusThirsty
				computed.NextWaterRemainingMs = maxInt64(0, crop.NextWaterDueAt-now)
			} else if now > crop.NextWaterDueAt {
				computed.Status = LandStatusThirsty
				computed.NextWaterRemainingMs = 0
			} else {
				computed.Status = LandStatusGrowing
				computed.NextWaterRemainingMs = maxInt64(0, crop.NextWaterDueAt-now)
			}
		}

		lands = append(lands, computed)
	}
	return lands
}

func getPlantableCrops(state FarmState, season Season) []CropID {
	unlockedLandCount := 0
	for _, land := range state.Lands {
		if land.Status != LandStatusLocked {
			unlockedLandCount++
		}
	}
	ids := []CropID{}
	for _, crop := range cropDefs {
		if crop.UnlockLandCount > unlockedLandCount {
			continue
		}
		if !seasonContains(crop.Seasons, season) {
			continue
		}
		ids = append(ids, crop.ID)
	}
	return ids
}

func seasonContains(seasons []Season, season Season) bool {
	for _, item := range seasons {
		if item == season {
			return true
		}
	}
	return false
}

func floorDiv(a, b int64) int64 {
	q := a / b
	r := a % b
	if r != 0 && ((r < 0) != (b < 0)) {
		q--
	}
	return q
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

var timeFromUnixMilli = func(ms int64) time.Time {
	return time.UnixMilli(ms)
}
