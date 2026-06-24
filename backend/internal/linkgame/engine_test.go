package linkgame

import (
	"math"
	"testing"
)

func TestSeedRandomMatchesNodeSeedrandom(t *testing.T) {
	rng := newSeedRandom("link-test-seed-alpha-gen-0")
	expected := []float64{
		0.78671335469044212,
		0.95633339681850726,
		0.075978188101724506,
		0.85963628757928690,
		0.22139726556301861,
	}
	for index, value := range expected {
		actual := rng.Float64()
		if math.Abs(actual-value) > 0.00000000000000001 {
			t.Fatalf("rng value %d mismatch: expected %.17f got %.17f", index, value, actual)
		}
	}
}

func TestGenerateEasyLayoutMatchesTypeScriptFixture(t *testing.T) {
	layout := GenerateTileLayout(DifficultyEasy, "link-test-seed-alpha")
	if len(layout) != 64 {
		t.Fatalf("expected easy layout length 64, got %d", len(layout))
	}
	expectedPrefix := []string{
		"lemon", "orange", "grapes", "grapes",
		"red-apple", "red-apple", "grapes", "cherries",
		"red-apple", "cherries", "orange", "kiwi",
		"cherries", "red-apple", "grapes", "kiwi",
	}
	for index, expected := range expectedPrefix {
		if layout[index] == nil || *layout[index] != expected {
			t.Fatalf("layout[%d] mismatch: expected %s got %v", index, expected, layout[index])
		}
	}
	if FindHintByConfig(layout, DifficultyConfigFor(DifficultyEasy)) == nil {
		t.Fatalf("generated easy layout should have at least one hint")
	}
}

func TestStack3DRulesAndDeadlockValidation(t *testing.T) {
	config := DifficultyConfigFor(DifficultyHard)
	if GetActiveTileCount(config) != 132 {
		t.Fatalf("expected 132 active hard cells, got %d", GetActiveTileCount(config))
	}
	stages := GetStackExposureStages(config)
	expectedStageSizes := []int{64, 24, 20, 12, 12}
	if len(stages) != len(expectedStageSizes) {
		t.Fatalf("unexpected stage count: %d", len(stages))
	}
	for index, expected := range expectedStageSizes {
		if len(stages[index]) != expected {
			t.Fatalf("stage %d size mismatch: expected %d got %d", index, expected, len(stages[index]))
		}
	}

	board := make([]*string, config.Rows*config.Cols*config.Depth)
	pos1 := position(2, 3, 4)
	pos2 := position(5, 4, 4)
	board[IndexOfPosition(pos1, config)] = stringPtr("A")
	board[IndexOfPosition(pos2, config)] = stringPtr("A")
	if !CanStackMatch(board, pos1, pos2, config) {
		t.Fatalf("expected exposed same stack tiles to match")
	}

	lower1 := position(2, 2, 0)
	lower2 := position(2, 3, 0)
	blocker := position(2, 2, 1)
	blocked := make([]*string, len(board))
	blocked[IndexOfPosition(lower1, config)] = stringPtr("B")
	blocked[IndexOfPosition(lower2, config)] = stringPtr("B")
	blocked[IndexOfPosition(blocker, config)] = stringPtr("C")
	if CanStackMatch(blocked, lower1, lower2, config) {
		t.Fatalf("expected blocked stack tile to be unmatchable")
	}

	deadlockBoard := generateHardDeadlockBoard()
	if FindHintByConfig(deadlockBoard, config) != nil {
		t.Fatalf("unique hard board should have no hints")
	}
	session := Session{ID: "s1", UserID: 1, GameType: GameType, Difficulty: DifficultyHard, Seed: "s", TileLayout: deadlockBoard, Status: "playing"}
	result := ValidateResult(session, SubmitInput{SessionID: "s1", Moves: []Move{}, Completed: false, Outcome: OutcomeDeadlock})
	if !result.OK || !result.Deadlocked || result.Outcome != OutcomeDeadlock {
		t.Fatalf("unexpected deadlock validation: %+v", result)
	}
}

func TestValidateResultRejectsInvalidMovesAndTiming(t *testing.T) {
	session := Session{
		ID: "s1", UserID: 1, GameType: GameType, Difficulty: DifficultyEasy, Seed: "s",
		TileLayout: generateEasyTwoTileBoard(), Status: "playing",
	}
	if result := ValidateResult(session, SubmitInput{SessionID: "s1", Moves: []Move{{Type: "hint"}}, Completed: false}); result.OK || result.Message != "道具已移除" {
		t.Fatalf("expected removed tool rejection, got %+v", result)
	}
	move := Move{Type: "match", Pos1: Position{Row: 0, Col: 0}, Pos2: Position{Row: 0, Col: 1}, Matched: true}
	result := ValidateResult(session, SubmitInput{SessionID: "s1", Moves: []Move{move}, Completed: true})
	if !result.OK || !result.Completed || result.MatchedPairs != 1 || result.Outcome != OutcomeCompleted {
		t.Fatalf("unexpected completed validation: %+v", result)
	}
	ok, message := ValidateSettlementTiming(1_000, DifficultyConfigFor(DifficultyHard), OutcomeDeadlock)
	if ok || message != "游戏时长过短" {
		t.Fatalf("expected short duration rejection, ok=%v message=%s", ok, message)
	}
	ok, message = ValidateSettlementTiming(10_000, DifficultyConfigFor(DifficultyHard), OutcomeTimeout)
	if ok || message != "游戏尚未超时" {
		t.Fatalf("expected early timeout rejection, ok=%v message=%s", ok, message)
	}
}

func TestScoreAndRewards(t *testing.T) {
	if score := CalculateScore(10, 10, 5, 0, DifficultyEasy, 32, OutcomeCompleted); score != 150 {
		t.Fatalf("unexpected easy score: %d", score)
	}
	if score := CalculateScore(20, 24, 0, 120, DifficultyHard, 66, OutcomeDeadlock); score != 728 {
		t.Fatalf("unexpected hard deadlock score: %d", score)
	}
	if reward := CalculatePointReward(1000, DifficultyHard, OutcomeCompleted); reward != 200 {
		t.Fatalf("unexpected hard completed reward: %d", reward)
	}
	if reward := CalculatePointReward(999, DifficultyHard, OutcomeDeadlock); reward != 99 {
		t.Fatalf("unexpected hard deadlock reward: %d", reward)
	}
	if reward := CalculatePointReward(1000, DifficultyEasy, OutcomeCompleted); reward != 10 {
		t.Fatalf("unexpected easy reward: %d", reward)
	}
}

func generateEasyTwoTileBoard() []*string {
	config := DifficultyConfigFor(DifficultyEasy)
	board := make([]*string, config.Rows*config.Cols)
	board[0] = stringPtr("A")
	board[1] = stringPtr("A")
	return board
}

func generateHardDeadlockBoard() []*string {
	config := DifficultyConfigFor(DifficultyHard)
	board := make([]*string, config.Rows*config.Cols*config.Depth)
	for index, pos := range GetActivePositions(config) {
		board[IndexOfPosition(pos, config)] = stringPtr("T" + string(rune(index+1000)))
	}
	return board
}

func position(row int, col int, z int) Position {
	return Position{Row: row, Col: col, Z: &z}
}
