package admindashboard

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
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

func (service *Service) Get(ctx context.Context, detect bool, reference time.Time, pointsPeriod string) (Data, error) {
	if reference.IsZero() {
		reference = time.Now()
	}
	dayStart := chinaDayStart(reference)
	monthStart := chinaMonthStart(reference)
	pointsPeriod = normalizePointsAnalyticsPeriod(pointsPeriod)

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
	engagement, err := service.getEngagementOverview(ctx, dayStart)
	if err != nil {
		return Data{}, err
	}
	operations, err := service.getOperationsOverview(ctx)
	if err != nil {
		return Data{}, err
	}
	pointsAnalytics, err := service.getPointsAnalytics(ctx, reference, pointsPeriod)
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
			Engagement: engagement,
			Operations: operations,
			PointsFlow: PointsFlowOverview{
				TodayIn:  pointsIn,
				TodayOut: pointsOut,
				TodayNet: pointsIn - pointsOut,
			},
			PointsAnalytics: pointsAnalytics,
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

func (service *Service) getEngagementOverview(ctx context.Context, dayStart time.Time) (EngagementOverview, error) {
	dayStartMs := dayStart.UnixMilli()
	var overview EngagementOverview
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM checkin_records WHERE checkin_date = $1::date`, dayStart).Scan(&overview.TodayCheckins); err != nil {
		return EngagementOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM card_draw_logs WHERE created_at_ms >= $1`, dayStartMs).Scan(&overview.TodayCardDraws); err != nil {
		return EngagementOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM card_reward_claims WHERE claimed_at_ms >= $1`, dayStartMs).Scan(&overview.TodayCardExchanges); err != nil {
		return EngagementOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM game_sessions WHERE started_at >= $1`, dayStart).Scan(&overview.TodayGamesStarted); err != nil {
		return EngagementOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM game_records WHERE created_at >= $1`, dayStart).Scan(&overview.TodayGamesCompleted); err != nil {
		return EngagementOverview{}, err
	}
	return overview, nil
}

func (service *Service) getOperationsOverview(ctx context.Context) (OperationsOverview, error) {
	var overview OperationsOverview
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint,
		        COUNT(*) FILTER (WHERE status = 'active')::bigint,
		        COALESCE(SUM(GREATEST(max_claims - claimed_count, 0)) FILTER (WHERE status = 'active'), 0)::bigint
		   FROM projects`,
	).Scan(&overview.Projects.Total, &overview.Projects.Active, &overview.Projects.RemainingSlots); err != nil {
		return OperationsOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM raffles WHERE status = 'active'`).Scan(&overview.Raffles.Active); err != nil {
		return OperationsOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM store_items WHERE enabled = TRUE`).Scan(&overview.Store.EnabledItems); err != nil {
		return OperationsOverview{}, err
	}
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FILTER (WHERE status = 'open')::bigint,
		        COUNT(*) FILTER (WHERE status = 'processing')::bigint
		   FROM feedback_items
		  WHERE archived_at_ms IS NULL`,
	).Scan(&overview.Feedback.Open, &overview.Feedback.Processing); err != nil {
		return OperationsOverview{}, err
	}
	if err := service.db.QueryRow(ctx, `SELECT COUNT(*)::bigint FROM announcements WHERE status = 'published'`).Scan(&overview.Announcements.Published); err != nil {
		return OperationsOverview{}, err
	}
	return overview, nil
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

type pointsAnalyticsRange struct {
	period     string
	start      time.Time
	end        time.Time
	label      string
	bucketUnit string
	buckets    []time.Time
	labels     []string
}

type pointsLedgerRow struct {
	userID      int64
	amount      int64
	source      string
	description string
	createdAt   time.Time
}

type pointsCategoryAccumulator struct {
	key          string
	label        string
	total        int64
	count        int64
	users        map[int64]struct{}
	descriptions map[string]*PointsPathDetail
	buckets      []PointsPathSeriesBucket
}

type pointsDirectionAccumulator struct {
	total      int64
	count      int64
	users      map[int64]struct{}
	categories map[string]*pointsCategoryAccumulator
}

func (service *Service) getPointsAnalytics(ctx context.Context, reference time.Time, period string) (PointsAnalytics, error) {
	analyticsRange := buildPointsAnalyticsRange(reference, period)
	rows, err := service.db.Query(ctx,
		`SELECT user_id, amount, source, description, created_at
		   FROM point_ledger
		  WHERE created_at >= $1 AND created_at < $2
		  ORDER BY created_at ASC`,
		analyticsRange.start,
		analyticsRange.end,
	)
	if err != nil {
		return PointsAnalytics{}, err
	}
	defer rows.Close()

	earning := newPointsDirectionAccumulator()
	spending := newPointsDirectionAccumulator()
	var scannedLogs int64
	for rows.Next() {
		var row pointsLedgerRow
		if err := rows.Scan(&row.userID, &row.amount, &row.source, &row.description, &row.createdAt); err != nil {
			return PointsAnalytics{}, err
		}
		if row.amount == 0 {
			continue
		}
		scannedLogs++
		if row.amount > 0 {
			earning.add(row, row.amount, analyticsRange)
		} else {
			spending.add(row, -row.amount, analyticsRange)
		}
	}
	if err := rows.Err(); err != nil {
		return PointsAnalytics{}, err
	}

	userIDs := map[int64]struct{}{}
	for userID := range earning.users {
		userIDs[userID] = struct{}{}
	}
	for userID := range spending.users {
		userIDs[userID] = struct{}{}
	}

	return PointsAnalytics{
		Period: analyticsRange.period,
		Range: PointsAnalyticsRange{
			StartAt:    analyticsRange.start.UnixMilli(),
			EndAt:      analyticsRange.end.UnixMilli(),
			Label:      analyticsRange.label,
			BucketUnit: analyticsRange.bucketUnit,
		},
		BucketLabels: analyticsRange.labels,
		Earning:      earning.result(analyticsRange),
		Spending:     spending.result(analyticsRange),
		Meta: PointsAnalyticsMeta{
			Storage:      "native",
			ScannedUsers: int64(len(userIDs)),
			ScannedLogs:  scannedLogs,
		},
	}, nil
}

func normalizePointsAnalyticsPeriod(period string) string {
	switch strings.TrimSpace(period) {
	case "week", "month":
		return period
	default:
		return "day"
	}
}

func buildPointsAnalyticsRange(reference time.Time, period string) pointsAnalyticsRange {
	period = normalizePointsAnalyticsPeriod(period)
	dayStart := chinaDayStart(reference)
	switch period {
	case "week":
		start := dayStart.AddDate(0, 0, -6)
		buckets, labels := dayBuckets(start, 7, "01/02")
		return pointsAnalyticsRange{
			period:     period,
			start:      start,
			end:        reference,
			label:      "近 7 天",
			bucketUnit: "day",
			buckets:    buckets,
			labels:     labels,
		}
	case "month":
		start := chinaMonthStart(reference)
		days := int(dayStart.Sub(start).Hours()/24) + 1
		if days < 1 {
			days = 1
		}
		buckets, labels := dayBuckets(start, days, "01/02")
		return pointsAnalyticsRange{
			period:     period,
			start:      start,
			end:        reference,
			label:      fmt.Sprintf("%04d-%02d", reference.UTC().Add(chinaOffset).Year(), reference.UTC().Add(chinaOffset).Month()),
			bucketUnit: "day",
			buckets:    buckets,
			labels:     labels,
		}
	default:
		buckets := make([]time.Time, 24)
		labels := make([]string, 24)
		for index := 0; index < 24; index++ {
			bucket := dayStart.Add(time.Duration(index) * time.Hour)
			buckets[index] = bucket
			labels[index] = fmt.Sprintf("%02d:00", bucket.UTC().Add(chinaOffset).Hour())
		}
		china := reference.UTC().Add(chinaOffset)
		return pointsAnalyticsRange{
			period:     "day",
			start:      dayStart,
			end:        reference,
			label:      fmt.Sprintf("%04d-%02d-%02d", china.Year(), china.Month(), china.Day()),
			bucketUnit: "hour",
			buckets:    buckets,
			labels:     labels,
		}
	}
}

func dayBuckets(start time.Time, days int, layout string) ([]time.Time, []string) {
	buckets := make([]time.Time, days)
	labels := make([]string, days)
	for index := 0; index < days; index++ {
		bucket := start.AddDate(0, 0, index)
		buckets[index] = bucket
		labels[index] = bucket.UTC().Add(chinaOffset).Format(layout)
	}
	return buckets, labels
}

func newPointsDirectionAccumulator() *pointsDirectionAccumulator {
	return &pointsDirectionAccumulator{
		users:      map[int64]struct{}{},
		categories: map[string]*pointsCategoryAccumulator{},
	}
}

func (accumulator *pointsDirectionAccumulator) add(row pointsLedgerRow, absoluteAmount int64, analyticsRange pointsAnalyticsRange) {
	accumulator.total += absoluteAmount
	accumulator.count++
	accumulator.users[row.userID] = struct{}{}

	key := normalizePointsSource(row.source)
	category, ok := accumulator.categories[key]
	if !ok {
		category = &pointsCategoryAccumulator{
			key:          key,
			label:        pointsSourceLabel(key),
			users:        map[int64]struct{}{},
			descriptions: map[string]*PointsPathDetail{},
			buckets:      make([]PointsPathSeriesBucket, len(analyticsRange.buckets)),
		}
		for index, bucket := range analyticsRange.buckets {
			category.buckets[index] = PointsPathSeriesBucket{
				BucketStart: bucket.UnixMilli(),
				Label:       analyticsRange.labels[index],
			}
		}
		accumulator.categories[key] = category
	}

	category.total += absoluteAmount
	category.count++
	category.users[row.userID] = struct{}{}
	description := strings.TrimSpace(row.description)
	if description == "" {
		description = pointsSourceLabel(key)
	}
	detail, ok := category.descriptions[description]
	if !ok {
		detail = &PointsPathDetail{Description: description}
		category.descriptions[description] = detail
	}
	detail.Total += absoluteAmount
	detail.Count++
	if bucketIndex := pointsBucketIndex(row.createdAt, analyticsRange); bucketIndex >= 0 && bucketIndex < len(category.buckets) {
		category.buckets[bucketIndex].Value += absoluteAmount
		category.buckets[bucketIndex].Count++
	}
}

func (accumulator *pointsDirectionAccumulator) result(analyticsRange pointsAnalyticsRange) PointsDirectionAnalytics {
	categories := make([]PointsPathCategory, 0, len(accumulator.categories))
	series := make([]PointsPathSeries, 0, len(accumulator.categories))
	for _, category := range accumulator.categories {
		topDescriptions := make([]PointsPathDetail, 0, len(category.descriptions))
		for _, detail := range category.descriptions {
			topDescriptions = append(topDescriptions, *detail)
		}
		sort.Slice(topDescriptions, func(left, right int) bool {
			if topDescriptions[left].Total == topDescriptions[right].Total {
				return topDescriptions[left].Description < topDescriptions[right].Description
			}
			return topDescriptions[left].Total > topDescriptions[right].Total
		})
		percent := float64(0)
		if accumulator.total > 0 {
			percent = math.Round((float64(category.total)/float64(accumulator.total))*10000) / 100
		}
		average := int64(0)
		if category.count > 0 {
			average = int64(math.Round(float64(category.total) / float64(category.count)))
		}
		categories = append(categories, PointsPathCategory{
			Key:             category.key,
			Label:           category.label,
			Total:           category.total,
			Count:           category.count,
			UserCount:       int64(len(category.users)),
			Percent:         percent,
			Average:         average,
			TopDescriptions: topDescriptions,
		})
		series = append(series, PointsPathSeries{
			Key:    category.key,
			Label:  category.label,
			Total:  category.total,
			Points: category.buckets,
		})
	}
	sort.Slice(categories, func(left, right int) bool {
		if categories[left].Total == categories[right].Total {
			return categories[left].Label < categories[right].Label
		}
		return categories[left].Total > categories[right].Total
	})
	sort.Slice(series, func(left, right int) bool {
		if series[left].Total == series[right].Total {
			return series[left].Label < series[right].Label
		}
		return series[left].Total > series[right].Total
	})
	average := int64(0)
	if accumulator.count > 0 {
		average = int64(math.Round(float64(accumulator.total) / float64(accumulator.count)))
	}
	return PointsDirectionAnalytics{
		Total:      accumulator.total,
		Count:      accumulator.count,
		UserCount:  int64(len(accumulator.users)),
		Average:    average,
		Categories: categories,
		Series:     series,
	}
}

func pointsBucketIndex(createdAt time.Time, analyticsRange pointsAnalyticsRange) int {
	if createdAt.Before(analyticsRange.start) || createdAt.After(analyticsRange.end) {
		return -1
	}
	if analyticsRange.bucketUnit == "hour" {
		return int(createdAt.Sub(analyticsRange.start).Hours())
	}
	return int(createdAt.Sub(analyticsRange.start).Hours() / 24)
}

func normalizePointsSource(source string) string {
	source = strings.TrimSpace(source)
	if source == "" {
		return "unknown"
	}
	return source
}

func pointsSourceLabel(source string) string {
	labels := map[string]string{
		"game_play":          "游戏游玩",
		"game_win":           "游戏胜利",
		"daily_login":        "每日登录",
		"checkin_bonus":      "签到奖励",
		"exchange":           "商店兑换",
		"exchange_refund":    "兑换回滚",
		"exchange_withdraw":  "额度提现",
		"exchange_topup":     "额度兑换",
		"admin_adjust":       "管理员调整",
		"card_collection":    "卡牌奖励",
		"ranking_reward":     "排行榜奖励",
		"reward_claim":       "奖励领取",
		"lottery_win":        "幸运抽奖",
		"raffle_win":         "多人抽奖",
		"number_bomb_bet":    "数字炸弹下注",
		"number_bomb_refund": "数字炸弹退还",
		"number_bomb_reward": "数字炸弹奖励",
		"project_claim":      "福利领取",
		"eco_collect":        "环保回收",
		"eco_prize":          "环保奖品",
		"farm_harvest":       "农场收获",
		"farm_purchase":      "农场购买",
	}
	if label, ok := labels[source]; ok {
		return label
	}
	return source
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
