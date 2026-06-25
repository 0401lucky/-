package lottery

import (
	"context"
	"strconv"
	"strings"
	"time"
)

func (service *Service) LotteryRanking(ctx context.Context, period string, limit int) (LotteryPeriodRankingResult, error) {
	if service.db == nil {
		return LotteryPeriodRankingResult{}, ErrUnavailable
	}
	safePeriod := normalizeLotteryRankingPeriod(period)
	periodKey, start, end := currentLotteryRankingWindow(safePeriod)
	ranking, totalParticipants, err := service.lotteryRankingRows(ctx, start, end, normalizeLimit(limit, 10, 50))
	if err != nil {
		return LotteryPeriodRankingResult{}, err
	}
	return LotteryPeriodRankingResult{
		Period:            safePeriod,
		PeriodKey:         periodKey,
		TotalParticipants: totalParticipants,
		Ranking:           ranking,
	}, nil
}

func (service *Service) LotteryDailyRanking(ctx context.Context, date string, limit int) (LotteryDailyRankingResult, error) {
	if service.db == nil {
		return LotteryDailyRankingResult{}, ErrUnavailable
	}
	day := todayChina()
	if strings.TrimSpace(date) != "" {
		parsed, err := time.Parse("2006-01-02", strings.TrimSpace(date))
		if err != nil {
			return LotteryDailyRankingResult{}, ValidationError{Message: "日期格式不合法"}
		}
		day = parsed
	}
	ranking, totalParticipants, err := service.lotteryRankingRows(ctx, day, day.AddDate(0, 0, 1), normalizeLimit(limit, 10, 50))
	if err != nil {
		return LotteryDailyRankingResult{}, err
	}
	return LotteryDailyRankingResult{
		Date:              formatDate(day),
		TotalParticipants: totalParticipants,
		Ranking:           ranking,
	}, nil
}

func (service *Service) lotteryRankingRows(ctx context.Context, start time.Time, end time.Time, limit int) ([]LotteryRankingEntry, int64, error) {
	rows, err := service.db.Query(ctx,
		`WITH grouped AS (
		   SELECT
		     user_id,
		     (array_agg(username ORDER BY created_at_ms DESC, id DESC))[1] AS username,
		     COALESCE(SUM(tier_value), 0)::bigint AS total_value,
		     (array_agg(tier_name ORDER BY tier_value DESC, created_at_ms DESC, id DESC))[1] AS best_prize,
		     COUNT(*)::bigint AS draw_count
		   FROM lottery_records
		   WHERE created_at_ms >= $1 AND created_at_ms < $2
		   GROUP BY user_id
		 ),
		 ranked AS (
		   SELECT
		     ROW_NUMBER() OVER (ORDER BY total_value DESC, draw_count DESC, user_id ASC)::bigint AS rank,
		     COUNT(*) OVER ()::bigint AS total_participants,
		     user_id,
		     username,
		     total_value,
		     best_prize,
		     draw_count
		   FROM grouped
		 )
		 SELECT rank, total_participants, user_id, username, total_value, best_prize, draw_count
		   FROM ranked
		  ORDER BY rank ASC
		  LIMIT $3`,
		chinaDateStartMillis(start),
		chinaDateStartMillis(end),
		limit,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	entries := []LotteryRankingEntry{}
	totalParticipants := int64(0)
	for rows.Next() {
		var entry LotteryRankingEntry
		var userID int64
		if err := rows.Scan(
			&entry.Rank,
			&totalParticipants,
			&userID,
			&entry.Username,
			&entry.TotalValue,
			&entry.BestPrize,
			&entry.Count,
		); err != nil {
			return nil, 0, err
		}
		entry.UserID = strconv.FormatInt(userID, 10)
		entry.EquippedAchievement = nil
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return entries, totalParticipants, nil
}

func normalizeLotteryRankingPeriod(period string) LotteryRankingPeriod {
	switch LotteryRankingPeriod(strings.TrimSpace(period)) {
	case LotteryRankingWeekly:
		return LotteryRankingWeekly
	case LotteryRankingMonthly:
		return LotteryRankingMonthly
	default:
		return LotteryRankingDaily
	}
}

func currentLotteryRankingWindow(period LotteryRankingPeriod) (string, time.Time, time.Time) {
	today := todayChina()
	switch period {
	case LotteryRankingWeekly:
		weekday := today.Weekday()
		daysFromMonday := int(weekday - time.Monday)
		if daysFromMonday < 0 {
			daysFromMonday = 6
		}
		start := today.AddDate(0, 0, -daysFromMonday)
		return formatDate(start), start, start.AddDate(0, 0, 7)
	case LotteryRankingMonthly:
		start := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start.Format("2006-01"), start, start.AddDate(0, 1, 0)
	default:
		return formatDate(today), today, today.AddDate(0, 0, 1)
	}
}
