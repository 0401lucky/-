package sudoku

type Difficulty string
type Status string
type ActionType string

const (
	GameType = "sudoku"
	Version  = 1

	DifficultyEasy   Difficulty = "easy"
	DifficultyNormal Difficulty = "normal"
	DifficultyHard   Difficulty = "hard"

	StatusPlaying Status = "playing"
	StatusWon     Status = "won"

	ActionSet   ActionType = "set"
	ActionErase ActionType = "erase"
	ActionNote  ActionType = "note"
)

type DifficultyConfig struct {
	ID               Difficulty `json:"id"`
	Label            string     `json:"label"`
	Clues            int        `json:"clues"`
	BaseScore        int64      `json:"baseScore"`
	TimeLimitSeconds int64      `json:"timeLimitSeconds"`
	MistakePenalty   int64      `json:"mistakePenalty"`
}

type Action struct {
	Type  ActionType `json:"type"`
	Index int        `json:"index"`
	Value int        `json:"value,omitempty"`
}

type Move struct {
	Action    Action `json:"action"`
	Timestamp int64  `json:"timestamp"`
}

type ScoreBreakdown struct {
	DifficultyBase int64 `json:"difficultyBase"`
	TimeBonus      int64 `json:"timeBonus"`
	MistakePenalty int64 `json:"mistakePenalty"`
	PerfectBonus   int64 `json:"perfectBonus"`
	Total          int64 `json:"total"`
}

type GameState struct {
	Version    int        `json:"version"`
	Seed       string     `json:"seed"`
	Difficulty Difficulty `json:"difficulty"`
	Puzzle     []int      `json:"puzzle"`
	Solution   []int      `json:"solution"`
	Board      []int      `json:"board"`
	Notes      [][]int    `json:"notes"`
	Errors     []bool     `json:"errors"`
	Status     Status     `json:"status"`
	Moves      int        `json:"moves"`
	Mistakes   int        `json:"mistakes"`
	EndedAt    *int64     `json:"endedAt,omitempty"`
}

type CellView struct {
	Index    int   `json:"index"`
	Value    int   `json:"value"`
	Given    bool  `json:"given"`
	Notes    []int `json:"notes,omitempty"`
	Error    bool  `json:"error,omitempty"`
	Conflict bool  `json:"conflict,omitempty"`
}

type StateView struct {
	Difficulty Difficulty `json:"difficulty"`
	Cells      []CellView `json:"cells"`
	Status     Status     `json:"status"`
	Moves      int        `json:"moves"`
	Mistakes   int        `json:"mistakes"`
	EndedAt    *int64     `json:"endedAt,omitempty"`
}

type Session struct {
	ID         string     `json:"id"`
	UserID     int64      `json:"userId"`
	GameType   string     `json:"gameType"`
	Difficulty Difficulty `json:"difficulty"`
	StartedAt  int64      `json:"startedAt"`
	ExpiresAt  int64      `json:"expiresAt"`
	Status     string     `json:"status"`
	State      GameState  `json:"state"`
	Moves      []Move     `json:"moves"`
}

type SessionView struct {
	SessionID          string          `json:"sessionId"`
	Difficulty         Difficulty      `json:"difficulty"`
	StartedAt          int64           `json:"startedAt"`
	ExpiresAt          int64           `json:"expiresAt"`
	State              StateView       `json:"state"`
	ScorePreview       *ScoreBreakdown `json:"scorePreview,omitempty"`
	PointRewardPreview *int64          `json:"pointRewardPreview,omitempty"`
}

type Record struct {
	ID             string         `json:"id"`
	UserID         int64          `json:"userId"`
	SessionID      string         `json:"sessionId"`
	GameType       string         `json:"gameType"`
	Difficulty     Difficulty     `json:"difficulty"`
	Completed      bool           `json:"completed"`
	Won            bool           `json:"won"`
	Score          int64          `json:"score"`
	PointsEarned   int64          `json:"pointsEarned"`
	Duration       int64          `json:"duration"`
	Moves          int            `json:"moves"`
	Mistakes       int            `json:"mistakes"`
	ScoreBreakdown ScoreBreakdown `json:"scoreBreakdown"`
	CreatedAt      int64          `json:"createdAt"`
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
	BestTimes          map[string]int64   `json:"bestTimes"`
	Balance            int64              `json:"balance"`
	DailyStats         DailyStats         `json:"dailyStats"`
	InCooldown         bool               `json:"inCooldown"`
	CooldownRemaining  int64              `json:"cooldownRemaining"`
	DailyLimit         int64              `json:"dailyLimit"`
	PointsLimitReached bool               `json:"pointsLimitReached"`
	Records            []Record           `json:"records"`
	Difficulties       []DifficultyConfig `json:"difficulties"`
	ActiveSession      *SessionView       `json:"activeSession"`
}

type StartInput struct {
	Restart    bool
	Difficulty Difficulty
}

type StartResult struct {
	Success bool
	Message string
	Session *Session
}

type StepInput struct {
	SessionID string `json:"sessionId"`
	Action    Action `json:"action"`
}

type StepResult struct {
	Success bool
	Message string
	Session *SessionView
	Action  *Action `json:"action,omitempty"`
}

type SubmitInput struct {
	SessionID string `json:"sessionId"`
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
