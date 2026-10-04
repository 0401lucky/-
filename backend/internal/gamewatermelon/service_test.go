package gamewatermelon

import (
	"testing"
	"time"
)

func TestRewardBoundaries(t *testing.T) {
	for _, test := range []struct{ score, points int64 }{{-1, 0}, {0, 0}, {15, 0}, {16, 1}, {208, 13}, {3199, 199}, {3200, 200}, {999999, 200}} {
		if got := CalculatePointReward(test.score); got != test.points {
			t.Fatalf("score %d: got %d want %d", test.score, got, test.points)
		}
	}
}

func TestCheckpointTokensAndWallTime(t *testing.T) {
	now := time.Now()
	s := Session{Seed: "test-seed", StartedAt: now.UnixMilli(), State: Initial("test-seed")}
	input := SubmitInput{ToTick: 240, Drops: []Drop{}}
	next, err := advanceSession(s, input, now)
	if err != nil || next.State.Tick != 240 {
		t.Fatalf("valid advance: %v", err)
	}
	input.ToTick = 241
	if _, err := advanceSession(s, input, now); err == nil {
		t.Fatal("accepted fast-forwarded ticks")
	}
	input.ToTick, input.BaseMoves = 0, 1
	if _, err := advanceSession(s, input, now); err == nil {
		t.Fatal("accepted stale move token")
	}
	input.ToTick, input.BaseMoves, input.BaseTick = 240, 0, 1
	if _, err := advanceSession(s, input, now); err == nil {
		t.Fatal("accepted stale tick token")
	}
	if s.State.Tick != 0 {
		t.Fatal("validation changed saved state")
	}
}
