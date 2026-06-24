package match3

import (
	"errors"
	"math"
	"sort"
)

const (
	emptyTile     = -1
	baseTileScore = int64(4)
	maxMoves      = 250
)

var DefaultConfig = Config{Rows: 8, Cols: 8, Types: 6}

func CreateInitialBoard(seed string, config Config) SimulationResult {
	if ok, message := assertConfig(config); !ok {
		return SimulationResult{OK: false, Message: message}
	}
	if seed == "" {
		return SimulationResult{OK: false, Message: "无效的种子"}
	}
	rng := newSeedRandom(seed)
	board := generateInitialBoard(config, rng)
	return SimulationResult{
		OK:         true,
		FinalBoard: board,
		Stats:      Stats{},
	}
}

func SimulateGame(seed string, config Config, moves []Move) SimulationResult {
	if ok, message := assertConfig(config); !ok {
		return SimulationResult{OK: false, Message: message}
	}
	if seed == "" {
		return SimulationResult{OK: false, Message: "无效的种子"}
	}
	if moves == nil {
		return SimulationResult{OK: false, Message: "无效的操作序列"}
	}
	if len(moves) > maxMoves {
		return SimulationResult{OK: false, Message: "操作步数过多"}
	}

	rng := newSeedRandom(seed)
	board := generateInitialBoard(config, rng)
	var score int64
	var totalCascades int64
	var totalTilesCleared int64
	for _, move := range moves {
		applied, err := applyMove(board, config, rng, move)
		if err != nil {
			return SimulationResult{OK: false, Message: err.Error()}
		}
		score += applied.scoreDelta
		totalCascades += applied.cascades
		totalTilesCleared += applied.tilesCleared
	}
	return SimulationResult{
		OK:         true,
		Score:      score,
		FinalBoard: board,
		Stats: Stats{
			MovesApplied: int64(len(moves)),
			Cascades:     totalCascades,
			TilesCleared: totalTilesCleared,
		},
	}
}

func CalculatePointReward(score int64) int64 {
	if score <= 0 {
		return 0
	}
	return score / 10
}

func assertConfig(config Config) (bool, string) {
	if config.Rows < 3 || config.Rows > 12 {
		return false, "无效的行数配置"
	}
	if config.Cols < 3 || config.Cols > 12 {
		return false, "无效的列数配置"
	}
	if config.Types < 4 || config.Types > 10 {
		return false, "无效的方块类型配置"
	}
	return true, ""
}

func generateInitialBoard(config Config, rng *seedRandom) []int {
	board := make([]int, config.Rows*config.Cols)
	for index := range board {
		r := rowOf(index, config)
		c := colOf(index, config)
		tile := randomTile(rng, config.Types)
		for attempt := 0; attempt < 10; attempt++ {
			tile = randomTile(rng, config.Types)
			if c >= 2 && board[index-1] == tile && board[index-2] == tile {
				continue
			}
			if r >= 2 && board[index-config.Cols] == tile && board[index-2*config.Cols] == tile {
				continue
			}
			break
		}
		board[index] = tile
	}
	return board
}

type applyResult struct {
	scoreDelta   int64
	cascades     int64
	tilesCleared int64
}

func applyMove(board []int, config Config, rng *seedRandom, move Move) (applyResult, error) {
	if !areAdjacent(move.From, move.To, config) {
		return applyResult{}, errors.New("只能交换相邻方块")
	}
	a := board[move.From]
	b := board[move.To]
	board[move.From] = b
	board[move.To] = a

	matches := findMatches(board, config)
	if len(matches) == 0 {
		board[move.From] = a
		board[move.To] = b
		return applyResult{}, errors.New("该交换不会产生消除")
	}

	var scoreDelta int64
	var cascades int64
	var tilesCleared int64
	for len(matches) > 0 {
		cascades++
		clearedThis := int64(len(matches))
		tilesCleared += clearedThis
		scoreDelta += scoreForCascade(clearedThis, cascades)
		for _, index := range matches {
			board[index] = emptyTile
		}
		dropAndFill(board, config, rng)
		matches = findMatches(board, config)
	}
	return applyResult{scoreDelta: scoreDelta, cascades: cascades, tilesCleared: tilesCleared}, nil
}

func findMatches(board []int, config Config) []int {
	matches := map[int]bool{}
	for r := 0; r < config.Rows; r++ {
		runStart := 0
		for runStart < config.Cols {
			startIndex := r*config.Cols + runStart
			tile := board[startIndex]
			runEnd := runStart + 1
			for runEnd < config.Cols {
				index := r*config.Cols + runEnd
				if board[index] != tile {
					break
				}
				runEnd++
			}
			if tile != emptyTile && runEnd-runStart >= 3 {
				for c := runStart; c < runEnd; c++ {
					matches[r*config.Cols+c] = true
				}
			}
			runStart = runEnd
		}
	}
	for c := 0; c < config.Cols; c++ {
		runStart := 0
		for runStart < config.Rows {
			startIndex := runStart*config.Cols + c
			tile := board[startIndex]
			runEnd := runStart + 1
			for runEnd < config.Rows {
				index := runEnd*config.Cols + c
				if board[index] != tile {
					break
				}
				runEnd++
			}
			if tile != emptyTile && runEnd-runStart >= 3 {
				for r := runStart; r < runEnd; r++ {
					matches[r*config.Cols+c] = true
				}
			}
			runStart = runEnd
		}
	}
	result := make([]int, 0, len(matches))
	for index := range matches {
		result = append(result, index)
	}
	sort.Ints(result)
	return result
}

func dropAndFill(board []int, config Config, rng *seedRandom) {
	for c := 0; c < config.Cols; c++ {
		newCol := make([]int, 0, config.Rows)
		for r := config.Rows - 1; r >= 0; r-- {
			index := r*config.Cols + c
			if board[index] != emptyTile {
				newCol = append(newCol, board[index])
			}
		}
		for len(newCol) < config.Rows {
			newCol = append(newCol, randomTile(rng, config.Types))
		}
		for r := config.Rows - 1; r >= 0; r-- {
			index := r*config.Cols + c
			board[index] = newCol[config.Rows-1-r]
		}
	}
}

func scoreForCascade(tilesCleared int64, cascadeIndex int64) int64 {
	return tilesCleared * (baseTileScore + maxInt64(0, cascadeIndex-1))
}

func randomTile(rng *seedRandom, types int) int {
	return int(math.Floor(rng.Float64() * float64(types)))
}

func isInside(index int, config Config) bool {
	return index >= 0 && index < config.Rows*config.Cols
}

func rowOf(index int, config Config) int {
	return index / config.Cols
}

func colOf(index int, config Config) int {
	return index % config.Cols
}

func areAdjacent(a int, b int, config Config) bool {
	if !isInside(a, config) || !isInside(b, config) {
		return false
	}
	dr := absInt(rowOf(a, config) - rowOf(b, config))
	dc := absInt(colOf(a, config) - colOf(b, config))
	return (dr == 1 && dc == 0) || (dr == 0 && dc == 1)
}

func absInt(value int) int {
	if value < 0 {
		return -value
	}
	return value
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
