package whackmole

import (
	"math"
	"testing"
)

func TestSeedRandomMatchesNodeSeedrandom(t *testing.T) {
	rng := newSeedRandom("whack-test-seed-alpha:board:3")
	expected := []float64{
		0.42775384765988128,
		0.05097455107563297,
		0.74600894510508431,
		0.85830887285383317,
		0.21231705981235824,
	}
	for index, value := range expected {
		actual := rng.Float64()
		if math.Abs(actual-value) > 0.00000000000000001 {
			t.Fatalf("rng value %d mismatch: expected %.17f got %.17f", index, value, actual)
		}
	}
}

func TestWhackMoleBoardMatchesTypeScriptFixture(t *testing.T) {
	board := GetBoard("whack-test-seed-alpha", 10_000, DifficultyNormal)
	expected := []Cell{
		CellEmpty, CellEmpty, CellMole, CellEmpty,
		CellEmpty, CellEmpty, CellEmpty, CellMole,
		CellEmpty, CellEmpty, CellEmpty, CellEmpty,
		CellEmpty, CellEmpty, CellEmpty, CellMole,
	}
	assertCells(t, expected, board)
	if tick := GetTickIndex(10_000, DifficultyNormal); tick != 8 {
		t.Fatalf("expected tick 8, got %d", tick)
	}
	if refresh := GetRefreshMs(10_000, DifficultyNormal); refresh != 1135 {
		t.Fatalf("expected refresh 1135, got %d", refresh)
	}
	if bombs := GetBombCount(10_000, DifficultyNormal); bombs != 0 {
		t.Fatalf("expected bombs 0, got %d", bombs)
	}
}

func TestScoreEventsMatchesTypeScriptFixture(t *testing.T) {
	scored := ScoreEvents("whack-test-seed-alpha", []HitEvent{{Index: 2, ElapsedMs: 10_000}}, DifficultyNormal)
	if scored.Score != 10 || scored.Combo != 1 || scored.Stats.Hits != 1 || scored.Stats.MaxCombo != 1 {
		t.Fatalf("unexpected scored result: %+v", scored)
	}
	if len(scored.Events) != 1 || scored.Events[0].Result != HitResultHit || scored.Events[0].ScoreDelta != 10 || scored.Events[0].TickIndex != 8 {
		t.Fatalf("unexpected scored event: %+v", scored.Events)
	}
}

func TestWhackMoleRewardDivisors(t *testing.T) {
	if CalculatePointReward(840, DifficultyEasy) != 70 {
		t.Fatalf("unexpected easy reward")
	}
	if CalculatePointReward(1600, DifficultyNormal) != 160 {
		t.Fatalf("unexpected normal reward")
	}
	if CalculatePointReward(1440, DifficultyHard) != 180 {
		t.Fatalf("unexpected hard reward")
	}
}

func assertCells(t *testing.T, expected []Cell, actual []Cell) {
	t.Helper()
	if len(expected) != len(actual) {
		t.Fatalf("length mismatch: expected %d got %d", len(expected), len(actual))
	}
	for index := range expected {
		if expected[index] != actual[index] {
			t.Fatalf("cell %d mismatch: expected %s got %s", index, expected[index], actual[index])
		}
	}
}
