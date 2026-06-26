package adminusers

type UserWithStats struct {
	ID                  int64  `json:"id"`
	Username            string `json:"username"`
	FirstSeen           int64  `json:"firstSeen"`
	ClaimsCount         int64  `json:"claimsCount"`
	LotteryCount        int64  `json:"lotteryCount"`
	IsNewUser           bool   `json:"isNewUser"`
	PointsBalance       int64  `json:"pointsBalance"`
	TodayGamesPlayed    int64  `json:"todayGamesPlayed"`
	TodayPointsEarned   int64  `json:"todayPointsEarned"`
	LatestPointChange   *int64 `json:"latestPointChange"`
	LatestPointChangeAt *int64 `json:"latestPointChangeAt"`
	LastClaimAt         *int64 `json:"lastClaimAt"`
	LastLotteryAt       *int64 `json:"lastLotteryAt"`
	LastActivityAt      int64  `json:"lastActivityAt"`
}

type StatsSummary struct {
	Total            int64 `json:"total"`
	NewUserCount     int64 `json:"newUserCount"`
	ClaimedUserCount int64 `json:"claimedUserCount"`
}

type Pagination struct {
	Page       int64 `json:"page"`
	Limit      int64 `json:"limit"`
	Total      int64 `json:"total"`
	TotalPages int64 `json:"totalPages"`
	HasMore    bool  `json:"hasMore"`
}

type ListUsersResult struct {
	Users      []UserWithStats `json:"users"`
	Pagination Pagination      `json:"pagination"`
	Stats      *StatsSummary   `json:"stats,omitempty"`
}

type ClaimRecord struct {
	ID              string `json:"id"`
	ProjectID       string `json:"projectId"`
	ProjectName     string `json:"projectName"`
	UserID          int64  `json:"userId"`
	Username        string `json:"username"`
	Code            string `json:"code"`
	ClaimedAt       int64  `json:"claimedAt"`
	DirectCredit    bool   `json:"directCredit,omitempty"`
	CreditedPoints  *int64 `json:"creditedPoints,omitempty"`
	CreditedDollars *int64 `json:"creditedDollars,omitempty"`
	CreditStatus    string `json:"creditStatus,omitempty"`
}

type LotteryRecord struct {
	ID            string `json:"id"`
	OderID        string `json:"oderId"`
	Username      string `json:"username"`
	TierName      string `json:"tierName"`
	TierValue     int64  `json:"tierValue"`
	Code          string `json:"code"`
	DirectCredit  bool   `json:"directCredit,omitempty"`
	CreditedQuota *int64 `json:"creditedQuota,omitempty"`
	PointsAwarded *int64 `json:"pointsAwarded,omitempty"`
	CreatedAt     int64  `json:"createdAt"`
}

type ExchangeLog struct {
	ID         string `json:"id"`
	UserID     int64  `json:"userId"`
	ItemID     string `json:"itemId"`
	ItemName   string `json:"itemName"`
	PointsCost int64  `json:"pointsCost"`
	Value      int64  `json:"value"`
	Type       string `json:"type"`
	CreatedAt  int64  `json:"createdAt"`
}

type AchievementItem struct {
	ID         string `json:"id"`
	Emoji      string `json:"emoji"`
	Name       string `json:"name"`
	Desc       string `json:"desc"`
	UnlockMode string `json:"unlockMode"`
	Unlocked   bool   `json:"unlocked"`
	Shine      bool   `json:"shine,omitempty"`
	Series     string `json:"series,omitempty"`
	GrantedAt  *int64 `json:"grantedAt"`
	ExpiresAt  *int64 `json:"expiresAt"`
	Equipped   bool   `json:"equipped"`
}

type UserDetailUser struct {
	ID               int64   `json:"id"`
	Username         string  `json:"username"`
	FirstSeen        int64   `json:"firstSeen"`
	DisplayName      *string `json:"displayName"`
	AvatarURL        *string `json:"avatarUrl"`
	QQEmail          *string `json:"qqEmail"`
	IsNewUser        bool    `json:"isNewUser"`
	NewUserStatus    string  `json:"newUserStatus"`
	NewUserProjectID *string `json:"newUserProjectId"`
	NewUserClaimedAt *int64  `json:"newUserClaimedAt"`
}

type ProfileOverview struct {
	User          ProfileUserOverview          `json:"user"`
	Points        ProfilePointsOverview        `json:"points"`
	Cards         ProfileCardsOverview         `json:"cards"`
	Gameplay      ProfileGameplayOverview      `json:"gameplay"`
	Notifications ProfileNotificationsOverview `json:"notifications"`
}

type ProfileUserOverview struct {
	ID                int64   `json:"id"`
	Username          string  `json:"username"`
	CustomDisplayName *string `json:"customDisplayName"`
	CustomAvatarURL   *string `json:"customAvatarUrl"`
	CustomQQEmail     *string `json:"customQqEmail"`
}

type ProfilePointsOverview struct {
	Balance    int64                 `json:"balance"`
	RecentLogs []ProfilePointLogItem `json:"recentLogs"`
}

type ProfilePointLogItem struct {
	Amount      int64  `json:"amount"`
	Source      string `json:"source"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
}

type ProfileCardsOverview struct {
	Owned          int64 `json:"owned"`
	Total          int64 `json:"total"`
	Fragments      int64 `json:"fragments"`
	DrawsAvailable int64 `json:"drawsAvailable"`
	CompletionRate int64 `json:"completionRate"`
}

type ProfileGameplayOverview struct {
	CheckinStreak    int64               `json:"checkinStreak"`
	TotalCheckinDays int64               `json:"totalCheckinDays"`
	RecentRecords    []ProfileGameRecord `json:"recentRecords"`
}

type ProfileGameRecord struct {
	GameType     string `json:"gameType"`
	Score        int64  `json:"score"`
	PointsEarned int64  `json:"pointsEarned"`
	CreatedAt    int64  `json:"createdAt"`
}

type ProfileNotificationsOverview struct {
	UnreadCount int64               `json:"unreadCount"`
	Recent      []ProfileNoticeItem `json:"recent"`
}

type ProfileNoticeItem struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	CreatedAt int64  `json:"createdAt"`
	IsRead    bool   `json:"isRead"`
}

type UserDetail struct {
	User           UserDetailUser    `json:"user"`
	Overview       ProfileOverview   `json:"overview"`
	Claims         []ClaimRecord     `json:"claims"`
	LotteryRecords []LotteryRecord   `json:"lotteryRecords"`
	ExchangeLogs   []ExchangeLog     `json:"exchangeLogs"`
	Achievements   []AchievementItem `json:"achievements"`
}
