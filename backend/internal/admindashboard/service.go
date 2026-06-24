package admindashboard

import (
	"context"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const chinaOffset = 8 * time.Hour

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) Get(ctx context.Context, detect bool, reference time.Time) (Data, error) {
	if reference.IsZero() {
		reference = time.Now()
	}
	dayStart := chinaDayStart(reference)
	monthStart := chinaMonthStart(reference)

	totalUsers, err := service.countUsers(ctx)
	if err != nil {
		return Data{}, err
	}
	dau, err := service.countActiveUsers(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}
	mau, err := service.countActiveUsers(ctx, monthStart)
	if err != nil {
		return Data{}, err
	}
	todayClaims, err := service.countExchangeLogs(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}
	todayLotterySpins, err := service.countRaffleEntries(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}
	pointsIn, pointsOut, err := service.pointsFlow(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}
	gameParticipants, err := service.countGameParticipants(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}

	var detection *Detection
	if detect {
		detection = &Detection{ScannedUsers: totalUsers, TriggeredAlerts: 0}
	}

	return Data{
		Dashboard: Overview{
			GeneratedAt: reference.UnixMilli(),
			Users: UserOverview{
				Total: totalUsers,
				DAU:   dau,
				MAU:   mau,
			},
			Redemption: RedemptionOverview{
				TodayClaims:       todayClaims,
				TodayLotterySpins: todayLotterySpins,
			},
			PointsFlow: PointsFlowOverview{
				TodayIn:  pointsIn,
				TodayOut: pointsOut,
				TodayNet: pointsIn - pointsOut,
			},
			Games: GamesOverview{
				Participants:      gameParticipants,
				ParticipationRate: participationRate(gameParticipants, totalUsers),
			},
			Alerts: AlertOverview{},
		},
		Alerts:    AlertsSnapshot{Active: []AlertItem{}, History: []AlertItem{}},
		Detection: detection,
	}, nil
}

func (service *Service) countUsers(ctx context.Context) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM users`).Scan(&count)
	return count, err
}

func (service *Service) countExchangeLogs(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint
		   FROM exchange_logs
		  WHERE created_at >= $1`,
		since,
	).Scan(&count)
	return count, err
}

func (service *Service) countRaffleEntries(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint
		   FROM raffle_entries
		  WHERE created_at_ms >= $1`,
		since.UnixMilli(),
	).Scan(&count)
	return count, err
}

func (service *Service) countGameParticipants(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx,
		`SELECT COUNT(DISTINCT user_id)::bigint
		   FROM game_records
		  WHERE created_at >= $1`,
		since,
	).Scan(&count)
	return count, err
}

func (service *Service) countActiveUsers(ctx context.Context, since time.Time) (int64, error) {
	var count int64
	err := service.db.QueryRow(ctx,
		`WITH active AS (
		     SELECT user_id FROM point_ledger WHERE created_at >= $1
		     UNION
		     SELECT user_id FROM exchange_logs WHERE created_at >= $1
		     UNION
		     SELECT user_id FROM game_records WHERE created_at >= $1
		     UNION
		     SELECT user_id FROM raffle_entries WHERE created_at_ms >= $2
		   )
		 SELECT COUNT(DISTINCT user_id)::bigint FROM active`,
		since,
		since.UnixMilli(),
	).Scan(&count)
	return count, err
}

func (service *Service) pointsFlow(ctx context.Context, since time.Time) (int64, int64, error) {
	var incoming int64
	var outgoing int64
	err := service.db.QueryRow(ctx,
		`SELECT
		    COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::bigint,
		    COALESCE(SUM(-amount) FILTER (WHERE amount < 0), 0)::bigint
		   FROM point_ledger
		  WHERE created_at >= $1`,
		since,
	).Scan(&incoming, &outgoing)
	return incoming, outgoing, err
}

func participationRate(participants int64, total int64) float64 {
	if participants <= 0 || total <= 0 {
		return 0
	}
	rate := (float64(participants) / float64(total)) * 100
	return math.Round(rate*100) / 100
}

func chinaDayStart(reference time.Time) time.Time {
	china := reference.UTC().Add(chinaOffset)
	return time.Date(china.Year(), china.Month(), china.Day(), 0, 0, 0, 0, time.UTC).Add(-chinaOffset)
}

func chinaMonthStart(reference time.Time) time.Time {
	china := reference.UTC().Add(chinaOffset)
	return time.Date(china.Year(), china.Month(), 1, 0, 0, 0, 0, time.UTC).Add(-chinaOffset)
}
