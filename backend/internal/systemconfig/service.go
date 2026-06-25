package systemconfig

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUnavailable = errors.New("system config database unavailable")
	ErrInvalid     = errors.New("system config invalid")
)

const (
	DefaultDailyPointsLimit = int64(5000)
	MinDailyPointsLimit     = int64(100)
	MaxDailyPointsLimit     = int64(100000)
)

type QueryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Config struct {
	DailyPointsLimit int64   `json:"dailyPointsLimit"`
	UpdatedAt        *int64  `json:"updatedAt,omitempty"`
	UpdatedBy        *string `json:"updatedBy,omitempty"`
}

type UpdateInput struct {
	DailyPointsLimit *int64
	UpdatedBy        string
	Now              time.Time
}

type Service struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db, now: time.Now}
}

func NewServiceWithNow(db *pgxpool.Pool, now func() time.Time) *Service {
	if now == nil {
		now = time.Now
	}
	return &Service{db: db, now: now}
}

func (service *Service) Get(ctx context.Context) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}
	return Get(ctx, service.db)
}

func (service *Service) Update(ctx context.Context, input UpdateInput) (Config, error) {
	if service.db == nil {
		return Config{}, ErrUnavailable
	}
	limit := DefaultDailyPointsLimit
	if input.DailyPointsLimit != nil {
		limit = *input.DailyPointsLimit
	}
	if !ValidDailyPointsLimit(limit) {
		return Config{}, ErrInvalid
	}
	now := input.Now
	if now.IsZero() {
		now = service.now()
	}
	nowMs := now.UnixMilli()
	_, err := service.db.Exec(ctx,
		`INSERT INTO system_config (id, daily_points_limit, updated_at_ms, updated_by, updated_at)
		 VALUES ('system', $1, $2, $3, now())
		 ON CONFLICT (id) DO UPDATE SET
		   daily_points_limit = excluded.daily_points_limit,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_by = excluded.updated_by,
		   updated_at = now()`,
		limit,
		nowMs,
		emptyStringToNil(input.UpdatedBy),
	)
	if err != nil {
		return Config{}, err
	}
	return Get(ctx, service.db)
}

func Get(ctx context.Context, queryer QueryRower) (Config, error) {
	config := Config{DailyPointsLimit: DefaultDailyPointsLimit}
	var updatedBy *string
	var updatedAt int64
	err := queryer.QueryRow(ctx,
		`SELECT daily_points_limit, updated_at_ms, updated_by
		   FROM system_config
		  WHERE id = 'system'`,
	).Scan(&config.DailyPointsLimit, &updatedAt, &updatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return config, nil
	}
	if err != nil {
		return Config{}, err
	}
	if !ValidDailyPointsLimit(config.DailyPointsLimit) {
		config.DailyPointsLimit = DefaultDailyPointsLimit
	}
	if updatedAt > 1 {
		config.UpdatedAt = &updatedAt
	}
	config.UpdatedBy = updatedBy
	return config, nil
}

func DailyPointsLimit(ctx context.Context, queryer QueryRower) (int64, error) {
	config, err := Get(ctx, queryer)
	if err != nil {
		return 0, err
	}
	return config.DailyPointsLimit, nil
}

func ValidDailyPointsLimit(limit int64) bool {
	return limit >= MinDailyPointsLimit && limit <= MaxDailyPointsLimit
}

func emptyStringToNil(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
