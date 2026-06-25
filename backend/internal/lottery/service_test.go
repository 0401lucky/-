package lottery

import "testing"

func TestLotteryDefaultConfigMatchesLegacyPointsMode(t *testing.T) {
	config := defaultConfig()
	if !config.Enabled || config.Mode != ModePoints || config.DailyDirectLimit != 2000 || config.DailySpinLimit != 10 {
		t.Fatalf("unexpected default config: %+v", config)
	}
	if len(config.Tiers) != 7 {
		t.Fatalf("expected 7 default tiers, got %d", len(config.Tiers))
	}
	if config.Tiers[0].ID != "pts_200" || config.Tiers[0].Probability != 8 || config.Tiers[6].ID != "pts_0" {
		t.Fatalf("default tiers drifted: %+v", config.Tiers)
	}
}

func TestLotteryNormalizeModeFallsBackToPoints(t *testing.T) {
	for _, mode := range []string{"", "legacy", "POINTS"} {
		if got := normalizeMode(mode); got != ModePoints {
			t.Fatalf("expected %q to fall back to points, got %q", mode, got)
		}
	}
	if got := normalizeMode("direct"); got != ModeDirect {
		t.Fatalf("expected direct mode, got %q", got)
	}
}
