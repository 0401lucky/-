package admindashboard

type Data struct {
	Dashboard Overview       `json:"dashboard"`
	Alerts    AlertsSnapshot `json:"alerts"`
	Detection *Detection     `json:"detection"`
}

type Overview struct {
	GeneratedAt int64              `json:"generatedAt"`
	Users       UserOverview       `json:"users"`
	Redemption  RedemptionOverview `json:"redemption"`
	PointsFlow  PointsFlowOverview `json:"pointsFlow"`
	Games       GamesOverview      `json:"games"`
	Alerts      AlertOverview      `json:"alerts"`
}

type UserOverview struct {
	Total int64 `json:"total"`
	DAU   int64 `json:"dau"`
	MAU   int64 `json:"mau"`
}

type RedemptionOverview struct {
	TodayClaims       int64 `json:"todayClaims"`
	TodayLotterySpins int64 `json:"todayLotterySpins"`
}

type PointsFlowOverview struct {
	TodayIn  int64 `json:"todayIn"`
	TodayOut int64 `json:"todayOut"`
	TodayNet int64 `json:"todayNet"`
}

type GamesOverview struct {
	Participants      int64   `json:"participants"`
	ParticipationRate float64 `json:"participationRate"`
}

type AlertOverview struct {
	Active   int64 `json:"active"`
	Warning  int64 `json:"warning"`
	Critical int64 `json:"critical"`
}

type AlertItem struct {
	ID         string         `json:"id"`
	Level      string         `json:"level"`
	Name       string         `json:"name"`
	Message    string         `json:"message"`
	Timestamp  int64          `json:"timestamp"`
	Tags       map[string]any `json:"tags,omitempty"`
	Resolved   bool           `json:"resolved,omitempty"`
	ResolvedAt *int64         `json:"resolvedAt,omitempty"`
}

type AlertsSnapshot struct {
	Active  []AlertItem `json:"active"`
	History []AlertItem `json:"history"`
}

type Detection struct {
	ScannedUsers    int64 `json:"scannedUsers"`
	TriggeredAlerts int64 `json:"triggeredAlerts"`
}
