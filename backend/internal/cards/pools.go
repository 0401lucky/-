package cards

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	DrawPoolStandard = "standard"
	DrawPoolLimited  = "limited"
	MaxPoolDrawCost  = 100
)

var (
	ErrInvalidDrawPool     = errors.New("无效的卡池")
	ErrDrawPoolUnavailable = errors.New("限定卡池未开放")
)

type LimitedPoolSettings struct {
	Enabled  bool   `json:"enabled"`
	AlbumID  string `json:"albumId"`
	DrawCost int64  `json:"drawCost"`
	StartsAt int64  `json:"startsAt"`
	EndsAt   int64  `json:"endsAt"`
}

func DefaultLimitedPool() LimitedPoolSettings {
	// 开放时间由数据库迁移持久化，缺失配置时保持关闭。
	return LimitedPoolSettings{AlbumID: hokModernAlbumID, DrawCost: 2}
}

func ValidateLimitedPool(pool LimitedPoolSettings) error {
	if !AlbumExists(pool.AlbumID) {
		return fmt.Errorf("%w: 请选择有效的限定卡册", ErrInvalidAdminCardInput)
	}
	if pool.DrawCost < 1 || pool.DrawCost > MaxPoolDrawCost {
		return fmt.Errorf("%w: 限定池单抽消耗须为 1～%d 次", ErrInvalidAdminCardInput, MaxPoolDrawCost)
	}
	if !pool.Enabled && pool.StartsAt == 0 && pool.EndsAt == 0 {
		return nil
	}
	if pool.StartsAt <= 0 || pool.EndsAt <= pool.StartsAt || pool.EndsAt > 253402300799999 {
		return fmt.Errorf("%w: 请设置有效的开放时间，结束时间须晚于开始时间", ErrInvalidAdminCardInput)
	}
	return nil
}

func IsDrawPoolID(poolID string) bool {
	switch strings.TrimSpace(poolID) {
	case "", DrawPoolStandard, DrawPoolLimited:
		return true
	default:
		return false
	}
}

func decodeLimitedPool(raw []byte) LimitedPoolSettings {
	pool := DefaultLimitedPool()
	if err := json.Unmarshal(raw, &pool); err != nil || ValidateLimitedPool(pool) != nil {
		return DefaultLimitedPool()
	}
	return pool
}

func ApplyPoolDraws(state UserState, rules Rules, catalog []Card, poolID string, count int, rng RandomSource, now time.Time) (DrawOutcome, error) {
	if !IsDrawPoolID(poolID) {
		return DrawOutcome{}, ErrInvalidDrawPool
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	limited := strings.TrimSpace(poolID) == DrawPoolLimited
	pool := rules.LimitedPool
	cost := int64(1)
	if limited {
		if !pool.Enabled || ValidateLimitedPool(pool) != nil {
			return DrawOutcome{}, ErrDrawPoolUnavailable
		}
		if now.UnixMilli() < pool.StartsAt {
			return DrawOutcome{}, fmt.Errorf("%w: 尚未开始", ErrDrawPoolUnavailable)
		}
		if now.UnixMilli() >= pool.EndsAt {
			return DrawOutcome{}, fmt.Errorf("%w: 已结束", ErrDrawPoolUnavailable)
		}
		cost = pool.DrawCost
	}

	poolCards := make([]Card, 0, len(catalog))
	for _, card := range catalog {
		if (card.AlbumID == pool.AlbumID) == limited {
			poolCards = append(poolCards, card)
		}
	}
	return applyDrawsWithCost(state, rules, poolCards, count, cost, rng, now)
}
