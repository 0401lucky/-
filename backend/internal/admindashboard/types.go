package admindashboard

type Data struct {
	Dashboard Overview       `json:"dashboard"`
	Alerts    AlertsSnapshot `json:"alerts"`
	Detection *Detection     `json:"detection"`
}

type Overview struct {
	GeneratedAt     int64              `json:"generatedAt"`
	Users           UserOverview       `json:"users"`
	Redemption      RedemptionOverview `json:"redemption"`
	Engagement      EngagementOverview `json:"engagement"`
	Operations      OperationsOverview `json:"operations"`
	PointsFlow      PointsFlowOverview `json:"pointsFlow"`
	PointsAnalytics PointsAnalytics    `json:"pointsAnalytics"`
	Games           GamesOverview      `json:"games"`
	Alerts          AlertOverview      `json:"alerts"`
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

type EngagementOverview struct {
	TodayCheckins       int64 `json:"todayCheckins"`
	TodayCardDraws      int64 `json:"todayCardDraws"`
	TodayCardExchanges  int64 `json:"todayCardExchanges"`
	TodayGamesStarted   int64 `json:"todayGamesStarted"`
	TodayGamesCompleted int64 `json:"todayGamesCompleted"`
}

type OperationsOverview struct {
	Projects      ProjectsOperationOverview      `json:"projects"`
	Raffles       RafflesOperationOverview       `json:"raffles"`
	Store         StoreOperationOverview         `json:"store"`
	Feedback      FeedbackOperationOverview      `json:"feedback"`
	Announcements AnnouncementsOperationOverview `json:"announcements"`
}

type ProjectsOperationOverview struct {
	Total          int64 `json:"total"`
	Active         int64 `json:"active"`
	RemainingSlots int64 `json:"remainingSlots"`
}

type RafflesOperationOverview struct {
	Active int64 `json:"active"`
}

type StoreOperationOverview struct {
	EnabledItems int64 `json:"enabledItems"`
}

type FeedbackOperationOverview struct {
	Open       int64 `json:"open"`
	Processing int64 `json:"processing"`
}

type AnnouncementsOperationOverview struct {
	Published int64 `json:"published"`
}

type PointsAnalytics struct {
	Period       string                   `json:"period"`
	Range        PointsAnalyticsRange     `json:"range"`
	BucketLabels []string                 `json:"bucketLabels"`
	Earning      PointsDirectionAnalytics `json:"earning"`
	Spending     PointsDirectionAnalytics `json:"spending"`
	Meta         PointsAnalyticsMeta      `json:"meta"`
}

type PointsAnalyticsRange struct {
	StartAt    int64  `json:"startAt"`
	EndAt      int64  `json:"endAt"`
	Label      string `json:"label"`
	BucketUnit string `json:"bucketUnit"`
}

type PointsDirectionAnalytics struct {
	Total      int64                `json:"total"`
	Count      int64                `json:"count"`
	UserCount  int64                `json:"userCount"`
	Average    int64                `json:"average"`
	Categories []PointsPathCategory `json:"categories"`
	Series     []PointsPathSeries   `json:"series"`
}

type PointsPathCategory struct {
	Key             string             `json:"key"`
	Label           string             `json:"label"`
	Total           int64              `json:"total"`
	Count           int64              `json:"count"`
	UserCount       int64              `json:"userCount"`
	Percent         float64            `json:"percent"`
	Average         int64              `json:"average"`
	TopDescriptions []PointsPathDetail `json:"topDescriptions"`
}

type PointsPathDetail struct {
	Description string `json:"description"`
	Total       int64  `json:"total"`
	Count       int64  `json:"count"`
}

type PointsPathSeries struct {
	Key    string                   `json:"key"`
	Label  string                   `json:"label"`
	Total  int64                    `json:"total"`
	Points []PointsPathSeriesBucket `json:"points"`
}

type PointsPathSeriesBucket struct {
	BucketStart int64  `json:"bucketStart"`
	Label       string `json:"label"`
	Value       int64  `json:"value"`
	Count       int64  `json:"count"`
}

type PointsAnalyticsMeta struct {
	Storage        string `json:"storage"`
	ScannedUsers   int64  `json:"scannedUsers"`
	ScannedLogs    int64  `json:"scannedLogs"`
	MaxLogsPerUser *int64 `json:"maxLogsPerUser"`
	TruncatedUsers int64  `json:"truncatedUsers"`
	TruncatedLogs  bool   `json:"truncatedLogs"`
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
