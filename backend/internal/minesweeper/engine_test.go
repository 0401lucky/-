package minesweeper

import (
	"math"
	"testing"
)

func TestSeedRandomMatchesNodeSeedrandom(t *testing.T) {
	rng := newSeedRandom("mine-test-seed-alpha:minesweeper:normal:4:4")
	expected := []float64{
		0.72528817995118655,
		0.59405274328805768,
		0.42134411230679258,
		0.75356420352875486,
		0.10533342452110742,
	}
	for index, value := range expected {
		actual := rng.Float64()
		if math.Abs(actual-value) > 0.00000000000000001 {
			t.Fatalf("rng value %d mismatch: expected %.17f got %.17f", index, value, actual)
		}
	}
}

func TestGenerateMinePositionsMatchesTypeScriptFixture(t *testing.T) {
	actual := GenerateMinePositions("mine-test-seed-alpha", DifficultyNormal, Position{Row: 4, Col: 4})
	expected := []Position{
		{Row: 1, Col: 2}, {Row: 1, Col: 7}, {Row: 1, Col: 8},
		{Row: 3, Col: 0}, {Row: 3, Col: 8},
		{Row: 4, Col: 1}, {Row: 4, Col: 9},
		{Row: 5, Col: 8},
		{Row: 6, Col: 3}, {Row: 6, Col: 8},
		{Row: 7, Col: 5}, {Row: 7, Col: 7}, {Row: 7, Col: 9}, {Row: 7, Col: 10},
		{Row: 8, Col: 11},
		{Row: 9, Col: 4}, {Row: 9, Col: 6},
		{Row: 10, Col: 1}, {Row: 10, Col: 9},
		{Row: 11, Col: 3}, {Row: 11, Col: 5}, {Row: 11, Col: 8}, {Row: 11, Col: 9}, {Row: 11, Col: 10},
	}
	assertPositions(t, expected, actual)
}

func TestFirstRevealLaysMinesAndKeepsSafeAreaSafe(t *testing.T) {
	state := CreateInitialState("mine-test-seed-alpha", DifficultyNormal)
	result := ResolveAction(state, Action{Type: ActionReveal, Position: Position{Row: 4, Col: 4}})
	if !result.OK {
		t.Fatalf("expected reveal ok, got %s", result.Message)
	}
	if !result.State.FirstRevealDone || result.State.FirstReveal == nil {
		t.Fatalf("expected first reveal metadata")
	}
	if result.State.Status != StatusPlaying || result.State.RevealedSafe == 0 || result.State.Moves != 1 {
		t.Fatalf("unexpected state after reveal: %+v", result.State)
	}
	for _, position := range append([]Position{{Row: 4, Col: 4}}, neighborsOf(12, 12, Position{Row: 4, Col: 4})...) {
		cell := getCell(&result.State, position)
		if cell == nil || cell.Mine {
			t.Fatalf("first reveal safe area has mine at %+v", position)
		}
	}
}

func TestBatchSkipsIdempotentFailures(t *testing.T) {
	state := CreateInitialState("mine-test-seed-alpha", DifficultyEasy)
	result := ResolveActions(state, []Action{
		{Type: ActionReveal, Position: Position{Row: 0, Col: 0}},
		{Type: ActionReveal, Position: Position{Row: 0, Col: 0}},
		{Type: ActionFlag, Position: Position{Row: 0, Col: 0}},
	})
	if !result.OK {
		t.Fatalf("expected batch ok, got %s", result.Message)
	}
	if len(result.AppliedActions) != 1 || result.Skipped != 2 {
		t.Fatalf("unexpected batch result: applied=%d skipped=%d", len(result.AppliedActions), result.Skipped)
	}
}

func TestCalculateScoreAndReward(t *testing.T) {
	state := CreateInitialState("score-seed", DifficultyEasy)
	state.Status = StatusWon
	state.RevealedSafe = 71
	state.FlagsUsed = 10
	for index := range state.Cells {
		if index < 10 {
			state.Cells[index].Mine = true
			state.Cells[index].Flagged = true
		} else {
			state.Cells[index].Revealed = true
		}
	}
	score := CalculateScore(state, 60_000)
	if score.Total != 1259 {
		t.Fatalf("unexpected score: %+v", score)
	}
	if reward := CalculatePointReward(score.Total); reward != 125 {
		t.Fatalf("unexpected reward: %d", reward)
	}
}

func assertPositions(t *testing.T, expected []Position, actual []Position) {
	t.Helper()
	if len(expected) != len(actual) {
		t.Fatalf("position length mismatch: expected %d got %d", len(expected), len(actual))
	}
	for index := range expected {
		if expected[index] != actual[index] {
			t.Fatalf("position %d mismatch: expected %+v got %+v", index, expected[index], actual[index])
		}
	}
}
