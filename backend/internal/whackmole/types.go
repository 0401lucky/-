package whackmole

type Difficulty string

const (
	GameType = "whack_mole"

	DifficultyEasy   Difficulty = "easy"
	DifficultyNormal Difficulty = "normal"
	DifficultyHard   Difficulty = "hard"
)

type Cell string

const (
	CellEmpty  Cell = "empty"
	CellMole   Cell = "mole"
	CellGolden Cell = "golden"
	CellBomb   Cell = "bomb"
)

type HitResult string

const (
	HitResultHit       HitResult = "hit"
	HitResultGoldenHit HitResult = "golden_hit"
	HitResultBomb      HitResult = "bomb"
	HitResultMiss      HitResult = "miss"
	HitResultDuplicate HitResult = "duplicate"
)

type DifficultyConfig struct {
	Label                     string  `json:"label"`
	ShortLabel                string  `json:"shortLabel"`
	Description               string  `json:"description"`
	DurationMs                int64   `json:"durationMs"`
	StartRefreshMs            int64   `json:"startRefreshMs"`
	EndRefreshMs              int64   `json:"endRefreshMs"`
	MinBombs                  int64   `json:"minBombs"`
	MaxBombs                  int64   `json:"maxBombs"`
	NormalPoints              int64   `json:"normalPoints"`
	GoldenPoints              int64   `json:"goldenPoints"`
	BombPenalty               int64   `json:"bombPenalty"`
	ComboBonusStep            int64   `json:"comboBonusStep"`
	MaxComboBonus             int64   `json:"maxComboBonus"`
	WinScore                  int64   `json:"winScore"`
	RewardDivisor             int64   `json:"rewardDivisor"`
	ActiveTargetBase          int64   `json:"activeTargetBase"`
	ActiveTargetGrowthSeconds int64   `json:"activeTargetGrowthSeconds"`
	ActiveTargetMax           int64   `json:"activeTargetMax"`
	ExtraTargetThreshold      float64 `json:"extraTargetThreshold"`
	GoldenThreshold           float64 `json:"goldenThreshold"`
}

type HitEvent struct {
	Index     int   `json:"index"`
	ElapsedMs int64 `json:"elapsedMs"`
}

type ScoredEvent struct {
	Index      int       `json:"index"`
	ElapsedMs  int64     `json:"elapsedMs"`
	TickIndex  int64     `json:"tickIndex"`
	Cell       Cell      `json:"cell"`
	Result     HitResult `json:"result"`
	ScoreDelta int64     `json:"scoreDelta"`
	ComboAfter int64     `json:"comboAfter"`
}

type ScoreStats struct {
	Hits       int64 `json:"hits"`
	GoldenHits int64 `json:"goldenHits"`
	Misses     int64 `json:"misses"`
	Bombs      int64 `json:"bombs"`
	MaxCombo   int64 `json:"maxCombo"`
}

type ScoreResult struct {
	Score  int64         `json:"score"`
	Combo  int64         `json:"combo"`
	Stats  ScoreStats    `json:"stats"`
	Events []ScoredEvent `json:"events"`
}

type Session struct {
	ID         string     `json:"id"`
	UserID     int64      `json:"userId"`
	GameType   string     `json:"gameType"`
	Seed       string     `json:"seed"`
	Difficulty Difficulty `json:"difficulty"`
	StartedAt  int64      `json:"startedAt"`
	ExpiresAt  int64      `json:"expiresAt"`
	Status     string     `json:"status"`
	Events     []HitEvent `json:"events"`
}

type SessionView struct {
	SessionID   string     `json:"sessionId"`
	Seed        string     `json:"seed"`
	StartedAt   int64      `json:"startedAt"`
	ExpiresAt   int64      `json:"expiresAt"`
	DurationMs  int64      `json:"durationMs"`
	Difficulty  Difficulty `json:"difficulty"`
	Board       []Cell     `json:"board"`
	BoardTick   int64      `json:"boardTick"`
	TimeLeftMs  int64      `json:"timeLeftMs"`
	Score       int64      `json:"score"`
	Combo       int64      `json:"combo"`
	EventsCount int        `json:"eventsCount"`
}

type Record struct {
	ID           string     `json:"id"`
	UserID       int64      `json:"userId,omitempty"`
	SessionID    string     `json:"sessionId,omitempty"`
	GameType     string     `json:"gameType,omitempty"`
	Difficulty   Difficulty `json:"difficulty"`
	Score        int64      `json:"score"`
	PointsEarned int64      `json:"pointsEarned"`
	Hits         int64      `json:"hits"`
	GoldenHits   int64      `json:"goldenHits"`
	Misses       int64      `json:"misses"`
	Bombs        int64      `json:"bombs"`
	MaxCombo     int64      `json:"maxCombo"`
	Duration     int64      `json:"duration"`
	CreatedAt    int64      `json:"createdAt"`
}

type SubmitInput struct {
	SessionID string     `json:"sessionId"`
	Events    []HitEvent `json:"events"`
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

type StartInput struct {
	Restart    bool
	Difficulty Difficulty
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
