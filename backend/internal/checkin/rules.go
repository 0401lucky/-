package checkin

import (
	"strings"
	"time"
)

var weekPointsGradient = []int64{50, 50, 50, 60, 60, 70, 100}
var weekdayLabels = []string{"周一", "周二", "周三", "周四", "周五", "周六", "周日"}

const (
	brokenWeekPoints       = int64(50)
	weekdayBonusSpins      = int64(1)
	sundayFullBonusSpins   = int64(2)
	sundayDefaultBonusSpin = int64(1)
	chinaTZOffset          = 8 * time.Hour
	dateLayout             = "2006-01-02"
)

func todayChina(now time.Time) string {
	return now.UTC().Add(chinaTZOffset).Format(dateLayout)
}

func parseDateKey(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	date, err := time.Parse(dateLayout, value)
	if err != nil || date.Format(dateLayout) != value {
		return time.Time{}, false
	}
	return date, true
}

func addDays(dateKey string, days int) string {
	date, ok := parseDateKey(dateKey)
	if !ok {
		return dateKey
	}
	return date.AddDate(0, 0, days).Format(dateLayout)
}

func weekdayMon0(dateKey string) int {
	date, ok := parseDateKey(dateKey)
	if !ok {
		return 0
	}
	return (int(date.Weekday()) + 6) % 7
}

func mondayOfWeek(dateKey string) string {
	return addDays(dateKey, -weekdayMon0(dateKey))
}

func listWeekDateKeys(todayKey string) []string {
	monday := mondayOfWeek(todayKey)
	keys := make([]string, 0, 7)
	for index := 0; index < 7; index++ {
		keys = append(keys, addDays(monday, index))
	}
	return keys
}

func hasBrokenBeforeToday(todayKey string, signedSet map[string]struct{}) bool {
	cursor := mondayOfWeek(todayKey)
	for cursor != todayKey {
		if _, ok := signedSet[cursor]; !ok {
			return true
		}
		cursor = addDays(cursor, 1)
		if cursor > todayKey {
			break
		}
	}
	return false
}

func hasBrokenBeforeDate(targetKey string, signedSet map[string]struct{}) bool {
	cursor := mondayOfWeek(targetKey)
	for cursor != targetKey {
		if _, ok := signedSet[cursor]; !ok {
			return true
		}
		cursor = addDays(cursor, 1)
		if cursor > targetKey {
			break
		}
	}
	return false
}

func isMonThruSatAllSigned(todayKey string, signedSet map[string]struct{}) bool {
	monday := mondayOfWeek(todayKey)
	for index := 0; index < 6; index++ {
		if _, ok := signedSet[addDays(monday, index)]; !ok {
			return false
		}
	}
	return true
}

func isInCurrentWeek(targetKey string, todayKey string) bool {
	return mondayOfWeek(targetKey) == mondayOfWeek(todayKey)
}

func calcCheckinPoints(weekday int, weekBroken bool) int64 {
	if weekBroken {
		return brokenWeekPoints
	}
	if weekday < 0 || weekday >= len(weekPointsGradient) {
		return brokenWeekPoints
	}
	return weekPointsGradient[weekday]
}

func calcCheckinSpins(weekday int, monThruSatAllSigned bool) int64 {
	if weekday == 6 {
		if monThruSatAllSigned {
			return sundayFullBonusSpins
		}
		return sundayDefaultBonusSpin
	}
	return weekdayBonusSpins
}

func weekdayLabel(weekday int) string {
	if weekday < 0 || weekday >= len(weekdayLabels) {
		return ""
	}
	return weekdayLabels[weekday]
}
