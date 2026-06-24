package gamesummary

type DailyStats struct {
	GamesPlayed  int64 `json:"gamesPlayed"`
	PointsEarned int64 `json:"pointsEarned"`
}

type OverviewData struct {
	Balance            int64      `json:"balance"`
	DailyStats         DailyStats `json:"dailyStats"`
	DailyLimit         int64      `json:"dailyLimit"`
	PointsLimitReached bool       `json:"pointsLimitReached"`
}

type GameProgress struct {
	TotalPlays        int64 `json:"totalPlays"`
	BestScore         int64 `json:"bestScore"`
	TotalPointsEarned int64 `json:"totalPointsEarned"`
	HasWinFlag        bool  `json:"hasWinFlag"`
	Wins              int64 `json:"wins"`
	BestWinStreak     int64 `json:"bestWinStreak"`
}

type ProfileData struct {
	Balance          int64                   `json:"balance"`
	DailyStats       DailyStats              `json:"dailyStats"`
	TotalGamesPlayed int64                   `json:"totalGamesPlayed"`
	PeakScore        int64                   `json:"peakScore"`
	PeakGame         *string                 `json:"peakGame"`
	FavoriteGame     *string                 `json:"favoriteGame"`
	MostWinsGame     *string                 `json:"mostWinsGame"`
	MostWinsCount    int64                   `json:"mostWinsCount"`
	BestStreakGame   *string                 `json:"bestStreakGame"`
	BestStreak       int64                   `json:"bestStreak"`
	WinRate          float64                 `json:"winRate"`
	PerGame          map[string]GameProgress `json:"perGame"`
}
