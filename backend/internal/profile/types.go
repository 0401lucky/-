package profile

type PublicAchievement struct {
	ID        string `json:"id"`
	Emoji     string `json:"emoji"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	ExpiresAt *int64 `json:"expiresAt,omitempty"`
}

type SettingsData struct {
	DisplayName         *string            `json:"displayName"`
	AvatarURL           *string            `json:"avatarUrl"`
	QQEmail             *string            `json:"qqEmail"`
	EquippedAchievement *PublicAchievement `json:"equippedAchievement"`
	UpdatedAt           *int64             `json:"updatedAt"`
}

type EquipAchievementResult struct {
	EquippedID *string            `json:"equippedId"`
	Equipped   *PublicAchievement `json:"equipped"`
}

type OverviewData struct {
	User             OverviewUser             `json:"user"`
	Points           OverviewPoints           `json:"points"`
	Cards            OverviewCards            `json:"cards"`
	Gameplay         OverviewGameplay         `json:"gameplay"`
	Notifications    OverviewNotifications    `json:"notifications"`
	AchievementStats OverviewAchievementStats `json:"achievementStats"`
	Achievements     AchievementSummary       `json:"achievements"`
}

type OverviewUser struct {
	ID                int64   `json:"id"`
	Username          string  `json:"username"`
	CustomDisplayName *string `json:"customDisplayName"`
	CustomAvatarURL   *string `json:"customAvatarUrl"`
	CustomQQEmail     *string `json:"customQqEmail"`
}

type OverviewPoints struct {
	Balance    int64              `json:"balance"`
	RecentLogs []OverviewPointLog `json:"recentLogs"`
}

type OverviewPointLog struct {
	Amount      int64  `json:"amount"`
	Source      string `json:"source"`
	Description string `json:"description"`
	CreatedAt   int64  `json:"createdAt"`
}

type OverviewCards struct {
	Owned          int64           `json:"owned"`
	Total          int64           `json:"total"`
	Fragments      int64           `json:"fragments"`
	DrawsAvailable int64           `json:"drawsAvailable"`
	CompletionRate float64         `json:"completionRate"`
	Albums         []OverviewAlbum `json:"albums"`
}

type OverviewAlbum struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Owned          int64   `json:"owned"`
	Total          int64   `json:"total"`
	CompletionRate float64 `json:"completionRate"`
}

type OverviewGameplay struct {
	CheckinStreak    int64                  `json:"checkinStreak"`
	TotalCheckinDays int64                  `json:"totalCheckinDays"`
	RecentRecords    []OverviewRecentRecord `json:"recentRecords"`
}

type OverviewRecentRecord struct {
	GameType     string `json:"gameType"`
	Score        int64  `json:"score"`
	PointsEarned int64  `json:"pointsEarned"`
	CreatedAt    int64  `json:"createdAt"`
}

type OverviewNotifications struct {
	UnreadCount int64                  `json:"unreadCount"`
	Recent      []OverviewNotification `json:"recent"`
}

type OverviewNotification struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	CreatedAt int64  `json:"createdAt"`
	IsRead    bool   `json:"isRead"`
}

type OverviewAchievementStats struct {
	GameWinRate            float64 `json:"gameWinRate"`
	GameWinPlays           int64   `json:"gameWinPlays"`
	FarmUnlockedLands      int64   `json:"farmUnlockedLands"`
	LotteryOrangeCount     int64   `json:"lotteryOrangeCount"`
	LotteryHeartCount      int64   `json:"lotteryHeartCount"`
	EcoLifetimeCleared     int64   `json:"ecoLifetimeCleared"`
	EcoLifetimePrizeClaims int64   `json:"ecoLifetimePrizeClaims"`
	EcoLifetimePhotoClaims int64   `json:"ecoLifetimePhotoClaims"`
}

type AchievementSummary struct {
	Grants     []AchievementGrantPublic `json:"grants"`
	EquippedID *string                  `json:"equippedId"`
	Equipped   *PublicAchievement       `json:"equipped"`
	Items      []AchievementItem        `json:"items"`
}

type AchievementGrantPublic struct {
	ID        string  `json:"id"`
	Source    string  `json:"source"`
	GrantedAt int64   `json:"grantedAt"`
	ExpiresAt *int64  `json:"expiresAt,omitempty"`
	Reason    *string `json:"reason,omitempty"`
}

type AchievementItem struct {
	ID         string `json:"id"`
	Emoji      string `json:"emoji"`
	Name       string `json:"name"`
	Desc       string `json:"desc"`
	Unlocked   bool   `json:"unlocked"`
	Shine      bool   `json:"shine,omitempty"`
	Series     string `json:"series,omitempty"`
	UnlockMode string `json:"unlockMode"`
	GrantedAt  *int64 `json:"grantedAt"`
	ExpiresAt  *int64 `json:"expiresAt"`
	Equipped   bool   `json:"equipped"`
}
