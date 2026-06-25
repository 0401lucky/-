package admindashboard

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const chinaOffset = 8 * time.Hour
const dashboardAlertsHistoryLimit = 20
const anomalyScanLimit = 300
const pointsSpikeThreshold = int64(5000)
const lotteryHighFrequencyThreshold = int64(80)

var ErrAlertNotFound = errors.New("admin alert not found")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) GetAlerts(ctx context.Context, detect bool, reference time.Time, historyLimit int64) (AlertsSnapshot, *Detection, error) {
	if reference.IsZero() {
		reference = time.Now()
	}
	var detection *Detection
	if detect {
		result, err := service.runAnomalyDetection(ctx, chinaDayStart(reference), reference, anomalyScanLimit)
		if err != nil {
			return AlertsSnapshot{}, nil, err
		}
		detection = &result
	}
	alerts, err := service.getAlertsSnapshot(ctx, historyLimit)
	if err != nil {
		return AlertsSnapshot{}, nil, err
	}
	return alerts, detection, nil
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
		result, err := service.runAnomalyDetection(ctx, dayStart, reference, anomalyScanLimit)
		if err != nil {
			return Data{}, err
		}
		detection = &result
	}

	alerts, err := service.getAlertsSnapshot(ctx, dashboardAlertsHistoryLimit)
	if err != nil {
		return Data{}, err
	}
	alertOverview, err := service.getAlertOverview(ctx)
	if err != nil {
		return Data{}, err
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
			Alerts: alertOverview,
		},
		Alerts:    alerts,
		Detection: detection,
	}, nil
}

func (service *Service) ResolveAlert(ctx context.Context, id string, resolvedBy string, resolvedAt time.Time) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrAlertNotFound
	}
	if resolvedAt.IsZero() {
		resolvedAt = time.Now()
	}

	tag, err := service.db.Exec(ctx,
		`UPDATE admin_alerts
		    SET resolved = TRUE,
		        resolved_at_ms = $2,
		        resolved_by = NULLIF($3, ''),
		        updated_at = now()
		  WHERE id = $1
		    AND resolved = FALSE`,
		id,
		resolvedAt.UnixMilli(),
		strings.TrimSpace(resolvedBy),
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	var exists bool
	if err := service.db.QueryRow(ctx, `SELECT TRUE FROM admin_alerts WHERE id = $1`, id).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return ErrAlertNotFound
	} else if err != nil {
		return err
	}
	return nil
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

func (service *Service) getAlertOverview(ctx context.Context) (AlertOverview, error) {
	var overview AlertOverview
	err := service.db.QueryRow(ctx,
		`SELECT
		    COUNT(*)::bigint,
		    COUNT(*) FILTER (WHERE level = 'warning')::bigint,
		    COUNT(*) FILTER (WHERE level = 'critical')::bigint
		   FROM admin_alerts
		  WHERE resolved = FALSE`,
	).Scan(&overview.Active, &overview.Warning, &overview.Critical)
	return overview, err
}

func (service *Service) getAlertsSnapshot(ctx context.Context, historyLimit int64) (AlertsSnapshot, error) {
	if historyLimit <= 0 {
		historyLimit = dashboardAlertsHistoryLimit
	}
	active, err := service.queryAlerts(ctx,
		`SELECT id, level, name, message, tags, occurred_at_ms, resolved, resolved_at_ms
		   FROM admin_alerts
		  WHERE resolved = FALSE
		  ORDER BY occurred_at_ms DESC, id DESC
		  LIMIT 100`,
	)
	if err != nil {
		return AlertsSnapshot{}, err
	}
	history, err := service.queryAlerts(ctx,
		`SELECT id, level, name, message, tags, occurred_at_ms, resolved, resolved_at_ms
		   FROM admin_alerts
		  ORDER BY occurred_at_ms DESC, id DESC
		  LIMIT $1`,
		historyLimit,
	)
	if err != nil {
		return AlertsSnapshot{}, err
	}
	return AlertsSnapshot{Active: active, History: history}, nil
}

func (service *Service) queryAlerts(ctx context.Context, sql string, args ...any) ([]AlertItem, error) {
	rows, err := service.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	alerts := make([]AlertItem, 0)
	for rows.Next() {
		var item AlertItem
		var rawTags []byte
		var resolvedAt *int64
		if err := rows.Scan(&item.ID, &item.Level, &item.Name, &item.Message, &rawTags, &item.Timestamp, &item.Resolved, &resolvedAt); err != nil {
			return nil, err
		}
		if len(rawTags) > 0 {
			var tags map[string]any
			if err := json.Unmarshal(rawTags, &tags); err != nil {
				return nil, err
			}
			item.Tags = tags
		}
		item.ResolvedAt = resolvedAt
		alerts = append(alerts, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return alerts, nil
}

func (service *Service) runAnomalyDetection(ctx context.Context, dayStart time.Time, reference time.Time, limit int64) (Detection, error) {
	if limit <= 0 {
		limit = anomalyScanLimit
	}
	rows, err := service.db.Query(ctx,
		`SELECT u.id, u.username, COALESCE(pa.balance, 0)::bigint
		   FROM users u
		   LEFT JOIN point_accounts pa ON pa.user_id = u.id
		  ORDER BY u.id
		  LIMIT $1`,
		limit,
	)
	if err != nil {
		return Detection{}, err
	}
	defer rows.Close()

	var detection Detection
	for rows.Next() {
		var userID int64
		var username string
		var currentPoints int64
		if err := rows.Scan(&userID, &username, &currentPoints); err != nil {
			return Detection{}, err
		}
		detection.ScannedUsers++
		triggered, err := service.detectUserAnomalies(ctx, userID, username, currentPoints, dayStart, reference)
		if err != nil {
			return Detection{}, err
		}
		detection.TriggeredAlerts += triggered
	}
	if err := rows.Err(); err != nil {
		return Detection{}, err
	}
	return detection, nil
}

func (service *Service) detectUserAnomalies(ctx context.Context, userID int64, username string, currentPoints int64, dayStart time.Time, reference time.Time) (int64, error) {
	var triggered int64
	var baseline int64
	err := service.db.QueryRow(ctx,
		`SELECT points FROM admin_alert_point_baselines WHERE user_id = $1`,
		userID,
	).Scan(&baseline)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	if baseline > 0 && currentPoints-baseline >= pointsSpikeThreshold {
		created, err := service.triggerAlertOncePerDay(ctx, reference,
			"points_spike:"+strconv.FormatInt(userID, 10),
			"warning",
			"points_spike",
			fmt.Sprintf("用户 %s 积分短时增长异常（+%d）", username, currentPoints-baseline),
			map[string]any{
				"userId":   userID,
				"username": username,
				"delta":    currentPoints - baseline,
			},
		)
		if err != nil {
			return 0, err
		}
		if created {
			triggered++
		}
	}

	if _, err := service.db.Exec(ctx,
		`INSERT INTO admin_alert_point_baselines (user_id, points, updated_at)
		 VALUES ($1, $2, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   points = excluded.points,
		   updated_at = now()`,
		userID,
		currentPoints,
	); err != nil {
		return 0, err
	}

	var lotteryCount int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint
		   FROM lottery_records
		  WHERE user_id = $1
		    AND created_at_ms >= $2`,
		userID,
		dayStart.UnixMilli(),
	).Scan(&lotteryCount); err != nil {
		return 0, err
	}
	if lotteryCount >= lotteryHighFrequencyThreshold {
		created, err := service.triggerAlertOncePerDay(ctx, reference,
			"lottery_high_frequency:"+strconv.FormatInt(userID, 10),
			"critical",
			"lottery_high_frequency",
			fmt.Sprintf("用户 %s 今日抽奖频次异常（%d 次）", username, lotteryCount),
			map[string]any{
				"userId":   userID,
				"username": username,
				"count":    lotteryCount,
			},
		)
		if err != nil {
			return 0, err
		}
		if created {
			triggered++
		}
	}

	return triggered, nil
}

func (service *Service) triggerAlertOncePerDay(ctx context.Context, reference time.Time, dedupeKey string, level string, name string, message string, tags map[string]any) (bool, error) {
	sourceKey := chinaDateString(reference) + ":" + dedupeKey
	id := "alert_" + strconv.FormatInt(reference.UnixMilli(), 10) + "_" + randomHex(4)
	rawTags, err := json.Marshal(tags)
	if err != nil {
		return false, err
	}
	tag, err := service.db.Exec(ctx,
		`INSERT INTO admin_alerts (id, level, name, message, tags, source_key, occurred_at_ms)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
		 ON CONFLICT (source_key) DO NOTHING`,
		id,
		level,
		name,
		message,
		string(rawTags),
		sourceKey,
		reference.UnixMilli(),
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
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

func chinaDateString(reference time.Time) string {
	china := reference.UTC().Add(chinaOffset)
	return fmt.Sprintf("%04d-%02d-%02d", china.Year(), china.Month(), china.Day())
}

func randomHex(bytesCount int) string {
	if bytesCount <= 0 {
		bytesCount = 4
	}
	buffer := make([]byte, bytesCount)
	if _, err := rand.Read(buffer); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return hex.EncodeToString(buffer)
}
