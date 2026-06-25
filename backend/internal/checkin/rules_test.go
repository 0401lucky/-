package checkin

import "testing"

func TestCheckinRulesMatchWeeklyGradientAndBrokenWeek(t *testing.T) {
	monday := "2026-06-22"
	if weekdayMon0(monday) != 0 {
		t.Fatalf("expected monday index 0")
	}
	if got := calcCheckinPoints(6, false); got != 100 {
		t.Fatalf("expected sunday full points 100, got %d", got)
	}
	if got := calcCheckinPoints(6, true); got != 50 {
		t.Fatalf("expected broken week points 50, got %d", got)
	}
}

func TestCheckinRulesDetectMissingDaysBeforeToday(t *testing.T) {
	signed := map[string]struct{}{
		"2026-06-22": {},
		"2026-06-23": {},
	}
	if hasBrokenBeforeToday("2026-06-24", signed) {
		t.Fatalf("did not expect broken week when monday and tuesday are signed")
	}
	if !hasBrokenBeforeToday("2026-06-25", signed) {
		t.Fatalf("expected broken week when wednesday is missing")
	}
}

func TestCheckinRulesSundayBonusRequiresMonThroughSat(t *testing.T) {
	signed := map[string]struct{}{}
	for _, date := range []string{"2026-06-22", "2026-06-23", "2026-06-24", "2026-06-25", "2026-06-26", "2026-06-27"} {
		signed[date] = struct{}{}
	}
	if !isMonThruSatAllSigned("2026-06-28", signed) {
		t.Fatalf("expected mon through sat signed")
	}
	if got := calcCheckinSpins(6, true); got != 2 {
		t.Fatalf("expected sunday full bonus 2, got %d", got)
	}
	delete(signed, "2026-06-25")
	if isMonThruSatAllSigned("2026-06-28", signed) {
		t.Fatalf("expected missing thursday to break full sunday bonus")
	}
}
