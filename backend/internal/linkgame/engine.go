package linkgame

import (
	"fmt"
	"math"
)

const (
	maxShuffleAttempts            = 100
	defaultZ                      = 0
	SessionSettlementGraceSeconds = int64(60)
	MinGameDurationMillis         = int64(5000)
	PointRewardPercent            = int64(1)
	HardDeadlockRewardPercent     = int64(10)
	HardCompletionRewardPercent   = int64(20)
	HardTimeoutRewardPercent      = int64(1)
)

var TileIDs = []string{
	"red-apple", "orange", "lemon", "grapes", "strawberry", "cherries", "peach", "kiwi",
	"banana", "watermelon", "mango", "pineapple", "blueberries", "melon", "pear", "coconut",
	"green-apple", "avocado", "tomato", "durian", "dragon-fruit", "pomegranate", "plum", "raspberry",
}

var TileTypeCount = map[Difficulty]int{
	DifficultyEasy:   8,
	DifficultyNormal: 12,
	DifficultyHard:   24,
}

var HardDeadlockRateByStage = []float64{0, 0.025, 0.05, 0.1, 0}

var StackLayers = []LayerConfig{
	{Z: 0, RowStart: 0, ColStart: 0, Rows: 8, Cols: 8, Cells: cellsFromMask([]string{
		"11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111", "11111111",
	})},
	{Z: 1, RowStart: 0, ColStart: 0, Rows: 8, Cols: 8, Cells: cellsFromMask([]string{
		"00000000", "00111100", "00111100", "01111110", "01111110", "00111100", "00000000", "00000000",
	})},
	{Z: 2, RowStart: 0, ColStart: 0, Rows: 8, Cols: 8, Cells: cellsFromMask([]string{
		"00000000", "00111100", "00111100", "00111100", "00111100", "00111100", "00000000", "00000000",
	})},
	{Z: 3, RowStart: 0, ColStart: 0, Rows: 8, Cols: 8, Cells: cellsFromMask([]string{
		"00000000", "00000000", "00011000", "00111100", "00111100", "00011000", "00000000", "00000000",
	})},
	{Z: 4, RowStart: 0, ColStart: 0, Rows: 8, Cols: 8, Cells: cellsFromMask([]string{
		"00000000", "00000000", "00011000", "00111100", "00111100", "00011000", "00000000", "00000000",
	})},
}

var DifficultyConfigs = map[Difficulty]DifficultyConfig{
	DifficultyEasy: {
		Rows: 8, Cols: 8, Pairs: 32, BaseScore: 15, TimeLimit: 180, Mode: BoardModeClassic2D,
	},
	DifficultyNormal: {
		Rows: 8, Cols: 10, Pairs: 40, BaseScore: 18, TimeLimit: 210, Mode: BoardModeClassic2D,
	},
	DifficultyHard: {
		Rows: 8, Cols: 8, Pairs: 66, BaseScore: 24, TimeLimit: 300, Mode: BoardModeStack3D, Depth: 5, Layers: StackLayers,
	},
}

func NormalizeDifficulty(value Difficulty) Difficulty {
	if _, ok := DifficultyConfigs[value]; ok {
		return value
	}
	return DifficultyEasy
}

func IsDifficulty(value Difficulty) bool {
	_, ok := DifficultyConfigs[value]
	return ok
}

func DifficultyConfigFor(difficulty Difficulty) DifficultyConfig {
	return DifficultyConfigs[NormalizeDifficulty(difficulty)]
}

func SessionTTLSeconds() int64 {
	maxLimit := int64(0)
	for _, config := range DifficultyConfigs {
		if config.TimeLimit > maxLimit {
			maxLimit = config.TimeLimit
		}
	}
	return maxLimit + SessionSettlementGraceSeconds
}

func PlayableUntil(session Session) int64 {
	return session.StartedAt + DifficultyConfigFor(session.Difficulty).TimeLimit*1000
}

func RemainingSeconds(session Session, nowMs int64) int64 {
	config := DifficultyConfigFor(session.Difficulty)
	remaining := int64(math.Ceil(float64(PlayableUntil(session)-nowMs) / 1000))
	return maxInt64(0, minInt64(config.TimeLimit, remaining))
}

func BuildSessionView(session Session, nowMs int64) SessionView {
	return SessionView{
		SessionID:        session.ID,
		Difficulty:       session.Difficulty,
		TileLayout:       cloneBoard(session.TileLayout),
		StartedAt:        session.StartedAt,
		ExpiresAt:        session.ExpiresAt,
		PlayableUntil:    PlayableUntil(session),
		RemainingSeconds: RemainingSeconds(session, nowMs),
		Config:           DifficultyConfigFor(session.Difficulty),
	}
}

func GenerateTileLayout(difficulty Difficulty, seed string) []*string {
	normalized := NormalizeDifficulty(difficulty)
	config := DifficultyConfigFor(normalized)
	if IsStack3DConfig(config) {
		return generateStackTileLayout(normalized, config, seed)
	}

	totalCells := config.Rows * config.Cols
	tileTypeCount := TileTypeCount[normalized]
	if config.Pairs != totalCells/2 {
		panic(fmt.Sprintf("invalid config: pairs (%d) must equal totalCells/2 (%d)", config.Pairs, totalCells/2))
	}

	tiles := make([]*string, 0, config.Pairs*2)
	for i := 0; i < config.Pairs; i++ {
		tile := TileIDs[i%tileTypeCount]
		tiles = append(tiles, stringPtr(tile), stringPtr(tile))
	}

	lastLayout := []*string{}
	for attempt := 0; attempt < maxShuffleAttempts; attempt++ {
		layout := shuffleStringPtrs(tiles, newSeedRandom(fmt.Sprintf("%s-gen-%d", seed, attempt)))
		lastLayout = layout
		if FindHint(layout, config.Rows, config.Cols) != nil {
			return layout
		}
	}
	return lastLayout
}

func CheckGameComplete(board []*string) bool {
	for _, tile := range board {
		if tile != nil {
			return false
		}
	}
	return true
}

func GetSettlementResult(completed bool, outcome SettlementOutcome) SettlementResult {
	if outcome == "" {
		if completed {
			outcome = OutcomeCompleted
		} else {
			outcome = OutcomeTimeout
		}
	}
	if completed && outcome == OutcomeCompleted {
		return ResultWin
	}
	return ResultLoss
}

func CalculateScore(matchedPairs int, baseScore int64, combo int, timeRemainingSeconds int64, difficulty Difficulty, totalPairs int, outcome SettlementOutcome) int64 {
	if difficulty == DifficultyHard {
		return calculateHardScore(matchedPairs, baseScore, timeRemainingSeconds, totalPairs, outcome)
	}
	comboMultiplier := math.Min(1.5, 1+float64(combo)*0.1)
	rawScore := float64(matchedPairs)*float64(maxInt64(0, baseScore))*comboMultiplier + float64(maxInt64(0, timeRemainingSeconds))
	return int64(math.Round(math.Max(0, rawScore)))
}

func CalculatePointReward(score int64, difficulty Difficulty, outcome SettlementOutcome) int64 {
	if score <= 0 {
		return 0
	}
	percent := PointRewardPercent
	if difficulty == DifficultyHard && outcome == OutcomeDeadlock {
		percent = HardDeadlockRewardPercent
	} else if difficulty == DifficultyHard && outcome == OutcomeCompleted {
		percent = HardCompletionRewardPercent
	} else if difficulty == DifficultyHard && outcome == OutcomeTimeout {
		percent = HardTimeoutRewardPercent
	}
	return score * percent / 100
}

func ValidateSettlementTiming(serverDurationMs int64, config DifficultyConfig, outcome SettlementOutcome) (bool, string) {
	if serverDurationMs < MinGameDurationMillis {
		return false, "游戏时长过短"
	}
	timeLimitMs := config.TimeLimit * 1000
	if outcome == OutcomeTimeout && serverDurationMs < timeLimitMs {
		return false, "游戏尚未超时"
	}
	if outcome == OutcomeCompleted && serverDurationMs > timeLimitMs {
		return false, "游戏已超时"
	}
	return true, ""
}

func ValidateResult(session Session, payload SubmitInput) ValidationResult {
	config := DifficultyConfigFor(session.Difficulty)
	if payload.Moves == nil {
		return ValidationResult{OK: false, Message: "无效的操作数据"}
	}
	requestedOutcome := payload.Outcome
	if requestedOutcome == "" {
		if payload.Completed {
			requestedOutcome = OutcomeCompleted
		} else {
			requestedOutcome = OutcomeTimeout
		}
	}
	if requestedOutcome != OutcomeCompleted && requestedOutcome != OutcomeDeadlock && requestedOutcome != OutcomeTimeout {
		return ValidationResult{OK: false, Message: "无效的结算类型"}
	}

	board := cloneBoard(session.TileLayout)
	matchedPairs := 0
	currentStreak := 0
	maxStreak := 0

	for _, move := range payload.Moves {
		if move.Type == "hint" || move.Type == "shuffle" {
			return ValidationResult{OK: false, Message: "道具已移除"}
		}
		if move.Type != "" && move.Type != "match" {
			return ValidationResult{OK: false, Message: "无效的操作类型"}
		}
		if move.Pos3 != nil {
			return ValidationResult{OK: false, Message: "三连模式已停用"}
		}
		if !IsActivePosition(config, move.Pos1) {
			return ValidationResult{OK: false, Message: "位置1超出边界"}
		}
		if !IsActivePosition(config, move.Pos2) {
			return ValidationResult{OK: false, Message: "位置2超出边界"}
		}
		if IndexOfPosition(move.Pos1, config) == IndexOfPosition(move.Pos2, config) {
			return ValidationResult{OK: false, Message: "不能选择同一个位置"}
		}
		if GetTileAt(board, move.Pos1, config) == nil {
			return ValidationResult{OK: false, Message: "位置1没有瓦片"}
		}
		if GetTileAt(board, move.Pos2, config) == nil {
			return ValidationResult{OK: false, Message: "位置2没有瓦片"}
		}
		serverCanMatch := CanMatchByConfig(board, move.Pos1, move.Pos2, config)
		if move.Matched != serverCanMatch {
			return ValidationResult{OK: false, Message: "匹配结果不一致"}
		}
		if move.Matched {
			board = RemoveMatchByConfig(board, move.Pos1, move.Pos2, config)
			matchedPairs++
			currentStreak++
			if currentStreak > maxStreak {
				maxStreak = currentStreak
			}
		} else {
			currentStreak = 0
		}
	}

	completed := CheckGameComplete(board)
	deadlocked := !completed && FindHintByConfig(board, config) == nil
	if requestedOutcome == OutcomeCompleted {
		if !payload.Completed || !completed {
			return ValidationResult{OK: false, Message: "完成状态不一致"}
		}
	} else if requestedOutcome == OutcomeDeadlock {
		if session.Difficulty != DifficultyHard {
			return ValidationResult{OK: false, Message: "只有困难模式支持死局结算"}
		}
		if payload.Completed || completed {
			return ValidationResult{OK: false, Message: "死局状态不一致"}
		}
		if !deadlocked {
			return ValidationResult{OK: false, Message: "当前牌面仍有可消除的牌"}
		}
	} else if payload.Completed || completed {
		return ValidationResult{OK: false, Message: "完成状态不一致"}
	}

	return ValidationResult{
		OK: true, MatchedPairs: matchedPairs, MaxStreak: maxStreak,
		Completed: completed, Deadlocked: deadlocked, Outcome: requestedOutcome,
	}
}

func IsStack3DConfig(config DifficultyConfig) bool {
	return config.Mode == BoardModeStack3D
}

func GetBoardDepth(config DifficultyConfig) int {
	if !IsStack3DConfig(config) {
		return 1
	}
	if config.Depth > 0 {
		return config.Depth
	}
	maxZ := 0
	for _, layer := range config.Layers {
		if layer.Z > maxZ {
			maxZ = layer.Z
		}
	}
	return maxZ + 1
}

func IsActivePosition(config DifficultyConfig, pos Position) bool {
	z := zOf(pos)
	layer := getLayer(config, z)
	if layer == nil {
		return false
	}
	if len(layer.Cells) > 0 {
		for _, cell := range layer.Cells {
			if cell.Row == pos.Row && cell.Col == pos.Col {
				return true
			}
		}
		return false
	}
	return pos.Row >= layer.RowStart &&
		pos.Row < layer.RowStart+layer.Rows &&
		pos.Col >= layer.ColStart &&
		pos.Col < layer.ColStart+layer.Cols
}

func GetActivePositions(config DifficultyConfig) []Position {
	positions := []Position{}
	if !IsStack3DConfig(config) {
		for row := 0; row < config.Rows; row++ {
			for col := 0; col < config.Cols; col++ {
				positions = append(positions, Position{Row: row, Col: col})
			}
		}
		return positions
	}
	for _, layer := range config.Layers {
		z := layer.Z
		if len(layer.Cells) > 0 {
			for _, cell := range layer.Cells {
				positions = append(positions, Position{Row: cell.Row, Col: cell.Col, Z: &z})
			}
			continue
		}
		for row := layer.RowStart; row < layer.RowStart+layer.Rows; row++ {
			for col := layer.ColStart; col < layer.ColStart+layer.Cols; col++ {
				positions = append(positions, Position{Row: row, Col: col, Z: &z})
			}
		}
	}
	return positions
}

func GetActiveTileCount(config DifficultyConfig) int {
	return len(GetActivePositions(config))
}

func IndexOf(pos Position, cols int, rows int) int {
	z := 0
	if rows > 0 {
		z = zOf(pos)
	}
	return z*rows*cols + pos.Row*cols + pos.Col
}

func PositionOf(index int, cols int, rows int) Position {
	if rows > 0 {
		layerSize := rows * cols
		z := index / layerSize
		layerIndex := index % layerSize
		return Position{Row: layerIndex / cols, Col: layerIndex % cols, Z: &z}
	}
	return Position{Row: index / cols, Col: index % cols}
}

func IndexOfPosition(pos Position, config DifficultyConfig) int {
	return IndexOf(pos, config.Cols, config.Rows)
}

func GetTileAt(board []*string, pos Position, config DifficultyConfig) *string {
	if !IsActivePosition(config, pos) {
		return nil
	}
	index := IndexOfPosition(pos, config)
	if index < 0 || index >= len(board) {
		return nil
	}
	return board[index]
}

func CanMatchByConfig(board []*string, pos1 Position, pos2 Position, config DifficultyConfig) bool {
	if IsStack3DConfig(config) {
		return CanStackMatch(board, pos1, pos2, config)
	}
	return CanMatch(board, pos1, pos2, config.Cols)
}

func RemoveMatchByConfig(board []*string, pos1 Position, pos2 Position, config DifficultyConfig) []*string {
	next := cloneBoard(board)
	idx1 := IndexOfPosition(pos1, config)
	idx2 := IndexOfPosition(pos2, config)
	if idx1 >= 0 && idx1 < len(next) {
		next[idx1] = nil
	}
	if idx2 >= 0 && idx2 < len(next) {
		next[idx2] = nil
	}
	return next
}

func FindHintByConfig(board []*string, config DifficultyConfig) *struct {
	Pos1 Position
	Pos2 Position
} {
	if IsStack3DConfig(config) {
		return findStackHintInternal(board, config)
	}
	return FindHint(board, config.Rows, config.Cols)
}

func CanStackMatch(board []*string, pos1 Position, pos2 Position, config DifficultyConfig) bool {
	if !IsStack3DConfig(config) || samePosition(pos1, pos2) {
		return false
	}
	if !IsActivePosition(config, pos1) || !IsActivePosition(config, pos2) {
		return false
	}
	tile1 := GetTileAt(board, pos1, config)
	tile2 := GetTileAt(board, pos2, config)
	if tile1 == nil || tile2 == nil || *tile1 != *tile2 {
		return false
	}
	return !IsStackTileBlocked(board, pos1, config, nil) && !IsStackTileBlocked(board, pos2, config, nil)
}

func IsStackTileBlocked(board []*string, pos Position, config DifficultyConfig, ignored []Position) bool {
	if !IsStack3DConfig(config) || !IsActivePosition(config, pos) {
		return false
	}
	for z := zOf(pos) + 1; z < GetBoardDepth(config); z++ {
		upper := Position{Row: pos.Row, Col: pos.Col, Z: &z}
		if !IsActivePosition(config, upper) {
			continue
		}
		if containsPosition(ignored, upper) {
			continue
		}
		if GetTileAt(board, upper, config) != nil {
			return true
		}
	}
	return false
}

func FindHint(board []*string, rows int, cols int) *struct {
	Pos1 Position
	Pos2 Position
} {
	tilePositions := map[string][]Position{}
	for i, tile := range board {
		if tile == nil {
			continue
		}
		pos := PositionOf(i, cols, 0)
		tilePositions[*tile] = append(tilePositions[*tile], pos)
	}
	for _, positions := range tilePositions {
		for i := 0; i < len(positions); i++ {
			for j := i + 1; j < len(positions); j++ {
				if CanMatch(board, positions[i], positions[j], cols) {
					return &struct {
						Pos1 Position
						Pos2 Position
					}{positions[i], positions[j]}
				}
			}
		}
	}
	return nil
}

func CanMatch(board []*string, pos1 Position, pos2 Position, cols int) bool {
	return FindMatchPath(board, pos1, pos2, cols) != nil
}

func FindMatchPath(board []*string, pos1 Position, pos2 Position, cols int) []Position {
	if pos1.Row == pos2.Row && pos1.Col == pos2.Col {
		return nil
	}
	tile1 := getTile(board, pos1, cols, 0)
	tile2 := getTile(board, pos2, cols, 0)
	if tile1 == nil || tile2 == nil || *tile1 != *tile2 {
		return nil
	}
	rows := len(board) / cols
	if rows <= 0 || rows*cols != len(board) {
		return nil
	}

	pr1, pc1 := pos1.Row+1, pos1.Col+1
	pr2, pc2 := pos2.Row+1, pos2.Col+1
	check := func(r1, c1, r2, c2 int) bool {
		return isSegmentClearPadded(board, rows, cols, r1, c1, r2, c2, pr1, pc1, pr2, pc2)
	}
	if (pr1 == pr2 || pc1 == pc2) && check(pr1, pc1, pr2, pc2) {
		return compactPath([]Position{paddedToVirtual(pr1, pc1), paddedToVirtual(pr2, pc2)})
	}
	if check(pr1, pc1, pr1, pc2) && check(pr1, pc2, pr2, pc2) {
		return compactPath([]Position{paddedToVirtual(pr1, pc1), paddedToVirtual(pr1, pc2), paddedToVirtual(pr2, pc2)})
	}
	if check(pr1, pc1, pr2, pc1) && check(pr2, pc1, pr2, pc2) {
		return compactPath([]Position{paddedToVirtual(pr1, pc1), paddedToVirtual(pr2, pc1), paddedToVirtual(pr2, pc2)})
	}
	for midR := 0; midR <= rows+1; midR++ {
		if midR == pr1 || midR == pr2 {
			continue
		}
		if check(pr1, pc1, midR, pc1) && check(midR, pc1, midR, pc2) && check(midR, pc2, pr2, pc2) {
			return compactPath([]Position{paddedToVirtual(pr1, pc1), paddedToVirtual(midR, pc1), paddedToVirtual(midR, pc2), paddedToVirtual(pr2, pc2)})
		}
	}
	for midC := 0; midC <= cols+1; midC++ {
		if midC == pc1 || midC == pc2 {
			continue
		}
		if check(pr1, pc1, pr1, midC) && check(pr1, midC, pr2, midC) && check(pr2, midC, pr2, pc2) {
			return compactPath([]Position{paddedToVirtual(pr1, pc1), paddedToVirtual(pr1, midC), paddedToVirtual(pr2, midC), paddedToVirtual(pr2, pc2)})
		}
	}
	return nil
}

func GetStackExposureStages(config DifficultyConfig) [][]Position {
	stacks := [][]Position{}
	for row := 0; row < config.Rows; row++ {
		for col := 0; col < config.Cols; col++ {
			stack := []Position{}
			for z := GetBoardDepth(config) - 1; z >= 0; z-- {
				pos := Position{Row: row, Col: col, Z: &z}
				if IsActivePosition(config, pos) {
					stack = append(stack, pos)
				}
			}
			if len(stack) > 0 {
				stacks = append(stacks, stack)
			}
		}
	}
	maxHeight := 0
	for _, stack := range stacks {
		if len(stack) > maxHeight {
			maxHeight = len(stack)
		}
	}
	stages := make([][]Position, maxHeight)
	for stageIndex := 0; stageIndex < maxHeight; stageIndex++ {
		for _, stack := range stacks {
			if stageIndex < len(stack) {
				stages[stageIndex] = append(stages[stageIndex], stack[stageIndex])
			}
		}
	}
	return stages
}

func GetHardDeadlockRateForStage(stageIndex int) float64 {
	if stageIndex < 0 {
		stageIndex = 0
	}
	if stageIndex >= len(HardDeadlockRateByStage) {
		stageIndex = len(HardDeadlockRateByStage) - 1
	}
	return HardDeadlockRateByStage[stageIndex]
}

func ShouldGenerateHardStageDeadlock(seed string, stageIndex int) bool {
	return newSeedRandom(fmt.Sprintf("%s-hard-stage-%d-deadlock", seed, stageIndex)).Float64() < GetHardDeadlockRateForStage(stageIndex)
}

func GetPlannedHardDeadlockStage(seed string, config DifficultyConfig) *int {
	stages := GetStackExposureStages(config)
	tileTypeCount := TileTypeCount[DifficultyHard]
	for stageIndex := 1; stageIndex < len(stages)-1; stageIndex++ {
		stageSize := len(stages[stageIndex])
		deeperSize := 0
		for _, stage := range stages[stageIndex+1:] {
			deeperSize += len(stage)
		}
		if stageSize == 0 || stageSize > tileTypeCount || deeperSize < stageSize {
			continue
		}
		if ShouldGenerateHardStageDeadlock(seed, stageIndex) {
			value := stageIndex
			return &value
		}
	}
	return nil
}

func generateStackTileLayout(difficulty Difficulty, config DifficultyConfig, seed string) []*string {
	activeCount := GetActiveTileCount(config)
	totalCells := config.Rows * config.Cols * GetBoardDepth(config)
	tileTypeCount := TileTypeCount[difficulty]
	if config.Pairs != activeCount/2 {
		panic(fmt.Sprintf("invalid stack config: pairs (%d) must equal activeCells/2 (%d)", config.Pairs, activeCount/2))
	}
	if difficulty == DifficultyHard {
		stages := GetStackExposureStages(config)
		rng := newSeedRandom(fmt.Sprintf("%s-stack-stage-gen", seed))
		layout := make([]*string, totalCells)
		used := map[string]bool{}
		deadlockStage := GetPlannedHardDeadlockStage(seed, config)
		if deadlockStage != nil {
			trapPositions := shufflePositions(stages[*deadlockStage], rng)
			hiddenMatePositions := shufflePositions(flattenStages(stages[*deadlockStage+1:]), rng)
			if len(hiddenMatePositions) > len(trapPositions) {
				hiddenMatePositions = hiddenMatePositions[:len(trapPositions)]
			}
			trapTiles := shuffleStrings(TileIDs[:tileTypeCount], rng)
			if len(trapTiles) > len(trapPositions) {
				trapTiles = trapTiles[:len(trapPositions)]
			}
			for i := range trapPositions {
				assignTile(layout, config, trapPositions[i], trapTiles[i])
				assignTile(layout, config, hiddenMatePositions[i], trapTiles[i])
				used[positionKey(trapPositions[i])] = true
				used[positionKey(hiddenMatePositions[i])] = true
			}
		}
		for stageIndex, stage := range stages {
			positions := make([]Position, 0, len(stage))
			for _, pos := range stage {
				if !used[positionKey(pos)] {
					positions = append(positions, pos)
				}
			}
			fillPairedPositions(layout, config, positions, newSeedRandom(fmt.Sprintf("%s-stack-stage-%d", seed, stageIndex)), tileTypeCount, fmt.Sprintf("%s-stack-stage-%d-tiles", seed, stageIndex))
		}
		unfilled := []Position{}
		for _, pos := range GetActivePositions(config) {
			if layout[IndexOfPosition(pos, config)] == nil {
				unfilled = append(unfilled, pos)
			}
		}
		fillPairedPositions(layout, config, unfilled, newSeedRandom(fmt.Sprintf("%s-stack-unfilled", seed)), tileTypeCount, fmt.Sprintf("%s-stack-unfilled-tiles", seed))
		if findStackHintInternal(layout, config) != nil {
			return layout
		}
	}
	lastLayout := make([]*string, totalCells)
	for attempt := 0; attempt < maxShuffleAttempts; attempt++ {
		layout := make([]*string, totalCells)
		fillPairedPositions(layout, config, GetActivePositions(config), newSeedRandom(fmt.Sprintf("%s-stack-fallback-%d", seed, attempt)), tileTypeCount, fmt.Sprintf("%s-fallback-%d", seed, attempt))
		lastLayout = layout
		if findStackHintInternal(layout, config) != nil {
			return layout
		}
	}
	return lastLayout
}

func calculateHardScore(matchedPairs int, baseScore int64, timeRemainingSeconds int64, totalPairs int, outcome SettlementOutcome) int64 {
	if totalPairs < 1 {
		totalPairs = DifficultyConfigs[DifficultyHard].Pairs
	}
	matched := math.Max(0, float64(matchedPairs))
	base := matched * float64(maxInt64(0, baseScore))
	progress := math.Min(1, matched/float64(totalPairs))
	pressureBonus := math.Round(base * progress * 0.8)
	remaining := math.Max(0, float64(timeRemainingSeconds))
	timeBonus := float64(0)
	if outcome == OutcomeCompleted {
		timeBonus = remaining * 2
	} else if outcome == OutcomeDeadlock {
		timeBonus = math.Floor(remaining * 0.5)
	}
	completionBonus := float64(0)
	if outcome == OutcomeCompleted {
		completionBonus = math.Round(float64(totalPairs) * float64(maxInt64(0, baseScore)) * 0.2)
	}
	deadlockConsolation := float64(0)
	if outcome == OutcomeDeadlock {
		deadlockConsolation = math.Round(base * 0.15)
	}
	return int64(math.Round(math.Max(0, base+pressureBonus+timeBonus+completionBonus+deadlockConsolation)))
}

func findStackHintInternal(board []*string, config DifficultyConfig) *struct {
	Pos1 Position
	Pos2 Position
} {
	positions := []Position{}
	for _, pos := range GetActivePositions(config) {
		if GetTileAt(board, pos, config) != nil {
			positions = append(positions, pos)
		}
	}
	for i := 0; i < len(positions); i++ {
		for j := i + 1; j < len(positions); j++ {
			if CanStackMatch(board, positions[i], positions[j], config) {
				return &struct {
					Pos1 Position
					Pos2 Position
				}{positions[i], positions[j]}
			}
		}
	}
	return nil
}

func fillPairedPositions(layout []*string, config DifficultyConfig, positions []Position, rng *seedRandom, tileTypeCount int, stageSalt string) {
	shuffledPositions := shufflePositions(positions, rng)
	tileIDs := shuffleStrings(TileIDs[:tileTypeCount], newSeedRandom(stageSalt))
	for i := 0; i+1 < len(shuffledPositions); i += 2 {
		tile := tileIDs[(i/2)%len(tileIDs)]
		assignTile(layout, config, shuffledPositions[i], tile)
		assignTile(layout, config, shuffledPositions[i+1], tile)
	}
}

func assignTile(layout []*string, config DifficultyConfig, pos Position, tile string) {
	layout[IndexOfPosition(pos, config)] = stringPtr(tile)
}

func getTile(board []*string, pos Position, cols int, rows int) *string {
	index := IndexOf(pos, cols, rows)
	if index < 0 || index >= len(board) {
		return nil
	}
	return board[index]
}

func isEmptyInPaddedGrid(board []*string, rows int, cols int, pr int, pc int, startPr int, startPc int, endPr int, endPc int) bool {
	if pr < 0 || pr > rows+1 || pc < 0 || pc > cols+1 {
		return false
	}
	if pr == 0 || pr == rows+1 || pc == 0 || pc == cols+1 {
		return true
	}
	if (pr == startPr && pc == startPc) || (pr == endPr && pc == endPc) {
		return true
	}
	origRow, origCol := pr-1, pc-1
	return board[origRow*cols+origCol] == nil
}

func isSegmentClearPadded(board []*string, rows int, cols int, r1 int, c1 int, r2 int, c2 int, startPr int, startPc int, endPr int, endPc int) bool {
	if r1 == r2 {
		minC, maxC := minInt(c1, c2), maxInt(c1, c2)
		for c := minC; c <= maxC; c++ {
			if !isEmptyInPaddedGrid(board, rows, cols, r1, c, startPr, startPc, endPr, endPc) {
				return false
			}
		}
		return true
	}
	if c1 == c2 {
		minR, maxR := minInt(r1, r2), maxInt(r1, r2)
		for r := minR; r <= maxR; r++ {
			if !isEmptyInPaddedGrid(board, rows, cols, r, c1, startPr, startPc, endPr, endPc) {
				return false
			}
		}
		return true
	}
	return false
}

func compactPath(path []Position) []Position {
	if len(path) <= 2 {
		return path
	}
	result := []Position{path[0]}
	for i := 1; i < len(path); i++ {
		prev := result[len(result)-1]
		curr := path[i]
		if prev.Row == curr.Row && prev.Col == curr.Col {
			continue
		}
		if len(result) >= 2 {
			prevPrev := result[len(result)-2]
			if (prevPrev.Row == prev.Row && prev.Row == curr.Row) || (prevPrev.Col == prev.Col && prev.Col == curr.Col) {
				result[len(result)-1] = curr
				continue
			}
		}
		result = append(result, curr)
	}
	return result
}

func paddedToVirtual(pr int, pc int) Position {
	return Position{Row: pr - 1, Col: pc - 1}
}

func getLayer(config DifficultyConfig, z int) *LayerConfig {
	if !IsStack3DConfig(config) {
		if z == 0 {
			layer := LayerConfig{Z: 0, RowStart: 0, ColStart: 0, Rows: config.Rows, Cols: config.Cols}
			return &layer
		}
		return nil
	}
	for index := range config.Layers {
		if config.Layers[index].Z == z {
			return &config.Layers[index]
		}
	}
	return nil
}

func zOf(pos Position) int {
	if pos.Z == nil {
		return defaultZ
	}
	return *pos.Z
}

func samePosition(a Position, b Position) bool {
	return a.Row == b.Row && a.Col == b.Col && zOf(a) == zOf(b)
}

func containsPosition(items []Position, target Position) bool {
	for _, item := range items {
		if samePosition(item, target) {
			return true
		}
	}
	return false
}

func positionKey(pos Position) string {
	return fmt.Sprintf("%d:%d:%d", zOf(pos), pos.Row, pos.Col)
}

func cloneBoard(board []*string) []*string {
	next := make([]*string, len(board))
	for index, tile := range board {
		if tile != nil {
			next[index] = stringPtr(*tile)
		}
	}
	return next
}

func stringPtr(value string) *string {
	copy := value
	return &copy
}

func shuffleStringPtrs(items []*string, rng *seedRandom) []*string {
	result := cloneBoard(items)
	for i := len(result) - 1; i > 0; i-- {
		j := int(math.Floor(rng.Float64() * float64(i+1)))
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func shuffleStrings(items []string, rng *seedRandom) []string {
	result := append([]string(nil), items...)
	for i := len(result) - 1; i > 0; i-- {
		j := int(math.Floor(rng.Float64() * float64(i+1)))
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func shufflePositions(items []Position, rng *seedRandom) []Position {
	result := append([]Position(nil), items...)
	for i := len(result) - 1; i > 0; i-- {
		j := int(math.Floor(rng.Float64() * float64(i+1)))
		result[i], result[j] = result[j], result[i]
	}
	return result
}

func flattenStages(stages [][]Position) []Position {
	var result []Position
	for _, stage := range stages {
		result = append(result, stage...)
	}
	return result
}

func cellsFromMask(rows []string) []LayerCell {
	var cells []LayerCell
	for row, line := range rows {
		for col, char := range line {
			if char == '1' {
				cells = append(cells, LayerCell{Row: row, Col: col})
			}
		}
	}
	return cells
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func minInt64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
