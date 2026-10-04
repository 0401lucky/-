package gamewatermelon

import "redemption/backend/internal/game2048"

const sessionTTLSeconds = int64(12 * 60 * 60)
const cooldownTTLSeconds = int64(5)
const maxRecordsListSize = 50
const defaultRecordsListSize = 10
const maxRetryableTxRetries = 4
const RewardDivisor = int64(16)
const MaxRoundPoints = int64(200)

type DailyStats = game2048.DailyStats

type Session struct {
	ID        string   `json:"id"`
	UserID    int64    `json:"userId"`
	GameType  string   `json:"gameType"`
	Seed      string   `json:"seed"`
	StartedAt int64    `json:"startedAt"`
	ExpiresAt int64    `json:"expiresAt"`
	Status    string   `json:"status"`
	State     Snapshot `json:"state"`
}

type SessionView struct {
	SessionID     string   `json:"session_id"`
	Seed          string   `json:"seed"`
	EngineVersion string   `json:"engine_version"`
	TickRate      int      `json:"tick_rate"`
	Limits        *Limits  `json:"limits"`
	BaseTick      int      `json:"base_tick"`
	BaseMoves     int      `json:"base_moves"`
	State         Snapshot `json:"state"`
	ExpiresAt     string   `json:"expires_at"`
}

type Record struct {
	ID           string `json:"id"`
	UserID       int64  `json:"userId"`
	SessionID    string `json:"sessionId"`
	GameType     string `json:"gameType"`
	Score        int64  `json:"score"`
	PointsEarned int64  `json:"pointsEarned"`
	HighestTile  int    `json:"highestTile"`
	Moves        int    `json:"moves"`
	Won          bool   `json:"won"`
	GameOver     bool   `json:"gameOver"`
	Duration     int64  `json:"duration"`
	CreatedAt    int64  `json:"createdAt"`
}

type StatusData struct {
	UserID             int64        `json:"userId"`
	Balance            int64        `json:"balance"`
	DailyStats         DailyStats   `json:"dailyStats"`
	DailyLimit         int64        `json:"dailyLimit"`
	DailyRemaining     int64        `json:"dailyRemaining"`
	PointsLimitReached bool         `json:"pointsLimitReached"`
	CooldownRemaining  int64        `json:"cooldownRemaining"`
	RewardDivisor      int64        `json:"rewardDivisor"`
	MaxRoundPoints     int64        `json:"maxRoundPoints"`
	Records            []Record     `json:"records"`
	ActiveSession      *SessionView `json:"active_session"`
}

type SubmitInput struct {
	SessionID string `json:"session_id"`
	BaseTick  int    `json:"base_tick"`
	BaseMoves int    `json:"base_moves"`
	ToTick    int    `json:"to_tick"`
	Drops     []Drop `json:"drops"`
}

type SubmitResult struct {
	Record       *Record `json:"record"`
	PointsEarned int64   `json:"pointsEarned"`
}

func CalculatePointReward(score int64) int64 {
	return min(MaxRoundPoints, max(0, score/RewardDivisor))
}
