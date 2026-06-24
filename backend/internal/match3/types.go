package match3

type Config struct {
	Rows  int `json:"rows"`
	Cols  int `json:"cols"`
	Types int `json:"types"`
}

type Move struct {
	From int `json:"from"`
	To   int `json:"to"`
}

type Session struct {
	ID          string `json:"id"`
	UserID      int64  `json:"userId"`
	GameType    string `json:"gameType"`
	Seed        string `json:"seed"`
	Config      Config `json:"config"`
	TimeLimitMs int64  `json:"timeLimitMs"`
	StartedAt   int64  `json:"startedAt"`
	ExpiresAt   int64  `json:"expiresAt"`
	Status      string `json:"status"`
}

type SessionView struct {
	SessionID   string `json:"sessionId"`
	Seed        string `json:"seed"`
	Config      Config `json:"config"`
	TimeLimitMs int64  `json:"timeLimitMs"`
	StartedAt   int64  `json:"startedAt"`
	ExpiresAt   int64  `json:"expiresAt"`
}

type Record struct {
	ID           string `json:"id"`
	UserID       int64  `json:"userId,omitempty"`
	SessionID    string `json:"sessionId,omitempty"`
	GameType     string `json:"gameType,omitempty"`
	Score        int64  `json:"score"`
	PointsEarned int64  `json:"pointsEarned"`
	Moves        int64  `json:"moves"`
	Cascades     int64  `json:"cascades"`
	TilesCleared int64  `json:"tilesCleared"`
	Duration     int64  `json:"duration"`
	CreatedAt    int64  `json:"createdAt"`
}

type SubmitInput struct {
	SessionID string `json:"sessionId"`
	Moves     []Move `json:"moves"`
}

type Stats struct {
	MovesApplied int64 `json:"movesApplied"`
	Cascades     int64 `json:"cascades"`
	TilesCleared int64 `json:"tilesCleared"`
}

type SimulationResult struct {
	OK         bool
	Message    string
	Score      int64
	FinalBoard []int
	Stats      Stats
}

type DailyStats struct {
	UserID       int64  `json:"userId"`
	Date         string `json:"date"`
	GamesPlayed  int64  `json:"gamesPlayed"`
	TotalScore   int64  `json:"totalScore"`
	PointsEarned int64  `json:"pointsEarned"`
	LastGameAt   int64  `json:"lastGameAt"`
}

type StatusData struct {
	Balance            int64        `json:"balance"`
	DailyStats         DailyStats   `json:"dailyStats"`
	InCooldown         bool         `json:"inCooldown"`
	CooldownRemaining  int64        `json:"cooldownRemaining"`
	DailyLimit         int64        `json:"dailyLimit"`
	PointsLimitReached bool         `json:"pointsLimitReached"`
	Records            []Record     `json:"records"`
	ActiveSession      *SessionView `json:"activeSession"`
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type SimpleResult struct {
	Success bool
	Message string
}

type SubmitResult struct {
	Success      bool
	Message      string
	Record       *Record
	PointsEarned int64
}
