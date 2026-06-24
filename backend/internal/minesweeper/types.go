package minesweeper

type Difficulty string
type Status string
type CellDisplay string
type ActionType string

const (
	GameType = "minesweeper"
	Version  = 1

	MaxActions      = 999
	MaxBatchActions = 24

	DifficultyEasy   Difficulty = "easy"
	DifficultyNormal Difficulty = "normal"
	DifficultyHard   Difficulty = "hard"

	StatusPlaying Status = "playing"
	StatusWon     Status = "won"
	StatusLost    Status = "lost"

	DisplayHidden   CellDisplay = "hidden"
	DisplayFlagged  CellDisplay = "flagged"
	DisplayRevealed CellDisplay = "revealed"
	DisplayMine     CellDisplay = "mine"
	DisplayExploded CellDisplay = "exploded"

	ActionReveal ActionType = "reveal"
	ActionFlag   ActionType = "flag"
	ActionChord  ActionType = "chord"
)

type DifficultyConfig struct {
	ID               Difficulty `json:"id"`
	Label            string     `json:"label"`
	Rows             int        `json:"rows"`
	Cols             int        `json:"cols"`
	Mines            int        `json:"mines"`
	BaseScore        int64      `json:"baseScore"`
	TimeLimitSeconds int64      `json:"timeLimitSeconds"`
}

type Position struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

type Cell struct {
	Row      int  `json:"row"`
	Col      int  `json:"col"`
	Mine     bool `json:"mine"`
	Adjacent int  `json:"adjacent"`
	Revealed bool `json:"revealed"`
	Flagged  bool `json:"flagged"`
}

type CellView struct {
	Row      int         `json:"row"`
	Col      int         `json:"col"`
	Display  CellDisplay `json:"display"`
	Adjacent int         `json:"adjacent"`
}

type GameState struct {
	Version         int        `json:"version"`
	Seed            string     `json:"seed"`
	Difficulty      Difficulty `json:"difficulty"`
	Rows            int        `json:"rows"`
	Cols            int        `json:"cols"`
	Mines           int        `json:"mines"`
	Status          Status     `json:"status"`
	FirstRevealDone bool       `json:"firstRevealDone"`
	FirstReveal     *Position  `json:"firstReveal,omitempty"`
	Cells           []Cell     `json:"cells"`
	RevealedSafe    int        `json:"revealedSafe"`
	FlagsUsed       int        `json:"flagsUsed"`
	Moves           int        `json:"moves"`
	Exploded        *Position  `json:"exploded,omitempty"`
	EndedAt         *int64     `json:"endedAt,omitempty"`
}

type Action struct {
	Type     ActionType `json:"type"`
	Position Position   `json:"position"`
}

type ActionOutcome struct {
	Type          ActionType `json:"type"`
	Message       string     `json:"message"`
	RevealedDelta int        `json:"revealedDelta"`
	FlagDelta     int        `json:"flagDelta"`
	Status        Status     `json:"status"`
}

type ActionResult struct {
	OK      bool
	State   GameState
	Outcome ActionOutcome
	Message string
}

type ActionBatchResult struct {
	OK             bool
	State          GameState
	AppliedActions []Action
	Outcomes       []ActionOutcome
	Skipped        int
	Message        string
}

type ScoreBreakdown struct {
	DifficultyBase int64 `json:"difficultyBase"`
	RevealPoints   int64 `json:"revealPoints"`
	FlagPoints     int64 `json:"flagPoints"`
	TimeBonus      int64 `json:"timeBonus"`
	WinBonus       int64 `json:"winBonus"`
	Total          int64 `json:"total"`
}

type StateView struct {
	Difficulty   Difficulty `json:"difficulty"`
	Rows         int        `json:"rows"`
	Cols         int        `json:"cols"`
	Mines        int        `json:"mines"`
	Status       Status     `json:"status"`
	Cells        []CellView `json:"cells"`
	RevealedSafe int        `json:"revealedSafe"`
	FlagsUsed    int        `json:"flagsUsed"`
	Moves        int        `json:"moves"`
	Exploded     *Position  `json:"exploded,omitempty"`
	EndedAt      *int64     `json:"endedAt,omitempty"`
}

type Session struct {
	ID         string     `json:"id"`
	UserID     int64      `json:"userId"`
	GameType   string     `json:"gameType"`
	Difficulty Difficulty `json:"difficulty"`
	Seed       string     `json:"seed"`
	StartedAt  int64      `json:"startedAt"`
	ExpiresAt  int64      `json:"expiresAt"`
	Status     string     `json:"status"`
	State      GameState  `json:"state"`
	Actions    []Action   `json:"actions"`
}

type SessionView struct {
	SessionID          string          `json:"sessionId"`
	Difficulty         Difficulty      `json:"difficulty"`
	StartedAt          int64           `json:"startedAt"`
	ExpiresAt          int64           `json:"expiresAt"`
	ActionsCount       int             `json:"actionsCount"`
	State              StateView       `json:"state"`
	ScorePreview       *ScoreBreakdown `json:"scorePreview,omitempty"`
	PointRewardPreview *int64          `json:"pointRewardPreview,omitempty"`
}

type Record struct {
	ID             string         `json:"id"`
	UserID         int64          `json:"userId,omitempty"`
	SessionID      string         `json:"sessionId,omitempty"`
	GameType       string         `json:"gameType,omitempty"`
	Difficulty     Difficulty     `json:"difficulty"`
	Won            bool           `json:"won"`
	Score          int64          `json:"score"`
	PointsEarned   int64          `json:"pointsEarned"`
	Duration       int64          `json:"duration"`
	Moves          int            `json:"moves"`
	FlagsUsed      int            `json:"flagsUsed"`
	RevealedSafe   int            `json:"revealedSafe"`
	Mines          int            `json:"mines"`
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
	SessionID string   `json:"sessionId"`
	Action    *Action  `json:"action,omitempty"`
	Actions   []Action `json:"actions,omitempty"`
}

type StepResult struct {
	Success  bool
	Message  string
	Session  *SessionView
	Outcome  *ActionOutcome
	Outcomes []ActionOutcome
	Skipped  int
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
