package checkin

const (
	SourceDaily  = "daily"
	SourceMakeup = "makeup"
)

type WeekStatus struct {
	WeekdayMon0         int   `json:"weekdayMon0"`
	WeekBroken          bool  `json:"weekBroken"`
	MonThruSatAllSigned bool  `json:"monThruSatAllSigned"`
	PreviewPoints       int64 `json:"previewPoints"`
	PreviewSpins        int64 `json:"previewSpins"`
}

type TodayResult struct {
	PointsAwarded     int64  `json:"pointsAwarded"`
	ExtraSpinsAwarded int64  `json:"extraSpinsAwarded"`
	WeekBroken        bool   `json:"weekBroken"`
	WeekdayLabel      string `json:"weekdayLabel"`
}

type Snapshot struct {
	CheckedIn          bool         `json:"checkedIn"`
	ExtraSpins         int64        `json:"extraSpins"`
	DailyFreeAvailable bool         `json:"dailyFreeAvailable"`
	MakeupCards        int64        `json:"makeupCards"`
	History            []string     `json:"history"`
	WeekStatus         *WeekStatus  `json:"weekStatus"`
	TodayCheckinResult *TodayResult `json:"todayCheckinResult"`
}

type CheckinResult struct {
	Success           bool   `json:"success"`
	Message           string `json:"message"`
	PointsAwarded     int64  `json:"pointsAwarded,omitempty"`
	PointsBalance     int64  `json:"pointsBalance,omitempty"`
	ExtraSpinsAwarded int64  `json:"extraSpinsAwarded,omitempty"`
	ExtraSpins        int64  `json:"extraSpins,omitempty"`
	WeekBroken        bool   `json:"weekBroken"`
	WeekdayLabel      string `json:"weekdayLabel,omitempty"`
}

type MakeupResult struct {
	Success           bool     `json:"success"`
	Message           string   `json:"message"`
	Date              string   `json:"date,omitempty"`
	PointsAwarded     int64    `json:"pointsAwarded,omitempty"`
	PointsBalance     int64    `json:"pointsBalance,omitempty"`
	ExtraSpinsAwarded int64    `json:"extraSpinsAwarded,omitempty"`
	ExtraSpins        int64    `json:"extraSpins,omitempty"`
	MakeupCards       int64    `json:"makeupCards"`
	StillMissing      []string `json:"stillMissing"`
}
