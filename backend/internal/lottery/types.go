package lottery

type Mode string

const (
	ModeCode   Mode = "code"
	ModeDirect Mode = "direct"
	ModeHybrid Mode = "hybrid"
	ModePoints Mode = "points"
)

type Tier struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Value       int64   `json:"value"`
	Probability float64 `json:"probability"`
	Color       string  `json:"color"`
	CodesCount  int64   `json:"codesCount"`
	UsedCount   int64   `json:"usedCount"`
	Enabled     bool    `json:"enabled"`
}

type Config struct {
	Enabled          bool   `json:"enabled"`
	Mode             Mode   `json:"mode"`
	DailyDirectLimit int64  `json:"dailyDirectLimit"`
	DailySpinLimit   int64  `json:"dailySpinLimit"`
	Tiers            []Tier `json:"tiers"`
}

type ConfigUpdateInput struct {
	Enabled          *bool
	Mode             string
	DailyDirectLimit *int64
	DailySpinLimit   *int64
	Tiers            *[]TierUpdateInput
}

type TierUpdateInput struct {
	ID          string
	Name        *string
	Value       *int64
	Color       *string
	Probability *float64
	Enabled     *bool
}

type PageTier struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Value    int64  `json:"value"`
	Color    string `json:"color"`
	HasStock bool   `json:"hasStock"`
	Enabled  bool   `json:"enabled"`
}

type Record struct {
	ID            string `json:"id"`
	OderID        string `json:"oderId"`
	Username      string `json:"username"`
	TierName      string `json:"tierName"`
	TierValue     int64  `json:"tierValue"`
	Code          string `json:"code"`
	DirectCredit  *bool  `json:"directCredit,omitempty"`
	CreditedQuota *int64 `json:"creditedQuota,omitempty"`
	PointsAwarded *int64 `json:"pointsAwarded,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
}

type SpinResult struct {
	Record  Record `json:"record"`
	Message string `json:"message"`
}

type UserView struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type PagePayload struct {
	Enabled            bool       `json:"enabled"`
	Mode               Mode       `json:"mode"`
	Tiers              []PageTier `json:"tiers"`
	CanSpin            bool       `json:"canSpin"`
	HasSpunToday       bool       `json:"hasSpunToday"`
	ExtraSpins         int64      `json:"extraSpins"`
	DailySpinLimit     int64      `json:"dailySpinLimit"`
	DailySpinUsed      int64      `json:"dailySpinUsed"`
	DailySpinRemaining int64      `json:"dailySpinRemaining"`
	AllTiersHaveCodes  bool       `json:"allTiersHaveCodes"`
	User               UserView   `json:"user"`
	Records            []Record   `json:"records"`
}

type AdminTier struct {
	Tier
	Available int64 `json:"available"`
}

type AdminStats struct {
	TotalCodes     int64 `json:"totalCodes"`
	TotalUsed      int64 `json:"totalUsed"`
	TotalAvailable int64 `json:"totalAvailable"`
}

type Pagination struct {
	Page    int  `json:"page"`
	Limit   int  `json:"limit"`
	HasMore bool `json:"hasMore"`
}

type AdminSnapshot struct {
	Config           Config             `json:"config"`
	TodayDirectTotal int64              `json:"todayDirectTotal"`
	Tiers            []AdminTier        `json:"tiers"`
	ProbabilityMap   map[string]float64 `json:"probabilityMap"`
	Stats            AdminStats         `json:"stats"`
	Records          []Record           `json:"records"`
	Pagination       Pagination         `json:"pagination"`
}

type NumberBombMultiplier int

const (
	NumberBombMultiplier1  NumberBombMultiplier = 1
	NumberBombMultiplier2  NumberBombMultiplier = 2
	NumberBombMultiplier5  NumberBombMultiplier = 5
	NumberBombMultiplier10 NumberBombMultiplier = 10
)

type NumberBombBetStatus string

const (
	NumberBombStatusPending   NumberBombBetStatus = "pending"
	NumberBombStatusWon       NumberBombBetStatus = "won"
	NumberBombStatusLost      NumberBombBetStatus = "lost"
	NumberBombStatusCancelled NumberBombBetStatus = "cancelled"
)

type NumberBombBet struct {
	ID             string               `json:"id"`
	UserID         int64                `json:"userId"`
	Username       string               `json:"username"`
	Date           string               `json:"date"`
	SelectedNumber int                  `json:"selectedNumber"`
	Multiplier     NumberBombMultiplier `json:"multiplier"`
	TicketCost     int64                `json:"ticketCost"`
	Status         NumberBombBetStatus  `json:"status"`
	SystemNumber   *int                 `json:"systemNumber,omitempty"`
	RewardPoints   *int64               `json:"rewardPoints,omitempty"`
	CreatedAt      int64                `json:"createdAt"`
	UpdatedAt      int64                `json:"updatedAt"`
	SettledAt      *int64               `json:"settledAt,omitempty"`
}

type NumberBombState struct {
	Date                  string                 `json:"date"`
	Yesterday             string                 `json:"yesterday"`
	Balance               int64                  `json:"balance"`
	BaseTicketCost        int64                  `json:"baseTicketCost"`
	Multipliers           []NumberBombMultiplier `json:"multipliers"`
	TodayBet              *NumberBombBet         `json:"todayBet"`
	YesterdayBet          *NumberBombBet         `json:"yesterdayBet"`
	TodaySystemNumber     *int                   `json:"todaySystemNumber"`
	YesterdaySystemNumber *int                   `json:"yesterdaySystemNumber"`
}

type NumberBombBetInput struct {
	SelectedNumber int
	Multiplier     int
}

type NumberBombBetResult struct {
	Message string        `json:"message"`
	Bet     NumberBombBet `json:"bet"`
	Balance int64         `json:"balance"`
}

type NumberBombAdminParticipant struct {
	UserID         int64                `json:"userId"`
	Username       string               `json:"username"`
	SelectedNumber int                  `json:"selectedNumber"`
	Status         NumberBombBetStatus  `json:"status"`
	Multiplier     NumberBombMultiplier `json:"multiplier"`
	TicketCost     int64                `json:"ticketCost"`
	RewardPoints   *int64               `json:"rewardPoints,omitempty"`
	CreatedAt      int64                `json:"createdAt"`
	SettledAt      *int64               `json:"settledAt,omitempty"`
}

type NumberBombDailyAdminStats struct {
	Date             string                       `json:"date"`
	SystemNumber     *int                         `json:"systemNumber"`
	ParticipantCount int64                        `json:"participantCount"`
	TotalBetCount    int64                        `json:"totalBetCount"`
	WonCount         int64                        `json:"wonCount"`
	LostCount        int64                        `json:"lostCount"`
	PendingCount     int64                        `json:"pendingCount"`
	CancelledCount   int64                        `json:"cancelledCount"`
	SelectedCounts   map[string]int64             `json:"selectedCounts"`
	Participants     []NumberBombAdminParticipant `json:"participants"`
	Winners          []NumberBombAdminParticipant `json:"winners"`
}

type NumberBombAdminSnapshot struct {
	Date         string                      `json:"date"`
	SystemNumber int                         `json:"systemNumber"`
	RecentStats  []NumberBombDailyAdminStats `json:"recentStats"`
}

type NumberBombSettleResult struct {
	Date         string `json:"date"`
	SystemNumber int    `json:"systemNumber"`
	Processed    int64  `json:"processed"`
	Won          int64  `json:"won"`
	Lost         int64  `json:"lost"`
	Skipped      int64  `json:"skipped"`
}

type LotteryRankingPeriod string

const (
	LotteryRankingDaily   LotteryRankingPeriod = "daily"
	LotteryRankingWeekly  LotteryRankingPeriod = "weekly"
	LotteryRankingMonthly LotteryRankingPeriod = "monthly"
)

type LotteryRankingEntry struct {
	Rank                int64  `json:"rank"`
	UserID              string `json:"userId"`
	Username            string `json:"username"`
	EquippedAchievement any    `json:"equippedAchievement"`
	TotalValue          int64  `json:"totalValue"`
	BestPrize           string `json:"bestPrize"`
	Count               int64  `json:"count"`
}

type LotteryPeriodRankingResult struct {
	Period            LotteryRankingPeriod  `json:"period"`
	PeriodKey         string                `json:"periodKey"`
	TotalParticipants int64                 `json:"totalParticipants"`
	Ranking           []LotteryRankingEntry `json:"ranking"`
}

type LotteryDailyRankingResult struct {
	Date              string                `json:"date"`
	TotalParticipants int64                 `json:"totalParticipants"`
	Ranking           []LotteryRankingEntry `json:"ranking"`
}
