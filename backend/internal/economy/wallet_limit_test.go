package economy

import (
	"testing"
	"time"

	"redemption/backend/internal/systemconfig"
)

func TestNextChinaMidnightMillis(t *testing.T) {
	china := time.FixedZone("CST", 8*60*60)

	cases := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "中国时区上午",
			now:  time.Date(2026, 8, 31, 10, 30, 0, 0, china),
			want: time.Date(2026, 9, 1, 0, 0, 0, 0, china),
		},
		{
			name: "跨月边界",
			now:  time.Date(2026, 8, 31, 23, 59, 59, 0, china),
			want: time.Date(2026, 9, 1, 0, 0, 0, 0, china),
		},
		{
			name: "UTC 时刻按中国日历折算",
			// UTC 2026-08-31 17:00 = 中国 2026-09-01 01:00，次日 0 点应是 09-02
			now:  time.Date(2026, 8, 31, 17, 0, 0, 0, time.UTC),
			want: time.Date(2026, 9, 2, 0, 0, 0, 0, china),
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := nextChinaMidnightMillis(tt.now); got != tt.want.UnixMilli() {
				t.Fatalf("nextChinaMidnightMillis = %d, want %d", got, tt.want.UnixMilli())
			}
		})
	}
}

func TestWithdrawDailyLimitFor(t *testing.T) {
	config := systemconfig.Config{DailyWithdrawLimit: 4, VIPDailyWithdrawLimit: 8}

	if got := withdrawDailyLimitFor(config, false); got != 4 {
		t.Fatalf("non-vip limit = %d, want 4", got)
	}
	if got := withdrawDailyLimitFor(config, true); got != 8 {
		t.Fatalf("vip limit = %d, want 8", got)
	}
}

func TestWithdrawFeePercentFor(t *testing.T) {
	config := systemconfig.Config{VIPWithdrawFeePercent: 50}

	if got := withdrawFeePercentFor(config, false); got != 100 {
		t.Fatalf("non-vip fee percent = %d, want 100", got)
	}
	if got := withdrawFeePercentFor(config, true); got != 50 {
		t.Fatalf("vip fee percent = %d, want 50", got)
	}
}
