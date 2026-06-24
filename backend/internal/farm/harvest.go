package farm

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
)

const firstHarvestBonus = int64(10)

type qualityRates struct {
	Normal float64
	Silver float64
	Gold   float64
}

type harvestResult struct {
	CropID             CropID  `json:"cropId"`
	CropName           string  `json:"cropName"`
	Quality            Quality `json:"quality"`
	BaseYield          int64   `json:"baseYield"`
	QualityMultiplier  float64 `json:"qualityMultiplier"`
	WaterMultiplier    float64 `json:"waterMultiplier"`
	SeasonMultiplier   float64 `json:"seasonMultiplier"`
	OverripeMultiplier float64 `json:"overripeMultiplier"`
	StolenDeduct       int64   `json:"stolenDeduct"`
	FinalYield         int64   `json:"finalYield"`
	Perfect            bool    `json:"perfect"`
	PlotIndex          int     `json:"-"`
	PlantedAt          int64   `json:"-"`
	StableComponent    string  `json:"-"`
}

func processPassivePetHarvest(state *FarmState, nowMs int64) (int64, int, string, bool) {
	if state == nil || !hasAdultPetSkill(state.Pet, "harvest") {
		return 0, 0, "", false
	}
	results := []harvestResult{}
	total := int64(0)
	for i := range state.Lands {
		land := &state.Lands[i]
		if land.Status != LandStatusMature || land.Crop == nil {
			continue
		}
		result, ok := doHarvestSingle(state, i, nowMs)
		if !ok {
			continue
		}
		results = append(results, result)
		total += result.FinalYield
	}
	if len(results) == 0 {
		return 0, 0, "", false
	}
	pushEvent(state, farmEvent{
		ID:   eventID(state.UserID, "pet_passive_harvest", nowMs, len(results)),
		Ts:   nowMs,
		Type: "pet_task",
		Text: fmt.Sprintf("宠物收菜被动触发，收获 %d 块作物，获得 %d 积分", len(results), total),
	})
	return total, len(results), passiveHarvestLedgerID(state.UserID, results), true
}

func doHarvestSingle(state *FarmState, plotIndex int, nowMs int64) (harvestResult, bool) {
	if state == nil || plotIndex < 0 || plotIndex >= len(state.Lands) {
		return harvestResult{}, false
	}
	land := &state.Lands[plotIndex]
	if land.Crop == nil || land.Status != LandStatusMature {
		return harvestResult{}, false
	}
	result, ok := buildHarvestResult(*state, plotIndex, nowMs)
	if !ok {
		return harvestResult{}, false
	}
	pushEvent(state, farmEvent{
		ID:        eventID(state.UserID, "harvest", nowMs, land.Index),
		Ts:        nowMs,
		Type:      "harvest",
		Text:      fmt.Sprintf("收获了 %s（%s）+%d 积分", result.CropName, qualityLabel(result.Quality), result.FinalYield),
		CropID:    result.CropID,
		LandIndex: land.Index,
		Amount:    result.FinalYield,
	})
	land.Status = LandStatusEmpty
	land.Crop = nil
	return result, true
}

func buildHarvestResult(state FarmState, plotIndex int, nowMs int64) (harvestResult, bool) {
	if plotIndex < 0 || plotIndex >= len(state.Lands) {
		return harvestResult{}, false
	}
	land := state.Lands[plotIndex]
	if land.Crop == nil {
		return harvestResult{}, false
	}
	crop := *land.Crop
	def, ok := cropDefByID[crop.CropID]
	if !ok {
		return harvestResult{}, false
	}
	season := getCurrentSeason(nowMs)
	perfect := isPerfectCare(crop, nowMs)
	rates := rollQualityRates(crop.Fertilizer, crop.WaterMissCount, perfect)
	rng := newSeedRandom(fmt.Sprintf("harvest:%d:%d:%d", state.UserID, crop.PlantedAt, plotIndex))
	quality := pickQuality(rates, rng)
	overripe := computeOverripeFactor(crop, nowMs)
	waterMultiplier := getWaterPenaltyMultiplier(crop.WaterMissCount)
	seasonMultiplier := getSeasonYieldMultiplier(season)
	qualityMultiplier := getQualityMultiplier(quality)
	finalYield := computeFinalYield(crop.CropID, quality, crop.WaterMissCount, season, overripe, crop.StolenAmount)
	return harvestResult{
		CropID:             crop.CropID,
		CropName:           def.Name,
		Quality:            quality,
		BaseYield:          def.BaseYield,
		QualityMultiplier:  qualityMultiplier,
		WaterMultiplier:    waterMultiplier,
		SeasonMultiplier:   seasonMultiplier,
		OverripeMultiplier: overripe,
		StolenDeduct:       crop.StolenAmount,
		FinalYield:         finalYield,
		Perfect:            perfect,
		PlotIndex:          plotIndex,
		PlantedAt:          crop.PlantedAt,
		StableComponent:    fmt.Sprintf("%d_%d_%s", plotIndex, crop.PlantedAt, crop.CropID),
	}, true
}

func rollQualityRates(fertilizer *string, missCount int64, perfect bool) qualityRates {
	rates := baseQualityRates(fertilizer)
	if missCount > 0 && missCount <= 2 {
		goldMul, silverMul := waterQualityPenalty(missCount)
		rates.Gold *= goldMul
		rates.Silver *= silverMul
	} else if missCount >= 3 {
		return qualityRates{Normal: 1}
	}
	if perfect {
		rates.Silver += 0.10
		rates.Gold += 0.05
	}
	rates.Silver = math.Max(0, rates.Silver)
	rates.Gold = math.Max(0, rates.Gold)
	rates.Normal = math.Max(0, 1-rates.Silver-rates.Gold)
	total := rates.Normal + rates.Silver + rates.Gold
	if total <= 0 {
		return qualityRates{Normal: 1}
	}
	rates.Normal /= total
	rates.Silver /= total
	rates.Gold /= total
	return rates
}

func baseQualityRates(fertilizer *string) qualityRates {
	if fertilizer == nil {
		return qualityRates{Normal: 0.75, Silver: 0.20, Gold: 0.05}
	}
	switch *fertilizer {
	case "normal":
		return qualityRates{Normal: 0.70, Silver: 0.20, Gold: 0.10}
	case "medium":
		return qualityRates{Normal: 0.55, Silver: 0.30, Gold: 0.15}
	case "premium":
		return qualityRates{Normal: 0.40, Silver: 0.35, Gold: 0.25}
	default:
		return qualityRates{Normal: 0.75, Silver: 0.20, Gold: 0.05}
	}
}

func waterQualityPenalty(missCount int64) (float64, float64) {
	switch missCount {
	case 1:
		return 0.5, 0.8
	case 2:
		return 0, 0.5
	default:
		return 1, 1
	}
}

func pickQuality(rates qualityRates, rng *seedRandom) Quality {
	r := rng.Float64()
	if r < rates.Normal {
		return QualityNormal
	}
	if r < rates.Normal+rates.Silver {
		return QualitySilver
	}
	return QualityGold
}

func computeFinalYield(cropID CropID, quality Quality, missCount int64, season Season, overripe float64, stolenAmount int64) int64 {
	def, ok := cropDefByID[cropID]
	if !ok {
		return 0
	}
	raw := float64(def.BaseYield) *
		getQualityMultiplier(quality) *
		getWaterPenaltyMultiplier(missCount) *
		getSeasonYieldMultiplier(season) *
		overripe
	return maxInt64(0, int64(math.Floor(raw))-stolenAmount)
}

func getQualityMultiplier(quality Quality) float64 {
	switch quality {
	case QualityGold:
		return 1.8
	case QualitySilver:
		return 1.3
	default:
		return 1.0
	}
}

func getWaterPenaltyMultiplier(missCount int64) float64 {
	switch missCount {
	case 0:
		return 1
	case 1:
		return 0.8
	case 2:
		return 0.5
	default:
		return 0
	}
}

func getSeasonYieldMultiplier(season Season) float64 {
	if season == SeasonAutumn {
		return 1.10
	}
	return 1.0
}

func qualityLabel(quality Quality) string {
	switch quality {
	case QualityGold:
		return "金星"
	case QualitySilver:
		return "银星"
	default:
		return "普通"
	}
}

func bonusFlag(raw json.RawMessage, key string) bool {
	bonuses := decodeBonusMap(raw)
	value, _ := bonuses[key].(bool)
	return value
}

func setBonusFlag(raw json.RawMessage, key string, value bool) json.RawMessage {
	bonuses := decodeBonusMap(raw)
	bonuses[key] = value
	return encodeJSONOrDefault(bonuses, `{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`)
}

func decodeBonusMap(raw json.RawMessage) map[string]any {
	bonuses := map[string]any{
		"firstWater":   false,
		"firstHarvest": false,
		"firstAdopt":   false,
	}
	if len(raw) == 0 || string(raw) == "null" {
		return bonuses
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return bonuses
	}
	for key, value := range decoded {
		bonuses[key] = value
	}
	return bonuses
}

func passiveHarvestLedgerID(userID int64, results []harvestResult) string {
	parts := make([]string, 0, len(results))
	for _, result := range results {
		parts = append(parts, result.StableComponent)
	}
	return fmt.Sprintf("farm_pet_passive_harvest_%d_%s", userID, strings.Join(parts, "-"))
}
