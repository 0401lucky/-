package gamerecords

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// BestTimes returns personal winning durations in milliseconds across all saved
// records, independently of the recent-record pagination and score rankings.
func BestTimes(ctx context.Context, tx pgx.Tx, userID int64, gameType string) (map[string]int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT difficulty, MIN((payload->>'duration')::bigint)
		FROM game_records
		WHERE user_id = $1 AND game_type = $2
		  AND payload->>'won' = 'true'
		  AND (payload->>'duration')::bigint > 0
		GROUP BY difficulty`, userID, gameType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	best := make(map[string]int64)
	for rows.Next() {
		var difficulty string
		var duration int64
		if err := rows.Scan(&difficulty, &duration); err != nil {
			return nil, err
		}
		best[difficulty] = duration
	}
	return best, rows.Err()
}
