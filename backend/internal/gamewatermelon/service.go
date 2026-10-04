package gamewatermelon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"redemption/backend/internal/auth"
	"redemption/backend/internal/systemconfig"
)

var ErrUnavailable = errors.New("watermelon database unavailable")

type checkpointFailure string

func (e checkpointFailure) Error() string { return string(e) }

type Service struct{ db *pgxpool.Pool }

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// All actions acquire the account before the active session, so starts,
// checkpoints and duplicate settlements serialize in the same order.
func (s *Service) transact(ctx context.Context, user auth.User, fn func(pgx.Tx) error) error {
	if s.db == nil {
		return ErrUnavailable
	}
	return s.withRetryableTx(ctx, func(tx pgx.Tx) error {
		if err := ensureUser(ctx, tx, user); err != nil {
			return err
		}
		if _, err := lockUserAccount(ctx, tx, user.ID); err != nil {
			return err
		}
		return fn(tx)
	})
}

func BuildSessionView(s Session) SessionView {
	return SessionView{s.ID, s.Seed, Version, TickRate, RequestLimits(), s.State.Tick, s.State.Drops, s.State, time.UnixMilli(s.ExpiresAt).UTC().Format(time.RFC3339Nano)}
}

func (s *Service) Start(ctx context.Context, user auth.User) (SessionView, error) {
	var out SessionView
	err := s.transact(ctx, user, func(tx pgx.Tx) error {
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		// A lost start response must recover the same round.
		if active != nil {
			out = BuildSessionView(*active)
			return nil
		}
		remaining, err := cooldownRemaining(ctx, tx, user.ID, time.Now())
		if err != nil {
			return err
		}
		if remaining > 0 {
			return checkpointFailure(fmt.Sprintf("请等待 %d 秒后再开始游戏", remaining))
		}
		seed, now := randomHex(16), time.Now().UnixMilli()
		round := Session{ID: randomHex(16), UserID: user.ID, GameType: GameType, Seed: seed, StartedAt: now, ExpiresAt: now + sessionTTLSeconds*1000, Status: "playing", State: Initial(seed)}
		if err := saveSession(ctx, tx, round); err != nil {
			return err
		}
		out = BuildSessionView(round)
		return nil
	})
	return out, err
}

func (s *Service) Status(ctx context.Context, user auth.User) (StatusData, error) {
	out := StatusData{UserID: user.ID, RewardDivisor: RewardDivisor, MaxRoundPoints: MaxRoundPoints}
	err := s.transact(ctx, user, func(tx pgx.Tx) error {
		var err error
		if out.Balance, err = getBalance(ctx, tx, user.ID); err != nil {
			return err
		}
		if out.DailyStats, err = getDailyStats(ctx, tx, user.ID); err != nil {
			return err
		}
		if out.DailyLimit, err = systemconfig.DailyPointsLimit(ctx, tx); err != nil {
			return err
		}
		earned, err := getDailyGamePointsEarned(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		out.DailyRemaining = max(0, out.DailyLimit-earned)
		out.PointsLimitReached = out.DailyRemaining == 0
		if out.CooldownRemaining, err = cooldownRemaining(ctx, tx, user.ID, time.Now()); err != nil {
			return err
		}
		if out.Records, err = listRecords(ctx, tx, user.ID, 10); err != nil {
			return err
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active != nil {
			view := BuildSessionView(*active)
			out.ActiveSession = &view
		}
		return nil
	})
	return out, err
}

func advanceSession(session Session, input SubmitInput, now time.Time) (Session, error) {
	if input.BaseTick != session.State.Tick || input.BaseMoves != session.State.Drops {
		return session, checkpointFailure("进度已更新，请重新连接恢复本局")
	}
	// Checkpoints never reset the clock allowance; fast-forwarded inputs cannot
	// manufacture a long game instantly. Paused wall time is intentionally free.
	if int64(input.ToTick) > max(0, now.UnixMilli()-session.StartedAt)*TickRate/1000+2*TickRate {
		return session, checkpointFailure("游戏进度过快，请稍后重试")
	}
	state, err := Replay(session.Seed, session.State, input.ToTick, input.Drops)
	if err != nil {
		return session, err
	}
	session.State = state
	session.ExpiresAt = now.UnixMilli() + sessionTTLSeconds*1000
	return session, nil
}

func (s *Service) mutate(ctx context.Context, user auth.User, input SubmitInput, settle bool) (SessionView, SubmitResult, error) {
	var view SessionView
	var result SubmitResult
	if input.SessionID == "" || len(input.SessionID) > 128 || input.Drops == nil {
		return view, result, ErrInvalidInput
	}
	if err := ValidateSegment(input.BaseTick, input.BaseMoves, input.ToTick, input.Drops); err != nil {
		return view, result, err
	}
	err := s.transact(ctx, user, func(tx pgx.Tx) error {
		if settle {
			record, err := findRecordForUpdateBySession(ctx, tx, user.ID, input.SessionID)
			if err != nil {
				return err
			}
			if record != nil {
				result = SubmitResult{record, record.PointsEarned}
				return nil
			}
		}
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active == nil || active.ID != input.SessionID || active.UserID != user.ID || active.Status != "playing" {
			return checkpointFailure("本局已结束或过期，请重新开始")
		}
		now := time.Now()
		next, err := advanceSession(*active, input, now)
		if err != nil {
			return err
		}
		if !settle {
			if err := updateSessionPayload(ctx, tx, next); err != nil {
				return err
			}
			view = BuildSessionView(next)
			return nil
		}
		limit, err := systemconfig.DailyPointsLimit(ctx, tx)
		if err != nil {
			return err
		}
		points, daily, err := addGamePointsWithLimit(ctx, tx, user, CalculatePointReward(next.State.Score), limit, fmt.Sprintf("软软西瓜 得分 %d，最高合成 %d", next.State.Score, next.State.HighestTile()))
		if err != nil {
			return err
		}
		record := Record{ID: randomHex(16), UserID: user.ID, SessionID: next.ID, GameType: GameType, Score: next.State.Score, PointsEarned: points, HighestTile: next.State.HighestTile(), Moves: next.State.Drops, Won: next.State.Highest == 8, GameOver: next.State.Phase == "over", Duration: int64(next.State.Tick) * 1000 / TickRate, CreatedAt: now.UnixMilli()}
		raw, err := json.Marshal(record)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO game_records (id,user_id,session_id,game_type,difficulty,score,points_earned,payload,created_at) VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8)`, record.ID, user.ID, next.ID, GameType, record.Score, points, raw, now); err != nil {
			return err
		}
		if err := incrementDailyStats(ctx, tx, user.ID, record.Score, daily, now); err != nil {
			return err
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, next.ID); err != nil {
			return err
		}
		if err := setCooldown(ctx, tx, user.ID, now.Add(time.Duration(cooldownTTLSeconds)*time.Second)); err != nil {
			return err
		}
		result = SubmitResult{&record, points}
		return nil
	})
	return view, result, err
}

func (s *Service) Checkpoint(ctx context.Context, user auth.User, input SubmitInput) (SessionView, error) {
	view, _, err := s.mutate(ctx, user, input, false)
	return view, err
}
func (s *Service) Submit(ctx context.Context, user auth.User, input SubmitInput) (SubmitResult, error) {
	_, result, err := s.mutate(ctx, user, input, true)
	return result, err
}
func (s *Service) Cancel(ctx context.Context, user auth.User, sessionID string) error {
	return s.transact(ctx, user, func(tx pgx.Tx) error {
		active, err := getActiveSessionForUpdate(ctx, tx, user.ID)
		if err != nil {
			return err
		}
		if active == nil {
			return nil
		}
		if active.ID != sessionID {
			return checkpointFailure("当前对局已变化，请重新连接")
		}
		if err := deleteSessionAndActive(ctx, tx, user.ID, active.ID); err != nil {
			return err
		}
		return setCooldown(ctx, tx, user.ID, time.Now().Add(time.Duration(cooldownTTLSeconds)*time.Second))
	})
}

func IsClientError(err error) bool {
	var failure checkpointFailure
	return errors.As(err, &failure) || errors.Is(err, ErrInvalidInput) || errors.Is(err, ErrInvalidSnapshot)
}
