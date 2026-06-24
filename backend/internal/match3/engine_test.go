package match3

import (
	"math"
	"testing"
)

func TestSeedRandomMatchesNodeSeedrandom(t *testing.T) {
	rng := newSeedRandom("seed-for-test")
	expected := []float64{
		0.76919836631873084,
		0.49236716661343832,
		0.24975235752659899,
		0.85642503768573119,
		0.00614303215429428,
	}
	for index, value := range expected {
		actual := rng.Float64()
		if math.Abs(actual-value) > 0.00000000000000001 {
			t.Fatalf("rng value %d mismatch: expected %.17f got %.17f", index, value, actual)
		}
	}
}

func TestCreateInitialBoardMatchesTypeScriptFixture(t *testing.T) {
	result := CreateInitialBoard("seed-for-test", DefaultConfig)
	expected := []int{
		2, 5, 1, 5, 2, 5, 3, 1,
		4, 0, 4, 3, 5, 0, 2, 0,
		2, 5, 5, 1, 2, 0, 5, 1,
		0, 1, 2, 2, 1, 4, 4, 5,
		3, 5, 0, 5, 0, 2, 1, 0,
		4, 0, 0, 2, 4, 5, 4, 1,
		1, 2, 5, 5, 0, 5, 1, 4,
		2, 3, 3, 0, 4, 1, 0, 5,
	}
	if !result.OK {
		t.Fatalf("expected board result ok: %s", result.Message)
	}
	assertIntSlice(t, expected, result.FinalBoard)
}

func TestSimulateGameMatchesTypeScriptFixture(t *testing.T) {
	result := SimulateGame("seed-for-test", DefaultConfig, []Move{{From: 4, To: 12}})
	expectedBoard := []int{
		2, 5, 1, 4, 0, 5, 3, 1,
		4, 0, 4, 3, 0, 0, 2, 0,
		2, 5, 5, 1, 3, 0, 5, 1,
		0, 1, 2, 2, 1, 4, 4, 5,
		3, 5, 0, 5, 0, 2, 1, 0,
		4, 0, 0, 2, 4, 5, 4, 1,
		1, 2, 5, 5, 0, 5, 1, 4,
		2, 3, 3, 0, 4, 1, 0, 5,
	}
	if !result.OK {
		t.Fatalf("expected simulate result ok: %s", result.Message)
	}
	if result.Score != 27 || result.Stats.Cascades != 2 || result.Stats.TilesCleared != 6 || result.Stats.MovesApplied != 1 {
		t.Fatalf("unexpected stats: score=%d stats=%+v", result.Score, result.Stats)
	}
	assertIntSlice(t, expectedBoard, result.FinalBoard)
}

func TestCalculatePointReward(t *testing.T) {
	if CalculatePointReward(0) != 0 || CalculatePointReward(9) != 0 || CalculatePointReward(99) != 9 || CalculatePointReward(860) != 86 {
		t.Fatalf("unexpected match3 reward conversion")
	}
}

func assertIntSlice(t *testing.T, expected []int, actual []int) {
	t.Helper()
	if len(expected) != len(actual) {
		t.Fatalf("length mismatch: expected %d got %d", len(expected), len(actual))
	}
	for index := range expected {
		if expected[index] != actual[index] {
			t.Fatalf("index %d mismatch: expected %d got %d", index, expected[index], actual[index])
		}
	}
}
