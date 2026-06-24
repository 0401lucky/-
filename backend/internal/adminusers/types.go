package adminusers

type UserWithStats struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	FirstSeen    int64  `json:"firstSeen"`
	ClaimsCount  int64  `json:"claimsCount"`
	LotteryCount int64  `json:"lotteryCount"`
	IsNewUser    bool   `json:"isNewUser"`
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
	ID           string `json:"id"`
	ProjectID    string `json:"projectId"`
	ProjectName  string `json:"projectName"`
	UserID       int64  `json:"userId"`
	Username     string `json:"username"`
	Code         string `json:"code"`
	ClaimedAt    int64  `json:"claimedAt"`
	DirectCredit bool   `json:"directCredit,omitempty"`
}

type LotteryRecord struct {
	ID        string `json:"id"`
	OderID    string `json:"oderId"`
	Username  string `json:"username"`
	TierName  string `json:"tierName"`
	TierValue int64  `json:"tierValue"`
	Code      string `json:"code"`
	CreatedAt int64  `json:"createdAt"`
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

type UserDetail struct {
	Claims         []ClaimRecord     `json:"claims"`
	LotteryRecords []LotteryRecord   `json:"lotteryRecords"`
	Achievements   []AchievementItem `json:"achievements"`
}
