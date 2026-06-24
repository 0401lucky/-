package memory

import "testing"

func TestGenerateCardLayoutMatchesTypeScriptSeededShuffle(t *testing.T) {
	layout := GenerateCardLayout(DifficultyEasy, "seed-for-test")
	expected := []string{
		"apple", "watermelon", "strawberry", "grapes",
		"pear", "apple", "pear", "watermelon",
		"strawberry", "cherry", "grapes", "banana",
		"cherry", "orange", "orange", "banana",
	}
	if len(layout) != len(expected) {
		t.Fatalf("expected %d cards, got %d", len(expected), len(layout))
	}
	for index := range expected {
		if layout[index] != expected[index] {
			t.Fatalf("card %d mismatch: expected %q got %q layout=%v", index, expected[index], layout[index], layout)
		}
	}
}

func TestCalculateScore(t *testing.T) {
	if score := CalculateScore(DifficultyEasy, 8, true); score != 220 {
		t.Fatalf("expected perfect easy score 220, got %d", score)
	}
	if score := CalculateScore(DifficultyEasy, 1000, true); score != 60 {
		t.Fatalf("expected min easy score 60, got %d", score)
	}
	if score := CalculateScore(DifficultyHard, 18, false); score != 0 {
		t.Fatalf("expected incomplete score 0, got %d", score)
	}
}

func TestBuildSessionViewMasksHiddenCards(t *testing.T) {
	first := 1
	session := Session{
		ID:               "session",
		Difficulty:       DifficultyEasy,
		CardLayout:       []string{"apple", "banana", "apple", "banana"},
		FirstFlippedCard: &first,
		MatchedCards:     []int{0, 2},
		MoveLog:          []Move{{Card1: 0, Card2: 2, Matched: true}},
	}
	view := BuildSessionView(session)
	expected := []string{"apple", "banana", "apple", hiddenCardSentinel}
	for index := range expected {
		if view.CardLayout[index] != expected[index] {
			t.Fatalf("view card %d mismatch: expected %q got %q", index, expected[index], view.CardLayout[index])
		}
	}
	if view.MoveCount != 1 || view.FirstFlippedCard == nil || *view.FirstFlippedCard != first {
		t.Fatalf("unexpected view: %+v", view)
	}
}
