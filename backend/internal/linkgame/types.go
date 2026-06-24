package linkgame

type Difficulty string
type BoardMode string
type SettlementOutcome string
type SettlementResult string

const (
	GameType = "linkgame"

	DifficultyEasy   Difficulty = "easy"
	DifficultyNormal Difficulty = "normal"
	DifficultyHard   Difficulty = "hard"

	BoardModeClassic2D BoardMode = "classic2d"
	BoardModeStack3D   BoardMode = "stack3d"

	OutcomeCompleted SettlementOutcome = "completed"
	OutcomeDeadlock  SettlementOutcome = "deadlock"
	OutcomeTimeout   SettlementOutcome = "timeout"

	ResultWin  SettlementResult = "win"
	ResultLoss SettlementResult = "loss"
)

type LayerCell struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

type LayerConfig struct {
	Z        int         `json:"z"`
	RowStart int         `json:"rowStart"`
	ColStart int         `json:"colStart"`
	Rows     int         `json:"rows"`
	Cols     int         `json:"cols"`
	Cells    []LayerCell `json:"cells,omitempty"`
}

type DifficultyConfig struct {
	Rows      int           `json:"rows"`
	Cols      int           `json:"cols"`
	Pairs     int           `json:"pairs"`
	BaseScore int64         `json:"baseScore"`
	TimeLimit int64         `json:"timeLimit"`
	Mode      BoardMode     `json:"mode,omitempty"`
	Depth     int           `json:"depth,omitempty"`
	Layers    []LayerConfig `json:"layers,omitempty"`
}

type Position struct {
	Row int  `json:"row"`
	Col int  `json:"col"`
	Z   *int `json:"z,omitempty"`
}

type Move struct {
	Type      string    `json:"type,omitempty"`
	Pos1      Position  `json:"pos1"`
	Pos2      Position  `json:"pos2"`
	Pos3      *Position `json:"pos3,omitempty"`
	Matched   bool      `json:"matched"`
	IsTriple  bool      `json:"isTriple,omitempty"`
	Timestamp int64     `json:"timestamp"`
}

type Session struct {
	ID         string     `json:"id"`
	UserID     int64      `json:"userId"`
	GameType   string     `json:"gameType"`
	Difficulty Difficulty `json:"difficulty"`
	Seed       string     `json:"seed"`
	TileLayout []*string  `json:"tileLayout"`
	StartedAt  int64      `json:"startedAt"`
	ExpiresAt  int64      `json:"expiresAt"`
	Status     string     `json:"status"`
}

type SubmitInput struct {
	SessionID string            `json:"sessionId"`
	Moves     []Move            `json:"moves"`
	Completed bool              `json:"completed"`
	Outcome   SettlementOutcome `json:"outcome,omitempty"`
	Duration  int64             `json:"duration"`
}

type ValidationResult struct {
	OK           bool
	Message      string
	MatchedPairs int
	MaxStreak    int
	Completed    bool
	Deadlocked   bool
	Outcome      SettlementOutcome
}

type Record struct {
	ID               string            `json:"id"`
	UserID           int64             `json:"userId,omitempty"`
	SessionID        string            `json:"sessionId,omitempty"`
	GameType         string            `json:"gameType,omitempty"`
	Difficulty       Difficulty        `json:"difficulty"`
	Moves            int               `json:"moves"`
	Completed        bool              `json:"completed"`
	Outcome          SettlementOutcome `json:"outcome,omitempty"`
	SettlementResult SettlementResult  `json:"settlementResult,omitempty"`
	Score            int64             `json:"score"`
	PointsEarned     int64             `json:"pointsEarned"`
	Duration         int64             `json:"duration"`
	CreatedAt        int64             `json:"createdAt"`
}

type DailyStats struct {
	UserID       int64  `json:"userId,omitempty"`
	Date         string `json:"date,omitempty"`
	GamesPlayed  int64  `json:"gamesPlayed"`
	TotalScore   int64  `json:"totalScore,omitempty"`
	PointsEarned int64  `json:"pointsEarned"`
	LastGameAt   int64  `json:"lastGameAt,omitempty"`
}

type StatusData struct {
	Balance            int64        `json:"balance"`
	DailyStats         *DailyStats  `json:"dailyStats"`
	InCooldown         bool         `json:"inCooldown"`
	CooldownRemaining  int64        `json:"cooldownRemaining"`
	DailyLimit         int64        `json:"dailyLimit"`
	PointsLimitReached bool         `json:"pointsLimitReached"`
	ActiveSession      *SessionView `json:"activeSession"`
}

type SessionView struct {
	SessionID        string           `json:"sessionId"`
	Difficulty       Difficulty       `json:"difficulty"`
	TileLayout       []*string        `json:"tileLayout"`
	StartedAt        int64            `json:"startedAt"`
	ExpiresAt        int64            `json:"expiresAt"`
	PlayableUntil    int64            `json:"playableUntil"`
	RemainingSeconds int64            `json:"remainingSeconds"`
	Config           DifficultyConfig `json:"config"`
}

type StartInput struct {
	Difficulty Difficulty
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type SubmitResult struct {
	Success      bool
	Message      string
	Record       *Record
	PointsEarned int64
}

type SimpleResult struct {
	Success bool
	Message string
}
