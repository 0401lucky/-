package whackmole

import (
	"fmt"
	"math"
	"sort"
)

const (
	BoardSize          = 4
	HoleCount          = BoardSize * BoardSize
	MaxEvents          = 420
	MaxEventsPerSecond = 16
)

var DifficultyConfigs = map[Difficulty]DifficultyConfig{
	DifficultyEasy: {
		Label: "简单", ShortLabel: "轻松", Description: "节奏更慢、炸弹更少，适合热身和手机小屏游玩。",
		DurationMs: 45_000, StartRefreshMs: 1400, EndRefreshMs: 760,
		MinBombs: 0, MaxBombs: 2, NormalPoints: 10, GoldenPoints: 30, BombPenalty: 20,
		ComboBonusStep: 1, MaxComboBonus: 18, WinScore: 800, RewardDivisor: 12,
		ActiveTargetBase: 1, ActiveTargetGrowthSeconds: 20, ActiveTargetMax: 4,
		ExtraTargetThreshold: 0.82, GoldenThreshold: 0.88,
	},
	DifficultyNormal: {
		Label: "普通", ShortLabel: "标准", Description: "当前标准规则，速度和奖励最均衡。",
		DurationMs: 60_000, StartRefreshMs: 1250, EndRefreshMs: 560,
		MinBombs: 0, MaxBombs: 4, NormalPoints: 10, GoldenPoints: 35, BombPenalty: 25,
		ComboBonusStep: 2, MaxComboBonus: 30, WinScore: 1200, RewardDivisor: 10,
		ActiveTargetBase: 2, ActiveTargetGrowthSeconds: 18, ActiveTargetMax: 5,
		ExtraTargetThreshold: 0.78, GoldenThreshold: 0.86,
	},
	DifficultyHard: {
		Label: "困难", ShortLabel: "高压", Description: "刷新更快、炸弹更多，连击和积分收益也更高。",
		DurationMs: 60_000, StartRefreshMs: 980, EndRefreshMs: 420,
		MinBombs: 0, MaxBombs: 6, NormalPoints: 12, GoldenPoints: 45, BombPenalty: 35,
		ComboBonusStep: 3, MaxComboBonus: 45, WinScore: 1500, RewardDivisor: 8,
		ActiveTargetBase: 2, ActiveTargetGrowthSeconds: 14, ActiveTargetMax: 6,
		ExtraTargetThreshold: 0.68, GoldenThreshold: 0.82,
	},
}

func NormalizeDifficulty(value Difficulty) Difficulty {
	if _, ok := DifficultyConfigs[value]; ok {
		return value
	}
	return DifficultyNormal
}

func DifficultyConfigFor(difficulty Difficulty) DifficultyConfig {
	return DifficultyConfigs[NormalizeDifficulty(difficulty)]
}

func EmptyBoard() []Cell {
	board := make([]Cell, HoleCount)
	for index := range board {
		board[index] = CellEmpty
	}
	return board
}

func GetRefreshMs(elapsedMs int64, difficulty Difficulty) int64 {
	config := DifficultyConfigFor(difficulty)
	progress := clampProgress(elapsedMs, config)
	return int64(math.Round(float64(config.StartRefreshMs) + float64(config.EndRefreshMs-config.StartRefreshMs)*progress))
}

func GetTickIndex(elapsedMs int64, difficulty Difficulty) int64 {
	config := DifficultyConfigFor(difficulty)
	targetMs := minInt64(maxInt64(0, elapsedMs), config.DurationMs-1)
	cursorMs := int64(0)
	tickIndex := int64(0)
	for cursorMs+GetRefreshMs(cursorMs, difficulty) <= targetMs {
		cursorMs += GetRefreshMs(cursorMs, difficulty)
		tickIndex++
	}
	return tickIndex
}

func GetBombCount(elapsedMs int64, difficulty Difficulty) int64 {
	config := DifficultyConfigFor(difficulty)
	progress := clampProgress(elapsedMs, config)
	count := int64(math.Floor(float64(config.MinBombs) + float64(config.MaxBombs+1-config.MinBombs)*progress))
	return minInt64(config.MaxBombs, count)
}

func GetBoard(seed string, elapsedMs int64, difficulty Difficulty) []Cell {
	config := DifficultyConfigFor(difficulty)
	tickIndex := GetTickIndex(elapsedMs, difficulty)
	rng := newSeedRandom(fmt.Sprintf("%s:board:%d", seed, tickIndex))
	elapsedSeconds := math.Min(float64(config.DurationMs)/1000, math.Max(0, float64(elapsedMs)/1000))
	board := EmptyBoard()
	indexes := shuffleIndexes(seed, tickIndex)
	activeCount := minInt64(
		config.ActiveTargetMax,
		config.ActiveTargetBase+
			int64(math.Floor(elapsedSeconds/float64(config.ActiveTargetGrowthSeconds)))+
			boolInt64(rng.Float64() > config.ExtraTargetThreshold),
	)

	for index := int64(0); index < activeCount; index++ {
		cell := CellMole
		if rng.Float64() > config.GoldenThreshold {
			cell = CellGolden
		}
		board[indexes[index]] = cell
	}

	bombCount := minInt64(int64(HoleCount)-activeCount, GetBombCount(elapsedMs, difficulty))
	for index := int64(0); index < bombCount; index++ {
		boardIndex := indexes[activeCount+index]
		board[boardIndex] = CellBomb
	}
	return board
}

func ScoreDelta(cell Cell, comboBefore int64, difficulty Difficulty) int64 {
	config := DifficultyConfigFor(difficulty)
	if cell == CellBomb {
		return -config.BombPenalty
	}
	if cell != CellMole && cell != CellGolden {
		return 0
	}
	nextCombo := comboBefore + 1
	comboBonus := minInt64(config.MaxComboBonus, maxInt64(0, nextCombo-1)*config.ComboBonusStep)
	base := config.NormalPoints
	if cell == CellGolden {
		base = config.GoldenPoints
	}
	return base + comboBonus
}

func ScoreEvents(seed string, rawEvents []HitEvent, difficulty Difficulty) ScoreResult {
	events := append([]HitEvent(nil), rawEvents...)
	sort.Slice(events, func(i, j int) bool {
		return events[i].ElapsedMs < events[j].ElapsedMs
	})

	score := int64(0)
	combo := int64(0)
	consumedTargets := map[string]bool{}
	scoredEvents := make([]ScoredEvent, 0, len(events))
	stats := ScoreStats{}

	for _, event := range events {
		tickIndex := GetTickIndex(event.ElapsedMs, difficulty)
		targetKey := fmt.Sprintf("%d:%d", tickIndex, event.Index)
		board := GetBoard(seed, event.ElapsedMs, difficulty)
		cell := CellEmpty
		if event.Index >= 0 && event.Index < len(board) {
			cell = board[event.Index]
		}

		if (cell == CellMole || cell == CellGolden) && !consumedTargets[targetKey] {
			delta := ScoreDelta(cell, combo, difficulty)
			combo++
			score += delta
			stats.Hits++
			stats.MaxCombo = maxInt64(stats.MaxCombo, combo)
			if cell == CellGolden {
				stats.GoldenHits++
			}
			consumedTargets[targetKey] = true
			result := HitResultHit
			if cell == CellGolden {
				result = HitResultGoldenHit
			}
			scoredEvents = append(scoredEvents, scoredEvent(event, tickIndex, cell, result, delta, combo))
			continue
		}

		if (cell == CellMole || cell == CellGolden) && consumedTargets[targetKey] {
			combo = 0
			stats.Misses++
			scoredEvents = append(scoredEvents, scoredEvent(event, tickIndex, cell, HitResultDuplicate, 0, combo))
			continue
		}

		if cell == CellBomb {
			nextScore := maxInt64(0, score-DifficultyConfigFor(difficulty).BombPenalty)
			delta := nextScore - score
			score = nextScore
			combo = 0
			stats.Bombs++
			scoredEvents = append(scoredEvents, scoredEvent(event, tickIndex, cell, HitResultBomb, delta, combo))
			continue
		}

		combo = 0
		stats.Misses++
		scoredEvents = append(scoredEvents, scoredEvent(event, tickIndex, cell, HitResultMiss, 0, combo))
	}

	return ScoreResult{Score: score, Combo: combo, Stats: stats, Events: scoredEvents}
}

func CalculatePointReward(score int64, difficulty Difficulty) int64 {
	if score <= 0 {
		return 0
	}
	return score / DifficultyConfigFor(difficulty).RewardDivisor
}

func NormalizeEvents(events []HitEvent, difficulty Difficulty) []HitEvent {
	config := DifficultyConfigFor(difficulty)
	normalized := make([]HitEvent, 0, len(events))
	for _, event := range events {
		if event.Index < 0 || event.Index >= HoleCount {
			continue
		}
		if event.ElapsedMs < 0 || event.ElapsedMs >= config.DurationMs {
			continue
		}
		normalized = append(normalized, HitEvent{Index: event.Index, ElapsedMs: event.ElapsedMs})
	}
	sort.Slice(normalized, func(i, j int) bool {
		return normalized[i].ElapsedMs < normalized[j].ElapsedMs
	})
	return normalized
}

func ValidateEventsRate(events []HitEvent) (bool, string) {
	if len(events) > MaxEvents {
		return false, "敲击次数异常"
	}
	buckets := map[int64]int{}
	for _, event := range events {
		second := event.ElapsedMs / 1000
		buckets[second]++
		if buckets[second] > MaxEventsPerSecond {
			return false, "敲击频率异常"
		}
	}
	return true, ""
}

func shuffleIndexes(seed string, tickIndex int64) []int64 {
	rng := newSeedRandom(fmt.Sprintf("%s:whack:%d", seed, tickIndex))
	indexes := make([]int64, HoleCount)
	for index := range indexes {
		indexes[index] = int64(index)
	}
	for index := len(indexes) - 1; index > 0; index-- {
		swapIndex := int(math.Floor(rng.Float64() * float64(index+1)))
		indexes[index], indexes[swapIndex] = indexes[swapIndex], indexes[index]
	}
	return indexes
}

func scoredEvent(event HitEvent, tickIndex int64, cell Cell, result HitResult, delta int64, comboAfter int64) ScoredEvent {
	return ScoredEvent{
		Index:      event.Index,
		ElapsedMs:  event.ElapsedMs,
		TickIndex:  tickIndex,
		Cell:       cell,
		Result:     result,
		ScoreDelta: delta,
		ComboAfter: comboAfter,
	}
}

func clampProgress(elapsedMs int64, config DifficultyConfig) float64 {
	if config.DurationMs <= 0 {
		return 0
	}
	return math.Min(1, math.Max(0, float64(elapsedMs)/float64(config.DurationMs)))
}

func boolInt64(value bool) int64 {
	if value {
		return 1
	}
	return 0
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
