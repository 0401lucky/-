package sudoku

import "testing"

func TestGeneratePuzzleIsDeterministicAndHasOneSolution(t *testing.T) {
	puzzle, solution := GeneratePuzzle("sudoku-test-seed", DifficultyHard)
	otherPuzzle, otherSolution := GeneratePuzzle("sudoku-test-seed", DifficultyHard)
	if len(puzzle) != cellCount || len(solution) != cellCount {
		t.Fatalf("unexpected board sizes: puzzle=%d solution=%d", len(puzzle), len(solution))
	}
	for index := range puzzle {
		if puzzle[index] != otherPuzzle[index] || solution[index] != otherSolution[index] {
			t.Fatalf("puzzle is not deterministic at %d", index)
		}
		if puzzle[index] != 0 && puzzle[index] != solution[index] {
			t.Fatalf("given cell %d differs from solution", index)
		}
	}
	if countSolutions(puzzle, 2) != 1 {
		t.Fatal("generated puzzle should have exactly one solution")
	}
}

func TestGeneratePuzzleRespectsDifficultyClues(t *testing.T) {
	for _, difficulty := range []Difficulty{DifficultyEasy, DifficultyNormal, DifficultyHard} {
		puzzle, solution := GeneratePuzzle("sudoku-clue-seed-"+string(difficulty), difficulty)
		if countClues(puzzle) > DifficultyConfigFor(difficulty).Clues {
			t.Fatalf("%s puzzle has too many clues: got=%d want<=%d", difficulty, countClues(puzzle), DifficultyConfigFor(difficulty).Clues)
		}
		if countSolutions(puzzle, 2) != 1 || !isSolved(solution, solution) {
			t.Fatalf("%s puzzle should have one valid solution", difficulty)
		}
	}
}

func TestApplyActionTracksMistakesNotesAndWin(t *testing.T) {
	state := CreateInitialState("sudoku-action-seed", DifficultyEasy)
	empty := -1
	for index, value := range state.Puzzle {
		if value == 0 {
			empty = index
			break
		}
	}
	if empty < 0 {
		t.Fatal("expected at least one empty cell")
	}

	noted := ApplyAction(state, Action{Type: ActionNote, Index: empty, Value: 1}, 100)
	if !noted.OK || len(noted.State.Notes[empty]) != 1 {
		t.Fatalf("expected note action to succeed: %+v", noted)
	}
	wrong := noted.State.Solution[empty]%9 + 1
	if wrong == noted.State.Solution[empty] {
		wrong = wrong%9 + 1
	}
	placed := ApplyAction(noted.State, Action{Type: ActionSet, Index: empty, Value: wrong}, 200)
	if !placed.OK || placed.State.Mistakes != 1 || !placed.State.Errors[empty] {
		t.Fatalf("expected wrong placement to be tracked: %+v", placed.State)
	}
	correct := ApplyAction(placed.State, Action{Type: ActionSet, Index: empty, Value: placed.State.Solution[empty]}, 300)
	if !correct.OK || correct.State.Mistakes != 1 || correct.State.Errors[empty] {
		t.Fatalf("expected correction to clear cell error: %+v", correct.State)
	}
}

func TestCalculateScoreRequiresWin(t *testing.T) {
	state := CreateInitialState("sudoku-score-seed", DifficultyNormal)
	if score := CalculateScore(state, 30_000); score.Total != 0 {
		t.Fatalf("unfinished game should not score: %+v", score)
	}
	state.Status = StatusWon
	score := CalculateScore(state, 30_000)
	if score.Total <= DifficultyConfigFor(DifficultyNormal).BaseScore {
		t.Fatalf("winning score should include time/perfect bonus: %+v", score)
	}
	if reward := CalculatePointReward(score.Total); reward <= 0 {
		t.Fatalf("winning score should grant points: %d", reward)
	}
}
