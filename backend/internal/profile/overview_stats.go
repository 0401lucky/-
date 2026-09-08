package profile

import (
	"context"
	"time"

	"redemption/backend/internal/cards"
)

func summarizeCards(state cards.UserState, catalog []cards.Card) OverviewCards {
	result := OverviewCards{
		Fragments:      state.Fragments,
		DrawsAvailable: state.DrawsAvailable,
		Albums:         []OverviewAlbum{},
	}
	owned := make(map[string]bool, len(state.Inventory))
	for _, id := range state.Inventory {
		owned[id] = true
	}
	albums := map[string]int{}
	for _, card := range catalog {
		index, exists := albums[card.AlbumID]
		if !exists {
			index = len(result.Albums)
			albums[card.AlbumID] = index
			result.Albums = append(result.Albums, OverviewAlbum{
				ID:   card.AlbumID,
				Name: cards.AlbumName(card.AlbumID),
			})
		}
		result.Total++
		result.Albums[index].Total++
		if owned[card.ID] {
			result.Owned++
			result.Albums[index].Owned++
		}
	}
	if result.Total > 0 {
		result.CompletionRate = float64(result.Owned) * 100 / float64(result.Total)
	}
	for index := range result.Albums {
		album := &result.Albums[index]
		album.CompletionRate = float64(album.Owned) * 100 / float64(album.Total)
	}
	return result
}

type checkinSummary struct {
	TotalDays     int64
	CurrentStreak int64
	MaxStreak     int64
}

func (service *Service) overviewCheckins(ctx context.Context, userID int64, nowMs int64) (checkinSummary, error) {
	// checkin_date is a China calendar date, independent of the database timezone.
	todayKey := time.UnixMilli(nowMs).UTC().Add(8 * time.Hour).Format("2006-01-02")
	rows, err := service.db.Query(ctx,
		`SELECT checkin_date::text FROM checkin_records
		 WHERE user_id = $1 AND checkin_date <= $2::date
		 ORDER BY checkin_date`, userID, todayKey)
	if err != nil {
		return checkinSummary{}, err
	}
	defer rows.Close()

	var result checkinSummary
	var previous time.Time
	var streak int64
	for rows.Next() {
		var dateKey string
		if err := rows.Scan(&dateKey); err != nil {
			return checkinSummary{}, err
		}
		date, err := time.Parse("2006-01-02", dateKey)
		if err != nil {
			return checkinSummary{}, err
		}
		result.TotalDays++
		if date.Equal(previous.AddDate(0, 0, 1)) {
			streak++
		} else {
			streak = 1
		}
		result.MaxStreak = max(result.MaxStreak, streak)
		previous = date
	}
	if err := rows.Err(); err != nil {
		return checkinSummary{}, err
	}
	// Today's check-in may still be pending; yesterday's streak remains active.
	if previous.Format("2006-01-02") == todayKey || previous.AddDate(0, 0, 1).Format("2006-01-02") == todayKey {
		result.CurrentStreak = streak
	}
	return result, nil
}

func (service *Service) overviewAchievementStats(ctx context.Context, userID int64) (OverviewAchievementStats, error) {
	stats, err := service.overviewEcoStats(ctx, userID)
	if err != nil {
		return stats, err
	}
	if err := service.db.QueryRow(ctx,
		`SELECT
		   COALESCE((SELECT MAX(GREATEST(balance_after, balance_after - amount))
		               FROM point_ledger WHERE user_id = $1), 0),
		   (SELECT COUNT(*)
		      FROM farm_states f
		      CROSS JOIN LATERAL jsonb_array_elements(
		        CASE WHEN jsonb_typeof(f.state_json->'lands') = 'array'
		             THEN f.state_json->'lands' ELSE '[]'::jsonb END
		      ) AS land
		     WHERE f.user_id = $1
		       AND land->>'status' IN ('empty', 'growing', 'thirsty', 'mature', 'withered', 'eaten'))`,
		userID,
	).Scan(&stats.PeakPointsBalance, &stats.FarmUnlockedLands); err != nil {
		return stats, err
	}

	// Each spin is mirrored in game_records. Count the canonical lottery row once,
	// while retaining older game-only records regardless of the recent-record limit.
	err = service.db.QueryRow(ctx,
		`WITH spins AS (
		   SELECT tier_id, tier_name FROM lottery_records WHERE user_id = $1
		   UNION ALL
		   SELECT COALESCE(NULLIF(g.payload->>'tierId', ''), g.difficulty, '') AS tier_id,
		          COALESCE(g.payload->>'tierName', '') AS tier_name
		     FROM game_records g
		    WHERE g.user_id = $1 AND g.game_type = 'lottery'
		      AND (g.payload->>'pending') IS DISTINCT FROM 'true'
		      AND NOT EXISTS (
		        SELECT 1 FROM lottery_records l
		         WHERE l.user_id = $1
		           AND l.id IN (g.payload->>'lotteryRecordId', g.session_id,
		                        CASE WHEN left(g.id, 5) = 'game_' THEN substr(g.id, 6) ELSE g.id END)
		      )
		 )
		 SELECT COUNT(*),
		        COUNT(*) FILTER (WHERE tier_id = 'pts_200' OR
		          (tier_id = '' AND (tier_name LIKE '%橙子%' OR tier_name LIKE '%🍊%'))),
		        COUNT(*) FILTER (WHERE tier_id = 'pts_0' OR
		          (tier_id = '' AND (tier_name LIKE '%爱心%' OR tier_name LIKE '%❤️%' OR tier_name = '谢谢惠顾')))
		 FROM spins`,
		userID,
	).Scan(&stats.LotteryPlays, &stats.LotteryOrangeCount, &stats.LotteryHeartCount)
	return stats, err
}
