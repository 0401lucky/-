package farm

import "encoding/json"

func (state *FarmState) UnmarshalJSON(data []byte) error {
	type alias FarmState
	var value alias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, key := range []string{
		"userId", "points", "lands", "scarecrowUntil", "bellUntil", "pet",
		"stolenTodayCount", "stolenByMap", "myStealMap", "inventory",
		"purchasedSkillBooks", "seedInventory", "events", "lastDailyResetAt",
		"lastSeasonProcessedAt", "lastTickAt", "lastFridayEventDate",
		"bonuses", "createdAt", "updatedAt",
	} {
		delete(raw, key)
	}
	*state = FarmState(value)
	state.Extra = raw
	return nil
}

func (state FarmState) MarshalJSON() ([]byte, error) {
	type alias FarmState
	raw, err := json.Marshal(alias(state))
	if err != nil {
		return nil, err
	}
	return mergeObjectJSON(raw, state.Extra)
}

func (plot *LandPlot) UnmarshalJSON(data []byte) error {
	type alias LandPlot
	var value alias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	delete(raw, "index")
	delete(raw, "status")
	delete(raw, "crop")
	*plot = LandPlot(value)
	plot.Extra = raw
	return nil
}

func (plot LandPlot) MarshalJSON() ([]byte, error) {
	type alias LandPlot
	raw, err := json.Marshal(alias(plot))
	if err != nil {
		return nil, err
	}
	return mergeObjectJSON(raw, plot.Extra)
}

func (crop *CropInstance) UnmarshalJSON(data []byte) error {
	type alias CropInstance
	var value alias
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for _, key := range []string{
		"cropId", "plantedAt", "matureAt", "lastWaterAt", "nextWaterDueAt",
		"waterMissCount", "fertilizer", "plantedSeason", "weatherAtPlant",
		"birdNetUntil", "stolenAmount", "stolenCount", "speedUsed",
		"speedReducedMinutes",
	} {
		delete(raw, key)
	}
	*crop = CropInstance(value)
	crop.Extra = raw
	return nil
}

func (crop CropInstance) MarshalJSON() ([]byte, error) {
	type alias CropInstance
	raw, err := json.Marshal(alias(crop))
	if err != nil {
		return nil, err
	}
	return mergeObjectJSON(raw, crop.Extra)
}

func mergeObjectJSON(raw []byte, extra map[string]json.RawMessage) ([]byte, error) {
	if len(extra) == 0 {
		return raw, nil
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return nil, err
	}
	for key, value := range extra {
		if _, exists := object[key]; !exists {
			object[key] = value
		}
	}
	return json.Marshal(object)
}
