package eco

import (
	"fmt"
	"math"
	"testing"
	"time"
)

func TestTheftInvestigationChargesOnlyNewRisk(t *testing.T) {
	tests := []struct {
		minutes, previousThefts int64
		want                    float64
	}{
		{0, 0, 0},
		{19, 0, 0},
		{20, 0, 0.22},
		{40, 0, 0},
		{60, 0, 0.02 / 0.78},
		{80, 0, 0},
		{120, 0, 0.02 / 0.76},
		{20, 1, 0.17},
		{20, 5, 0},
		{60, 5, 0},
		{120, 5, 0.01},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("minute_%d_repeats_%d", tt.minutes, tt.previousThefts), func(t *testing.T) {
			got := theftCheckCaughtProbability(tt.minutes*int64(time.Minute/time.Millisecond), tt.previousThefts)
			if math.Abs(got-tt.want) > 1e-12 {
				t.Fatalf("unexpected check risk: got %.12f want %.12f", got, tt.want)
			}
		})
	}
}

func TestFullTheftPursuitHasMeaningfulEscapeProbability(t *testing.T) {
	for _, tt := range []struct {
		previousThefts int64
		wantEscape     float64
	}{{0, 0.32}, {1, 0.37}, {2, 0.42}, {3, 0.47}, {4, 0.52}, {5, 0.57}, {8, 0.72}, {14, 1}} {
		t.Run(fmt.Sprintf("previous_thefts_%d", tt.previousThefts), func(t *testing.T) {
			survival := 1.0
			checks := 0
			for elapsed := theftCheckIntervalMS; elapsed < theftBlackMarketDelayMS; elapsed += theftCheckIntervalMS {
				risk := theftCheckCaughtProbability(elapsed, tt.previousThefts)
				if math.IsNaN(risk) || risk < 0 || risk > 1 {
					t.Fatalf("invalid probability at minute %d: %v", elapsed/60000, risk)
				}
				survival *= 1 - risk
				checks++
			}
			if checks != 71 || math.Abs(survival-tt.wantEscape) > 1e-12 {
				t.Fatalf("unexpected escape probability across %d checks: got %.12f want %.12f", checks, survival, tt.wantEscape)
			}
		})
	}
}
