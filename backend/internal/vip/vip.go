// Package vip 提供站内 VIP 会籍的查询与续期。
//
// 本包只做「查状态 + 续期」，不含购买用例：扣积分的能力在 economy 包，
// 若这里提供 Purchase 就会形成 vip ↔ economy 的循环依赖。
// 购买由 economy.PurchaseVIP 在自己的事务里扣分后调用 Extend，保持单向依赖。
package vip

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Status 描述用户当前的 VIP 会籍状态。
type Status struct {
	Active bool `json:"active"`
	// ExpiresAt 是毫秒时间戳。从未购买过时为 nil；
	// 会籍到期后行仍保留，此时 Active 为 false 但 ExpiresAt 非 nil。
	ExpiresAt *int64 `json:"expiresAt,omitempty"`
}

// QueryRower 让查询既能用连接池，也能用调用方的事务。
type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// GetExpiry 返回未截断的原始到期时间。
// ok 为 false 表示该用户从未购买过 VIP。
// 需要对到期时间做算术的调用方必须用这个函数而不是 Get —— Status.ExpiresAt
// 是毫秒精度，而数据库是微秒精度，截断会让计算结果与 SQL 结果产生亚毫秒偏差。
func GetExpiry(ctx context.Context, querier QueryRower, userID int64) (time.Time, bool, error) {
	var expiresAt time.Time
	err := querier.QueryRow(ctx,
		`SELECT expires_at FROM vip_memberships WHERE user_id = $1`,
		userID,
	).Scan(&expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	return expiresAt, true, nil
}

// Get 查询 VIP 状态。从未购买过时返回零值，不报错。
func Get(ctx context.Context, querier QueryRower, userID int64) (Status, error) {
	expiresAt, ok, err := GetExpiry(ctx, querier, userID)
	if err != nil || !ok {
		return Status{}, err
	}
	milliseconds := expiresAt.UnixMilli()
	return Status{Active: expiresAt.After(time.Now()), ExpiresAt: &milliseconds}, nil
}

// Extend 在调用方的事务内续期，返回续期后的到期时间。
//
// GREATEST(现有到期时间, now) 同时覆盖两种情形：会籍未过期则从原到期时间累加，
// 已过期则从当前时间重新起算。
//
// 天数用 double precision 相乘而不是 make_interval，是为了与调用方 Go 侧的
// 固定时长加法（24h × days）逐位对齐；timestamptz 以 UTC 存储，无 DST 干扰。
func Extend(ctx context.Context, tx pgx.Tx, userID int64, days int64, now time.Time) (time.Time, error) {
	var expiresAt time.Time
	err := tx.QueryRow(ctx,
		`INSERT INTO vip_memberships (user_id, expires_at, created_at, updated_at)
		 VALUES ($1, $2::timestamptz + ($3::double precision * INTERVAL '1 day'), now(), now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   expires_at = GREATEST(vip_memberships.expires_at, $2::timestamptz) + ($3::double precision * INTERVAL '1 day'),
		   updated_at = now()
		 RETURNING expires_at`,
		userID, now, days,
	).Scan(&expiresAt)
	return expiresAt, err
}
