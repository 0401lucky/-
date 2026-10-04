package sudoku

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math"
	"math/rand"
)

const (
	boardSize = 9
	cellCount = boardSize * boardSize
	boxSize   = 3
	maxScore  = int64(5000)
	pointRate = int64(10)
)

var DifficultyConfigs = map[Difficulty]DifficultyConfig{
	DifficultyEasy: {
		ID: DifficultyEasy, Label: "简单", Clues: 41, BaseScore: 800,
		TimeLimitSeconds: 15 * 60, MistakePenalty: 90,
	},
	DifficultyNormal: {
		ID: DifficultyNormal, Label: "普通", Clues: 34, BaseScore: 1400,
		TimeLimitSeconds: 20 * 60, MistakePenalty: 120,
	},
	DifficultyHard: {
		ID: DifficultyHard, Label: "困难", Clues: 28, BaseScore: 2200,
		TimeLimitSeconds: 30 * 60, MistakePenalty: 160,
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

func DifficultyConfigFor(value Difficulty) DifficultyConfig {
	return DifficultyConfigs[NormalizeDifficulty(value)]
}

func DifficultyList() []DifficultyConfig {
	return []DifficultyConfig{
		DifficultyConfigs[DifficultyEasy],
		DifficultyConfigs[DifficultyNormal],
		DifficultyConfigs[DifficultyHard],
	}
}

func CreateInitialState(seed string, difficulty Difficulty) GameState {
	normalized := NormalizeDifficulty(difficulty)
	puzzle, solution := GeneratePuzzle(seed, normalized)
	return GameState{
		Version: Version, Seed: seed, Difficulty: normalized,
		Puzzle: puzzle, Solution: solution, Board: append([]int(nil), puzzle...),
		Notes: makeNotes(), Errors: make([]bool, cellCount), Status: StatusPlaying,
	}
}

func GeneratePuzzle(seed string, difficulty Difficulty) ([]int, []int) {
	config := DifficultyConfigFor(difficulty)
	bestClues := cellCount + 1
	var bestPuzzle, bestSolution []int

	for attempt := 0; attempt < 10; attempt++ {
		rng := rand.New(rand.NewSource(seedNumber(fmt.Sprintf("%s:sudoku:%s:%d", seed, config.ID, attempt))))
		solution := generateSolution(rng)
		puzzle := append([]int(nil), solution...)
		order := rng.Perm(cellCount)
		for _, index := range order {
			if countClues(puzzle) <= config.Clues {
				break
			}
			value := puzzle[index]
			puzzle[index] = 0
			if countSolutions(puzzle, 2) != 1 {
				puzzle[index] = value
			}
		}
		clues := countClues(puzzle)
		if clues < bestClues {
			bestClues = clues
			bestPuzzle = append([]int(nil), puzzle...)
			bestSolution = append([]int(nil), solution...)
		}
		if clues <= config.Clues {
			return puzzle, solution
		}
	}

	return bestPuzzle, bestSolution
}

type ActionResult struct {
	OK      bool
	State   GameState
	Message string
}

func ApplyAction(state GameState, action Action, endedAt int64) ActionResult {
	if state.Status != StatusPlaying {
		return ActionResult{OK: false, Message: "游戏已经结束"}
	}
	if action.Index < 0 || action.Index >= cellCount {
		return ActionResult{OK: false, Message: "格子坐标无效"}
	}
	if len(state.Puzzle) != cellCount || len(state.Solution) != cellCount || len(state.Board) != cellCount {
		return ActionResult{OK: false, Message: "游戏盘面无效"}
	}
	if state.Puzzle[action.Index] != 0 {
		return ActionResult{OK: false, Message: "题目给出的数字不能修改"}
	}

	next := cloneState(state)
	switch action.Type {
	case ActionSet:
		if action.Value < 1 || action.Value > 9 {
			return ActionResult{OK: false, Message: "数字必须在 1 到 9 之间"}
		}
		if next.Board[action.Index] != action.Value {
			next.Moves++
			if action.Value != next.Solution[action.Index] {
				next.Mistakes++
			}
		}
		next.Board[action.Index] = action.Value
		next.Errors[action.Index] = action.Value != next.Solution[action.Index]
		next.Notes[action.Index] = []int{}
	case ActionErase:
		if next.Board[action.Index] != 0 || len(next.Notes[action.Index]) > 0 {
			next.Moves++
		}
		next.Board[action.Index] = 0
		next.Errors[action.Index] = false
		next.Notes[action.Index] = []int{}
	case ActionNote:
		if action.Value < 1 || action.Value > 9 {
			return ActionResult{OK: false, Message: "笔记数字必须在 1 到 9 之间"}
		}
		if next.Board[action.Index] != 0 {
			return ActionResult{OK: false, Message: "已有数字的格子不能添加笔记"}
		}
		next.Moves++
		next.Notes[action.Index] = toggleNote(next.Notes[action.Index], action.Value)
	default:
		return ActionResult{OK: false, Message: "未知操作"}
	}

	if isSolved(next.Board, next.Solution) {
		next.Status = StatusWon
		if endedAt > 0 {
			next.EndedAt = &endedAt
		}
	}
	return ActionResult{OK: true, State: next}
}

func BuildStateView(state GameState) StateView {
	cells := make([]CellView, cellCount)
	for index := 0; index < cellCount; index++ {
		value := 0
		if index < len(state.Board) {
			value = state.Board[index]
		}
		notes := []int{}
		if index < len(state.Notes) {
			notes = append(notes, state.Notes[index]...)
		}
		given := index < len(state.Puzzle) && state.Puzzle[index] != 0
		cells[index] = CellView{
			Index: index, Value: value, Given: given, Notes: notes,
			Error:    index < len(state.Errors) && state.Errors[index],
			Conflict: hasConflict(state.Board, index),
		}
	}
	return StateView{
		Difficulty: state.Difficulty,
		Cells:      cells,
		Status:     state.Status,
		Moves:      state.Moves,
		Mistakes:   state.Mistakes,
		EndedAt:    cloneInt64Ptr(state.EndedAt),
	}
}

func CalculateScore(state GameState, durationMs int64) ScoreBreakdown {
	config := DifficultyConfigFor(state.Difficulty)
	if state.Status != StatusWon {
		return ScoreBreakdown{}
	}
	usedSeconds := int64(math.Ceil(float64(maxInt64(0, durationMs)) / 1000))
	timeMultiplier := int64(2)
	if state.Difficulty == DifficultyNormal {
		timeMultiplier = 3
	} else if state.Difficulty == DifficultyHard {
		timeMultiplier = 4
	}
	timeBonus := maxInt64(0, config.TimeLimitSeconds-usedSeconds) * timeMultiplier
	mistakePenalty := int64(state.Mistakes) * config.MistakePenalty
	perfectBonus := int64(0)
	if state.Mistakes == 0 {
		perfectBonus = config.BaseScore / 4
	}
	total := config.BaseScore + timeBonus + perfectBonus - mistakePenalty
	if total < 0 {
		total = 0
	}
	if total > maxScore {
		total = maxScore
	}
	return ScoreBreakdown{
		DifficultyBase: config.BaseScore,
		TimeBonus:      timeBonus,
		MistakePenalty: mistakePenalty,
		PerfectBonus:   perfectBonus,
		Total:          total,
	}
}

func CalculatePointReward(score int64) int64 {
	if score <= 0 {
		return 0
	}
	return score * pointRate / 100
}

func BuildSessionView(session Session, nowMs int64) SessionView {
	view := SessionView{
		SessionID:  session.ID,
		Difficulty: session.Difficulty,
		StartedAt:  session.StartedAt,
		ExpiresAt:  session.ExpiresAt,
		State:      BuildStateView(session.State),
	}
	if session.State.Status != StatusPlaying {
		duration := sessionDuration(session, nowMs)
		score := CalculateScore(session.State, duration)
		reward := CalculatePointReward(score.Total)
		view.ScorePreview = &score
		view.PointRewardPreview = &reward
	}
	return view
}

func sessionDuration(session Session, nowMs int64) int64 {
	endAt := nowMs
	if session.State.EndedAt != nil {
		endAt = *session.State.EndedAt
	}
	return maxInt64(0, endAt-session.StartedAt)
}

func generateSolution(rng *rand.Rand) []int {
	base := [boardSize][boardSize]int{}
	for row := 0; row < boardSize; row++ {
		for col := 0; col < boardSize; col++ {
			base[row][col] = (row*3 + row/3 + col) % boardSize
		}
	}
	digits := rng.Perm(boardSize)
	rows := shuffledBands(rng)
	cols := shuffledBands(rng)
	solution := make([]int, cellCount)
	for row := 0; row < boardSize; row++ {
		for col := 0; col < boardSize; col++ {
			value := base[rows[row]][cols[col]]
			solution[row*boardSize+col] = digits[value] + 1
		}
	}
	return solution
}

func shuffledBands(rng *rand.Rand) []int {
	bands := rng.Perm(3)
	result := make([]int, 0, boardSize)
	for _, band := range bands {
		within := rng.Perm(3)
		for _, offset := range within {
			result = append(result, band*3+offset)
		}
	}
	return result
}

func countSolutions(board []int, limit int) int {
	if len(board) != cellCount {
		return 0
	}
	copyBoard := append([]int(nil), board...)
	return countSolutionsInto(copyBoard, limit)
}

func countSolutionsInto(board []int, limit int) int {
	index, candidates := bestEmptyCell(board)
	if index < 0 {
		return 1
	}
	count := 0
	for _, value := range candidates {
		board[index] = value
		count += countSolutionsInto(board, limit-count)
		board[index] = 0
		if count >= limit {
			return count
		}
	}
	return count
}

func bestEmptyCell(board []int) (int, []int) {
	bestIndex := -1
	var bestCandidates []int
	for index, value := range board {
		if value != 0 {
			continue
		}
		candidates := candidatesFor(board, index)
		if len(candidates) == 0 {
			return index, nil
		}
		if bestIndex < 0 || len(candidates) < len(bestCandidates) {
			bestIndex = index
			bestCandidates = candidates
			if len(bestCandidates) == 1 {
				break
			}
		}
	}
	return bestIndex, bestCandidates
}

func candidatesFor(board []int, index int) []int {
	used := [10]bool{}
	row, col := index/boardSize, index%boardSize
	for current := 0; current < boardSize; current++ {
		used[board[row*boardSize+current]] = true
		used[board[current*boardSize+col]] = true
	}
	boxRow, boxCol := row/boxSize*boxSize, col/boxSize*boxSize
	for r := boxRow; r < boxRow+boxSize; r++ {
		for c := boxCol; c < boxCol+boxSize; c++ {
			used[board[r*boardSize+c]] = true
		}
	}
	values := make([]int, 0, boardSize)
	for value := 1; value <= boardSize; value++ {
		if !used[value] {
			values = append(values, value)
		}
	}
	return values
}

func isSolved(board, solution []int) bool {
	if len(board) != cellCount || len(solution) != cellCount {
		return false
	}
	for index := range board {
		if board[index] != solution[index] {
			return false
		}
	}
	return true
}

func hasConflict(board []int, index int) bool {
	if index < 0 || index >= len(board) || board[index] == 0 {
		return false
	}
	value := board[index]
	row, col := index/boardSize, index%boardSize
	for current := 0; current < boardSize; current++ {
		if current != col && board[row*boardSize+current] == value {
			return true
		}
		if current != row && board[current*boardSize+col] == value {
			return true
		}
	}
	boxRow, boxCol := row/boxSize*boxSize, col/boxSize*boxSize
	for r := boxRow; r < boxRow+boxSize; r++ {
		for c := boxCol; c < boxCol+boxSize; c++ {
			other := r*boardSize + c
			if other != index && board[other] == value {
				return true
			}
		}
	}
	return false
}

func cloneState(state GameState) GameState {
	next := state
	next.Puzzle = append([]int(nil), state.Puzzle...)
	next.Solution = append([]int(nil), state.Solution...)
	next.Board = append([]int(nil), state.Board...)
	next.Notes = make([][]int, len(state.Notes))
	for index := range state.Notes {
		next.Notes[index] = append([]int(nil), state.Notes[index]...)
	}
	next.Errors = append([]bool(nil), state.Errors...)
	next.EndedAt = cloneInt64Ptr(state.EndedAt)
	return next
}

func makeNotes() [][]int {
	return make([][]int, cellCount)
}

func toggleNote(notes []int, value int) []int {
	result := append([]int(nil), notes...)
	for index, current := range result {
		if current == value {
			return append(result[:index], result[index+1:]...)
		}
	}
	result = append(result, value)
	for index := len(result) - 1; index > 0 && result[index] < result[index-1]; index-- {
		result[index], result[index-1] = result[index-1], result[index]
	}
	return result
}

func countClues(board []int) int {
	count := 0
	for _, value := range board {
		if value != 0 {
			count++
		}
	}
	return count
}

func seedNumber(seed string) int64 {
	digest := sha256.Sum256([]byte(seed))
	return int64(binary.LittleEndian.Uint64(digest[:8]))
}

func cloneInt64Ptr(value *int64) *int64 {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
