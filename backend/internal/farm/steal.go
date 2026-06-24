package farm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	stealLimitPerPlayerDailyMaxBeingStolen = int64(5)
	stealLimitPerThiefDailyPerTarget       = int64(1)
	petTaskMinuteMs                        = int64(60 * 1000)
	petStealDurationMs                     = int64(10 * 60 * 1000)
	petStealCooldownMs                     = int64(240 * 60 * 1000)
)

type floatRNG interface {
	Float64() float64
}

type StealResult struct {
	OK       bool   `json:"ok"`
	Msg      string `json:"msg,omitempty"`
	Success  bool   `json:"success,omitempty"`
	Amount   int64  `json:"amount,omitempty"`
	CropID   CropID `json:"cropId,omitempty"`
	CropName string `json:"cropName,omitempty"`
	Balance  int64  `json:"balance,omitempty"`
}

func (service *Service) ListStealCandidates(ctx context.Context, currentUserID int64, max int64) ([]StealCandidate, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return nil, ErrUnavailable
	}
	if currentUserID <= 0 {
		return nil, fmt.Errorf("current user ID must be positive")
	}
	if max <= 0 {
		max = 8
	}
	if max > 50 {
		max = 50
	}

	myStealMap := map[string]int64{}
	currentRecord, err := service.store.GetState(ctx, currentUserID)
	if err != nil {
		return nil, err
	}
	if currentRecord.Exists {
		var currentState FarmState
		if err := json.Unmarshal(currentRecord.StateJSON, &currentState); err != nil {
			return nil, err
		}
		if currentState.MyStealMap != nil {
			myStealMap = currentState.MyStealMap
		}
	}

	records, err := service.store.listStealCandidateRecords(ctx, currentUserID, 200)
	if err != nil {
		return nil, err
	}
	candidates := make([]StealCandidate, 0, max)
	for _, record := range records {
		if int64(len(candidates)) >= max {
			break
		}
		targetKey := fmt.Sprintf("%d", record.UserID)
		if myStealMap[targetKey] >= stealLimitPerThiefDailyPerTarget {
			continue
		}
		if record.State.StolenTodayCount >= stealLimitPerPlayerDailyMaxBeingStolen {
			continue
		}
		if len(getStealableMatureIndexes(record.State)) == 0 {
			continue
		}
		nickname := strings.TrimSpace(record.Nickname)
		if nickname == "" {
			nickname = fmt.Sprintf("玩家%d", record.UserID)
		}
		candidates = append(candidates, StealCandidate{
			UserID:    record.UserID,
			Nickname:  nickname,
			AvatarURL: record.AvatarURL,
		})
	}
	return candidates, nil
}

func (service *Service) ExecuteSteal(ctx context.Context, thiefID int64, targetUserID int64, nowMs int64) (StealResult, error) {
	if nowMs <= 0 {
		nowMs = timeNowMs()
	}
	rng := newSeedRandom(fmt.Sprintf("farm-steal:%d:%d:%d", thiefID, targetUserID, nowMs))
	return service.executeSteal(ctx, thiefID, targetUserID, nowMs, rng)
}

func (service *Service) executeSteal(ctx context.Context, thiefID int64, targetUserID int64, nowMs int64, rng floatRNG) (StealResult, error) {
	if service == nil || service.store == nil || service.store.db == nil {
		return StealResult{}, ErrUnavailable
	}
	if thiefID <= 0 || targetUserID <= 0 {
		return StealResult{}, fmt.Errorf("user IDs must be positive")
	}
	if thiefID == targetUserID {
		return StealResult{OK: false, Msg: "不能偷自己"}, nil
	}
	if rng == nil {
		rng = newSeedRandom(fmt.Sprintf("farm-steal:%d:%d:%d", thiefID, targetUserID, nowMs))
	}

	tx, err := service.store.db.Begin(ctx)
	if err != nil {
		return StealResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	firstID, secondID := thiefID, targetUserID
	if secondID < firstID {
		firstID, secondID = secondID, firstID
	}
	firstState, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, firstID, nowMs)
	if err != nil {
		return StealResult{}, err
	}
	secondState, err := service.store.getOrCreateStateForUpdateTx(ctx, tx, secondID, nowMs)
	if err != nil {
		return StealResult{}, err
	}

	thief := firstState
	target := secondState
	if thiefID == secondID {
		thief = secondState
		target = firstState
	}

	thief = normalizeState(thief, nowMs)
	target = normalizeState(target, nowMs)
	tickBasicCropState(&thief, nowMs)
	tickBasicCropState(&target, nowMs)

	if !isAdultPet(thief.Pet) {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "宠物未成年，不能偷菜"}, nil
	}
	if ready := validatePetSkillReady(thief.Pet, "steal", nowMs); !ready.OK {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: ready.Msg}, nil
	}

	targetKey := fmt.Sprintf("%d", targetUserID)
	myCount := thief.MyStealMap[targetKey]
	if myCount >= stealLimitPerThiefDailyPerTarget {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "今天已偷过该玩家"}, nil
	}
	if target.StolenTodayCount >= stealLimitPerPlayerDailyMaxBeingStolen {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "该玩家今天被偷次数已达上限"}, nil
	}

	landIndex, ok := pickRandomStealableMatureIndex(target, rng)
	if !ok {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "该玩家暂无可偷的成熟作物"}, nil
	}
	land := target.Lands[landIndex]
	if land.Crop == nil || land.Status != LandStatusMature {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "目标作物不可偷"}, nil
	}

	if ready := dispatchPetTask(&thief, "steal", nowMs, stealTarget{
		UserID:    targetUserID,
		LandIndex: landIndex,
		CropID:    land.Crop.CropID,
	}); !ready.OK {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: ready.Msg}, nil
	}

	successRate := computeStealSuccessRate(thief, target, nowMs)
	if rng.Float64() >= successRate {
		pushEvent(&thief, farmEvent{
			ID:   eventID(thief.UserID, "steal_failed", nowMs, land.Index),
			Ts:   nowMs,
			Type: "pet_task",
			Text: "偷菜失败：被对方守护住了",
		})
		incrementMyStealCount(&thief, targetUserID, myCount)
		if err := service.store.saveStateTx(ctx, tx, thief, nowMs); err != nil {
			return StealResult{}, err
		}
		if err := service.store.saveStateTx(ctx, tx, target, nowMs); err != nil {
			return StealResult{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: true, Success: false}, nil
	}

	harvest, ok := buildHarvestResult(target, landIndex, nowMs)
	if !ok {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "目标作物不可偷"}, nil
	}
	amount := harvest.FinalYield
	if !applyWholeStealOnTarget(&target, thiefID, landIndex, amount, nowMs) {
		if err := tx.Commit(ctx); err != nil {
			return StealResult{}, err
		}
		return StealResult{OK: false, Msg: "目标作物不可偷"}, nil
	}
	balance, _, err := service.store.addFarmPointsTx(
		ctx,
		tx,
		thiefID,
		amount,
		fmt.Sprintf("farm_steal_%d_%d_%s", thiefID, targetUserID, getChinaDateString(nowMs)),
		fmt.Sprintf("偷菜成功: %d 的 %s", target.UserID, harvest.CropName),
		nowMs,
	)
	if err != nil {
		return StealResult{}, err
	}
	thief.Points = balance
	pushEvent(&thief, farmEvent{
		ID:     eventID(thief.UserID, "stolen_out", nowMs, land.Index),
		Ts:     nowMs,
		Type:   "stolen_out",
		Text:   fmt.Sprintf("偷菜成功，随机偷到 %s +%d 积分", harvest.CropName, amount),
		CropID: harvest.CropID,
		Amount: amount,
	})
	incrementMyStealCount(&thief, targetUserID, myCount)

	if err := service.store.saveStateTx(ctx, tx, thief, nowMs); err != nil {
		return StealResult{}, err
	}
	if err := service.store.saveStateTx(ctx, tx, target, nowMs); err != nil {
		return StealResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StealResult{}, err
	}
	return StealResult{
		OK:       true,
		Success:  true,
		Amount:   amount,
		CropID:   harvest.CropID,
		CropName: harvest.CropName,
		Balance:  balance,
	}, nil
}

func getStealableMatureIndexes(state FarmState) []int {
	indexes := []int{}
	for i, land := range state.Lands {
		if land.Status == LandStatusMature && land.Crop != nil {
			indexes = append(indexes, i)
		}
	}
	return indexes
}

func pickRandomStealableMatureIndex(state FarmState, rng floatRNG) (int, bool) {
	indexes := getStealableMatureIndexes(state)
	if len(indexes) == 0 {
		return 0, false
	}
	if rng == nil {
		rng = newSeedRandom(fmt.Sprintf("steal:%d:%d", state.UserID, len(indexes)))
	}
	return indexes[int(rng.Float64()*float64(len(indexes)))], true
}

type skillReadyResult struct {
	OK  bool
	Msg string
}

type stealTarget struct {
	UserID    int64
	LandIndex int
	CropID    CropID
}

func validatePetSkillReady(raw json.RawMessage, skill string, nowMs int64) skillReadyResult {
	pet, ok := decodePetMap(raw)
	if !ok {
		return skillReadyResult{OK: false, Msg: "请先领养宠物"}
	}
	normalizePetMap(pet)
	if stage, _ := pet["stage"].(string); stage != "adult" {
		return skillReadyResult{OK: false, Msg: "宠物未成年，不能使用技能"}
	}
	if !petHasSkill(pet, skill) {
		return skillReadyResult{OK: false, Msg: fmt.Sprintf("宠物还没有学习%s技能", petTaskLabel(skill))}
	}
	if petNumber(pet, "hunger") < 25 || petNumber(pet, "cleanliness") < 25 ||
		petNumber(pet, "thirst") < 20 || petNumber(pet, "health") < 35 || petNumber(pet, "mood") < 25 {
		return skillReadyResult{OK: false, Msg: "宠物状态太差，不能工作"}
	}
	if task, _ := pet["currentTask"].(string); task != "" {
		if taskEndAt, ok := petOptionalInt64(pet, "taskEndAt"); ok && taskEndAt > nowMs {
			return skillReadyResult{OK: false, Msg: "宠物正在工作中"}
		}
	}
	if cooldownEndAt, ok := petOptionalInt64(pet, "cooldownEndAt"); ok && cooldownEndAt > nowMs {
		return skillReadyResult{OK: false, Msg: "宠物正在休息"}
	}
	return skillReadyResult{OK: true}
}

func dispatchPetTask(state *FarmState, task string, nowMs int64, target stealTarget) skillReadyResult {
	ready := validatePetSkillReady(state.Pet, task, nowMs)
	if !ready.OK {
		return ready
	}
	pet, ok := decodePetMap(state.Pet)
	if !ok {
		return skillReadyResult{OK: false, Msg: "请先领养宠物"}
	}
	normalizePetMap(pet)
	pet["currentTask"] = task
	pet["taskStartAt"] = float64(nowMs)
	taskEndAt := nowMs + petTaskDurationMs(task)
	pet["taskEndAt"] = float64(taskEndAt)
	pet["cooldownEndAt"] = float64(taskEndAt + petTaskCooldownMs(task, pet))
	switch task {
	case "steal":
		pet["stealTarget"] = map[string]any{
			"userId":    float64(target.UserID),
			"landIndex": float64(target.LandIndex),
			"cropId":    string(target.CropID),
		}
	default:
		pet["stealTarget"] = nil
	}
	state.Pet = encodeJSONOrDefault(pet, `null`)
	return skillReadyResult{OK: true}
}

func petTaskDurationMs(task string) int64 {
	switch task {
	case "water":
		return 180 * petTaskMinuteMs
	case "guard", "chase_crow":
		return 240 * petTaskMinuteMs
	case "steal":
		return petStealDurationMs
	default:
		return 0
	}
}

func petTaskCooldownMs(task string, pet map[string]any) int64 {
	switch task {
	case "water":
		petType, _ := pet["type"].(string)
		return petWaterRestMinutes(petType) * petTaskMinuteMs
	case "guard", "chase_crow", "harvest", "plant":
		return 120 * petTaskMinuteMs
	case "steal":
		return petStealCooldownMs
	default:
		return 0
	}
}

func petWaterRestMinutes(petType string) int64 {
	switch petType {
	case "cat":
		return 45
	case "dog":
		return 30
	case "rabbit":
		return 35
	case "red_panda":
		return 40
	default:
		return 45
	}
}

func isAdultPet(raw json.RawMessage) bool {
	pet, ok := decodePetMap(raw)
	if !ok {
		return false
	}
	normalizePetMap(pet)
	stage, _ := pet["stage"].(string)
	return stage == "adult"
}

func petHasSkill(pet map[string]any, skill string) bool {
	skills, ok := pet["learnedSkills"].([]any)
	if !ok {
		return false
	}
	for _, item := range skills {
		if value, _ := item.(string); value == skill {
			return true
		}
	}
	return false
}

func incrementMyStealCount(state *FarmState, targetUserID int64, previous int64) {
	if state.MyStealMap == nil {
		state.MyStealMap = map[string]int64{}
	}
	state.MyStealMap[fmt.Sprintf("%d", targetUserID)] = previous + 1
}

func computeStealSuccessRate(thiefState FarmState, targetState FarmState, nowMs int64) float64 {
	pet, ok := decodePetMap(thiefState.Pet)
	if !ok {
		return 0
	}
	petType, _ := pet["type"].(string)
	base := petStealBaseSuccess(petType)
	if base <= 0 {
		return 0
	}

	mood := petNumber(pet, "mood")
	moodMul := 1.0
	switch {
	case mood >= 70:
		moodMul = 1.15
	case mood >= 30:
		moodMul = 1.0
	default:
		moodMul = 0.8
	}

	hunger := petNumber(pet, "hunger")
	cleanliness := petNumber(pet, "cleanliness")
	thirst := petNumber(pet, "thirst")
	health := petNumber(pet, "health")
	if hunger < 25 || cleanliness < 25 || thirst < 20 || health < 35 || mood < 25 {
		return 0
	}
	statusMul := 1.0
	if hunger < 40 || cleanliness < 40 || thirst < 40 || health < 50 || mood < 40 {
		statusMul = 0.5
	}

	guardMul := 1.0
	if guard, ok := activePetTask(targetState.Pet, "guard", nowMs); ok {
		guardMul = petGuardStealMultiplier(guard.Type)
	}
	if targetState.BellUntil != nil && *targetState.BellUntil > nowMs {
		guardMul *= 0.5
	}
	return base * moodMul * statusMul * guardMul
}

func applyWholeStealOnTarget(targetState *FarmState, thiefID int64, landIndex int, amount int64, ts int64) bool {
	if targetState == nil || landIndex < 0 || landIndex >= len(targetState.Lands) {
		return false
	}
	land := &targetState.Lands[landIndex]
	if land.Crop == nil || land.Status != LandStatusMature {
		return false
	}
	cropID := land.Crop.CropID
	cropName := cropName(cropID)
	land.Status = LandStatusEmpty
	land.Crop = nil
	targetState.StolenTodayCount++
	if targetState.StolenByMap == nil {
		targetState.StolenByMap = map[string]int64{}
	}
	targetState.StolenByMap[fmt.Sprintf("%d", thiefID)]++
	pushEvent(targetState, farmEvent{
		ID:        eventID(targetState.UserID, "stolen_in", ts, land.Index),
		Ts:        ts,
		Type:      "stolen_in",
		Text:      fmt.Sprintf("你的 %s 被整棵偷走了，本次没有获得收益", cropName),
		CropID:    cropID,
		LandIndex: land.Index,
		Amount:    amount,
	})
	return true
}

func petStealBaseSuccess(petType string) float64 {
	switch petType {
	case "cat":
		return 0.75
	case "dog":
		return 0.55
	case "rabbit":
		return 0.65
	case "red_panda":
		return 0.70
	default:
		return 0
	}
}

func petGuardStealMultiplier(petType string) float64 {
	switch petType {
	case "cat":
		return 0.55
	case "dog":
		return 0.30
	case "rabbit":
		return 0.45
	case "red_panda":
		return 0.40
	default:
		return 1.0
	}
}
