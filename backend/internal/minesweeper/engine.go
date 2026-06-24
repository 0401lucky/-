package minesweeper

import (
	"fmt"
	"math"
	"sort"
)

const pointRewardPercent = int64(10)

var DifficultyConfigs = map[Difficulty]DifficultyConfig{
	DifficultyEasy: {
		ID: DifficultyEasy, Label: "简单", Rows: 9, Cols: 9, Mines: 10,
		BaseScore: 500, TimeLimitSeconds: 180,
	},
	DifficultyNormal: {
		ID: DifficultyNormal, Label: "普通", Rows: 12, Cols: 12, Mines: 24,
		BaseScore: 1000, TimeLimitSeconds: 300,
	},
	DifficultyHard: {
		ID: DifficultyHard, Label: "困难", Rows: 16, Cols: 16, Mines: 40,
		BaseScore: 1800, TimeLimitSeconds: 480,
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

func DifficultyList() []DifficultyConfig {
	return []DifficultyConfig{
		DifficultyConfigs[DifficultyEasy],
		DifficultyConfigs[DifficultyNormal],
		DifficultyConfigs[DifficultyHard],
	}
}

func PositionKey(position Position) string {
	return fmt.Sprintf("%d:%d", position.Row, position.Col)
}

func CreateInitialState(seed string, difficulty Difficulty) GameState {
	normalized := NormalizeDifficulty(difficulty)
	config := DifficultyConfigFor(normalized)
	return GameState{
		Version:         Version,
		Seed:            seed,
		Difficulty:      normalized,
		Rows:            config.Rows,
		Cols:            config.Cols,
		Mines:           config.Mines,
		Status:          StatusPlaying,
		FirstRevealDone: false,
		Cells:           createEmptyCells(config.Rows, config.Cols),
		RevealedSafe:    0,
		FlagsUsed:       0,
		Moves:           0,
	}
}

func GenerateMinePositions(seed string, difficulty Difficulty, firstReveal Position) []Position {
	normalized := NormalizeDifficulty(difficulty)
	config := DifficultyConfigFor(normalized)
	safe := map[string]bool{PositionKey(firstReveal): true}
	for _, neighbor := range neighborsOf(config.Rows, config.Cols, firstReveal) {
		safe[PositionKey(neighbor)] = true
	}

	candidates := make([]Position, 0, config.Rows*config.Cols)
	for row := 0; row < config.Rows; row++ {
		for col := 0; col < config.Cols; col++ {
			position := Position{Row: row, Col: col}
			if !safe[PositionKey(position)] {
				candidates = append(candidates, position)
			}
		}
	}
	shufflePositions(candidates, fmt.Sprintf("%s:minesweeper:%s:%s", seed, normalized, PositionKey(firstReveal)))
	mines := append([]Position(nil), candidates[:config.Mines]...)
	sort.Slice(mines, func(i, j int) bool {
		if mines[i].Row == mines[j].Row {
			return mines[i].Col < mines[j].Col
		}
		return mines[i].Row < mines[j].Row
	})
	return mines
}

func ResolveAction(state GameState, action Action) ActionResult {
	if state.Status != StatusPlaying {
		return ActionResult{OK: false, Message: "游戏已经结束"}
	}

	next := cloneState(state)
	switch action.Type {
	case ActionReveal:
		return resolveReveal(&next, action.Position)
	case ActionFlag:
		return resolveFlag(&next, action.Position)
	case ActionChord:
		return resolveChord(&next, action.Position)
	default:
		return ActionResult{OK: false, Message: "未知操作"}
	}
}

func ResolveActions(state GameState, actions []Action) ActionBatchResult {
	next := cloneState(state)
	applied := make([]Action, 0, len(actions))
	outcomes := make([]ActionOutcome, 0, len(actions))
	skipped := 0

	for _, action := range actions {
		if next.Status != StatusPlaying {
			skipped++
			continue
		}
		resolved := ResolveAction(next, action)
		if !resolved.OK {
			if isSkippableBatchActionFailure(resolved.Message) {
				skipped++
				continue
			}
			return ActionBatchResult{OK: false, Message: resolved.Message}
		}
		next = resolved.State
		applied = append(applied, action)
		outcomes = append(outcomes, resolved.Outcome)
	}

	return ActionBatchResult{
		OK:             true,
		State:          next,
		AppliedActions: applied,
		Outcomes:       outcomes,
		Skipped:        skipped,
	}
}

func BuildStateView(state GameState) StateView {
	revealMines := state.Status != StatusPlaying
	cells := make([]CellView, 0, len(state.Cells))
	for _, cell := range state.Cells {
		display := DisplayHidden
		if state.Exploded != nil && state.Exploded.Row == cell.Row && state.Exploded.Col == cell.Col {
			display = DisplayExploded
		} else if cell.Revealed {
			if cell.Mine {
				display = DisplayMine
			} else {
				display = DisplayRevealed
			}
		} else if cell.Flagged {
			display = DisplayFlagged
		} else if revealMines && cell.Mine {
			display = DisplayMine
		}
		adjacent := 0
		if cell.Revealed || revealMines {
			adjacent = cell.Adjacent
		}
		cells = append(cells, CellView{
			Row: cell.Row, Col: cell.Col, Display: display, Adjacent: adjacent,
		})
	}
	return StateView{
		Difficulty: state.Difficulty,
		Rows:       state.Rows, Cols: state.Cols, Mines: state.Mines,
		Status: state.Status, Cells: cells,
		RevealedSafe: state.RevealedSafe,
		FlagsUsed:    state.FlagsUsed,
		Moves:        state.Moves,
		Exploded:     clonePositionPtr(state.Exploded),
		EndedAt:      cloneInt64Ptr(state.EndedAt),
	}
}

func CalculateScore(state GameState, durationMs int64) ScoreBreakdown {
	config := DifficultyConfigFor(state.Difficulty)
	safeCells := state.Rows*state.Cols - state.Mines
	revealRatio := 0.0
	if safeCells > 0 {
		revealRatio = float64(state.RevealedSafe) / float64(safeCells)
	}
	difficultyBase := int64(math.Round(float64(config.BaseScore) * revealRatio))
	revealMultiplier := int64(4)
	if state.Difficulty == DifficultyNormal {
		revealMultiplier = 6
	} else if state.Difficulty == DifficultyHard {
		revealMultiplier = 8
	}
	revealPoints := int64(state.RevealedSafe) * revealMultiplier
	flagPoints := int64(0)
	if state.Status == StatusWon {
		flagPoints = int64(state.Mines) * 6
	} else {
		for _, cell := range state.Cells {
			if cell.Flagged && cell.Mine {
				flagPoints += 3
			}
		}
	}
	usedSeconds := int64(math.Max(0, math.Ceil(float64(durationMs)/1000)))
	timeBonus := int64(0)
	if state.Status == StatusWon {
		timeMultiplier := int64(2)
		if state.Difficulty == DifficultyNormal {
			timeMultiplier = 3
		} else if state.Difficulty == DifficultyHard {
			timeMultiplier = 4
		}
		timeBonus = maxInt64(0, config.TimeLimitSeconds-usedSeconds) * timeMultiplier
	}
	winBonus := int64(0)
	if state.Status == StatusWon {
		winBonus = int64(math.Round(float64(config.BaseScore) * 0.35))
	}
	total := maxInt64(0, minInt64(5000, difficultyBase+revealPoints+flagPoints+timeBonus+winBonus))
	return ScoreBreakdown{
		DifficultyBase: difficultyBase,
		RevealPoints:   revealPoints,
		FlagPoints:     flagPoints,
		TimeBonus:      timeBonus,
		WinBonus:       winBonus,
		Total:          total,
	}
}

func CalculatePointReward(score int64) int64 {
	if score <= 0 {
		return 0
	}
	return score * pointRewardPercent / 100
}

func BuildSessionView(session Session, nowMs int64) SessionView {
	var scorePreview *ScoreBreakdown
	var pointRewardPreview *int64
	if session.State.Status != StatusPlaying {
		score := CalculateScore(session.State, sessionDuration(session, nowMs))
		reward := CalculatePointReward(score.Total)
		scorePreview = &score
		pointRewardPreview = &reward
	}
	return SessionView{
		SessionID:          session.ID,
		Difficulty:         session.Difficulty,
		StartedAt:          session.StartedAt,
		ExpiresAt:          session.ExpiresAt,
		ActionsCount:       len(session.Actions),
		State:              BuildStateView(session.State),
		ScorePreview:       scorePreview,
		PointRewardPreview: pointRewardPreview,
	}
}

func sessionDuration(session Session, nowMs int64) int64 {
	endAt := nowMs
	if session.State.Status != StatusPlaying && session.State.EndedAt != nil {
		endAt = *session.State.EndedAt
	}
	return maxInt64(0, endAt-session.StartedAt)
}

func resolveReveal(state *GameState, position Position) ActionResult {
	cell := getCell(state, position)
	if cell == nil {
		return ActionResult{OK: false, Message: "格子坐标无效"}
	}
	if cell.Flagged {
		return ActionResult{OK: false, Message: "已插旗的格子不能翻开"}
	}
	if cell.Revealed {
		return ActionResult{OK: false, Message: "这个格子已经翻开了"}
	}
	if !state.FirstRevealDone {
		layMines(state, position)
		cell = getCell(state, position)
	}

	state.Moves++
	if cell.Mine {
		cell.Revealed = true
		state.Status = StatusLost
		state.Exploded = &Position{Row: cell.Row, Col: cell.Col}
		return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
			Type: ActionReveal, Message: "踩到雷了，本局结束", Status: state.Status,
		}}
	}

	revealedDelta := floodReveal(state, cell)
	checkWin(state)
	message := fmt.Sprintf("翻开 %d 个安全格", revealedDelta)
	if state.Status == StatusWon {
		message = "所有安全格都已清除，扫雷成功！"
	}
	return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
		Type: ActionReveal, Message: message, RevealedDelta: revealedDelta, Status: state.Status,
	}}
}

func resolveFlag(state *GameState, position Position) ActionResult {
	cell := getCell(state, position)
	if cell == nil {
		return ActionResult{OK: false, Message: "格子坐标无效"}
	}
	if cell.Revealed {
		return ActionResult{OK: false, Message: "已翻开的格子不能插旗"}
	}
	if cell.Flagged {
		cell.Flagged = false
		state.FlagsUsed--
		state.Moves++
		return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
			Type: ActionFlag, Message: "已移除旗帜", FlagDelta: -1, Status: state.Status,
		}}
	}
	if state.FlagsUsed >= state.Mines {
		return ActionResult{OK: false, Message: "旗帜数量已达到雷数上限"}
	}
	cell.Flagged = true
	state.FlagsUsed++
	state.Moves++
	return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
		Type: ActionFlag, Message: "已标记疑似地雷", FlagDelta: 1, Status: state.Status,
	}}
}

func resolveChord(state *GameState, position Position) ActionResult {
	cell := getCell(state, position)
	if cell == nil {
		return ActionResult{OK: false, Message: "格子坐标无效"}
	}
	if !cell.Revealed || cell.Adjacent <= 0 {
		return ActionResult{OK: false, Message: "只有已翻开的数字格可以快速展开"}
	}
	neighbors := neighborCells(state, position)
	flags := 0
	for _, neighbor := range neighbors {
		if neighbor.Flagged {
			flags++
		}
	}
	if flags != cell.Adjacent {
		return ActionResult{OK: false, Message: "周围旗帜数量与数字不一致"}
	}

	totalRevealed := 0
	state.Moves++
	for _, neighborPosition := range neighborsOf(state.Rows, state.Cols, position) {
		neighbor := getCell(state, neighborPosition)
		if neighbor == nil || neighbor.Revealed || neighbor.Flagged {
			continue
		}
		if neighbor.Mine {
			neighbor.Revealed = true
			state.Status = StatusLost
			state.Exploded = &Position{Row: neighbor.Row, Col: neighbor.Col}
			return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
				Type: ActionChord, Message: "快速展开时踩到雷了", RevealedDelta: totalRevealed, Status: state.Status,
			}}
		}
		totalRevealed += floodReveal(state, neighbor)
	}
	checkWin(state)
	message := fmt.Sprintf("快速展开 %d 个安全格", totalRevealed)
	if state.Status == StatusWon {
		message = "所有安全格都已清除，扫雷成功！"
	}
	return ActionResult{OK: true, State: *state, Outcome: ActionOutcome{
		Type: ActionChord, Message: message, RevealedDelta: totalRevealed, Status: state.Status,
	}}
}

func layMines(state *GameState, firstReveal Position) {
	mineKeys := map[string]bool{}
	for _, position := range GenerateMinePositions(state.Seed, state.Difficulty, firstReveal) {
		mineKeys[PositionKey(position)] = true
	}
	for index := range state.Cells {
		cell := &state.Cells[index]
		cell.Mine = mineKeys[PositionKey(Position{Row: cell.Row, Col: cell.Col})]
		cell.Adjacent = 0
	}
	for index := range state.Cells {
		cell := &state.Cells[index]
		if cell.Mine {
			continue
		}
		count := 0
		for _, neighbor := range neighborsOf(state.Rows, state.Cols, Position{Row: cell.Row, Col: cell.Col}) {
			if other := getCell(state, neighbor); other != nil && other.Mine {
				count++
			}
		}
		cell.Adjacent = count
	}
	state.FirstRevealDone = true
	state.FirstReveal = &Position{Row: firstReveal.Row, Col: firstReveal.Col}
}

func floodReveal(state *GameState, start *Cell) int {
	queue := []Position{{Row: start.Row, Col: start.Col}}
	seen := map[string]bool{}
	revealed := 0
	for len(queue) > 0 {
		currentPosition := queue[0]
		queue = queue[1:]
		key := PositionKey(currentPosition)
		if seen[key] {
			continue
		}
		seen[key] = true
		current := getCell(state, currentPosition)
		if current == nil {
			continue
		}
		delta := revealSafeCell(state, current)
		revealed += delta
		if delta == 0 || current.Adjacent != 0 {
			continue
		}
		for _, neighborPosition := range neighborsOf(state.Rows, state.Cols, currentPosition) {
			neighbor := getCell(state, neighborPosition)
			if neighbor != nil && !neighbor.Mine && !neighbor.Revealed && !neighbor.Flagged {
				queue = append(queue, neighborPosition)
			}
		}
	}
	return revealed
}

func revealSafeCell(state *GameState, cell *Cell) int {
	if cell.Revealed || cell.Flagged || cell.Mine {
		return 0
	}
	cell.Revealed = true
	state.RevealedSafe++
	return 1
}

func checkWin(state *GameState) {
	safeCells := state.Rows*state.Cols - state.Mines
	if state.RevealedSafe < safeCells {
		return
	}
	state.Status = StatusWon
	for index := range state.Cells {
		if state.Cells[index].Mine && !state.Cells[index].Flagged {
			state.Cells[index].Flagged = true
		}
	}
	state.FlagsUsed = 0
	for _, cell := range state.Cells {
		if cell.Flagged {
			state.FlagsUsed++
		}
	}
}

func createEmptyCells(rows int, cols int) []Cell {
	cells := make([]Cell, 0, rows*cols)
	for row := 0; row < rows; row++ {
		for col := 0; col < cols; col++ {
			cells = append(cells, Cell{Row: row, Col: col})
		}
	}
	return cells
}

func cloneState(state GameState) GameState {
	next := state
	next.FirstReveal = clonePositionPtr(state.FirstReveal)
	next.Exploded = clonePositionPtr(state.Exploded)
	next.EndedAt = cloneInt64Ptr(state.EndedAt)
	next.Cells = append([]Cell(nil), state.Cells...)
	return next
}

func clonePositionPtr(position *Position) *Position {
	if position == nil {
		return nil
	}
	return &Position{Row: position.Row, Col: position.Col}
}

func cloneInt64Ptr(value *int64) *int64 {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func getCell(state *GameState, position Position) *Cell {
	if !isValidPosition(state.Rows, state.Cols, position) {
		return nil
	}
	return &state.Cells[position.Row*state.Cols+position.Col]
}

func neighborCells(state *GameState, position Position) []*Cell {
	cells := make([]*Cell, 0, 8)
	for _, neighbor := range neighborsOf(state.Rows, state.Cols, position) {
		if cell := getCell(state, neighbor); cell != nil {
			cells = append(cells, cell)
		}
	}
	return cells
}

func neighborsOf(rows int, cols int, position Position) []Position {
	neighbors := make([]Position, 0, 8)
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if dr == 0 && dc == 0 {
				continue
			}
			next := Position{Row: position.Row + dr, Col: position.Col + dc}
			if isValidPosition(rows, cols, next) {
				neighbors = append(neighbors, next)
			}
		}
	}
	return neighbors
}

func isValidPosition(rows int, cols int, position Position) bool {
	return position.Row >= 0 && position.Row < rows && position.Col >= 0 && position.Col < cols
}

func shufflePositions(items []Position, seed string) {
	rng := newSeedRandom(seed)
	for index := len(items) - 1; index > 0; index-- {
		swapIndex := int(math.Floor(rng.Float64() * float64(index+1)))
		items[index], items[swapIndex] = items[swapIndex], items[index]
	}
}

func isSkippableBatchActionFailure(message string) bool {
	switch message {
	case "游戏已经结束",
		"已插旗的格子不能翻开",
		"这个格子已经翻开了",
		"已翻开的格子不能插旗",
		"只有已翻开的数字格可以快速展开",
		"周围旗帜数量与数字不一致":
		return true
	default:
		return false
	}
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
