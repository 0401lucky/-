package memory

type Difficulty string

const (
	GameType = "memory"

	DifficultyEasy   Difficulty = "easy"
	DifficultyNormal Difficulty = "normal"
	DifficultyHard   Difficulty = "hard"
)

type DifficultyConfig struct {
	Rows           int   `json:"rows"`
	Cols           int   `json:"cols"`
	Pairs          int   `json:"pairs"`
	BaseScore      int64 `json:"baseScore"`
	PenaltyPerMove int64 `json:"penaltyPerMove"`
	MinScore       int64 `json:"minScore"`
	TimeLimit      int64 `json:"timeLimit"`
}

type Move struct {
	Card1     int   `json:"card1"`
	Card2     int   `json:"card2"`
	Matched   bool  `json:"matched"`
	Timestamp int64 `json:"timestamp"`
}

type Session struct {
	ID               string     `json:"id"`
	UserID           int64      `json:"userId"`
	GameType         string     `json:"gameType"`
	Difficulty       Difficulty `json:"difficulty"`
	Seed             string     `json:"seed"`
	CardLayout       []string   `json:"cardLayout"`
	FirstFlippedCard *int       `json:"firstFlippedCard"`
	MatchedCards     []int      `json:"matchedCards"`
	MoveLog          []Move     `json:"moveLog"`
	StartedAt        int64      `json:"startedAt"`
	ExpiresAt        int64      `json:"expiresAt"`
	Status           string     `json:"status"`
}

type SessionView struct {
	SessionID        string           `json:"sessionId"`
	Difficulty       Difficulty       `json:"difficulty"`
	CardLayout       []string         `json:"cardLayout"`
	MatchedCards     []int            `json:"matchedCards"`
	FirstFlippedCard *int             `json:"firstFlippedCard"`
	MoveCount        int              `json:"moveCount"`
	StartedAt        int64            `json:"startedAt"`
	ExpiresAt        int64            `json:"expiresAt"`
	Config           DifficultyConfig `json:"config"`
}

type FlipResult struct {
	CardIndex       int    `json:"cardIndex"`
	IconID          string `json:"iconId"`
	FirstCardIndex  *int   `json:"firstCardIndex,omitempty"`
	FirstCardIconID string `json:"firstCardIconId,omitempty"`
	Matched         bool   `json:"matched"`
	Completed       bool   `json:"completed"`
	MoveCount       int    `json:"moveCount"`
	MatchedCount    int    `json:"matchedCount"`
	Move            *Move  `json:"move,omitempty"`
}

type SubmitInput struct {
	SessionID string `json:"sessionId"`
	Moves     []Move `json:"moves"`
	Completed bool   `json:"completed"`
	Duration  int64  `json:"duration"`
}

type Record struct {
	ID           string     `json:"id"`
	UserID       int64      `json:"userId"`
	SessionID    string     `json:"sessionId"`
	GameType     string     `json:"gameType"`
	Difficulty   Difficulty `json:"difficulty"`
	Moves        int        `json:"moves"`
	Completed    bool       `json:"completed"`
	Score        int64      `json:"score"`
	PointsEarned int64      `json:"pointsEarned"`
	Duration     int64      `json:"duration"`
	CreatedAt    int64      `json:"createdAt"`
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

type FlipServiceResult struct {
	Success bool
	Message string
	Data    *FlipResult
}

type SubmitResult struct {
	Success      bool
	Message      string
	Record       *Record
	PointsEarned int64
}
