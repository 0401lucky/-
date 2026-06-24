package achievement

import (
	"context"

	"github.com/jackc/pgx/v5"
)

const (
	IDThief    = "thief"
	SourceAuto = "auto"
)

func GrantAndForceEquip(ctx context.Context, tx pgx.Tx, userID int64, achievementID string, nowMs int64, untilMs int64, reason string) error {
	if _, err := tx.Exec(ctx,
		`INSERT INTO user_achievement_grants (
		   user_id, achievement_id, source, granted_at_ms, expires_at_ms, reason, metadata, updated_at
		 ) VALUES (
		   $1, $2, $3, $4, $5, $6, '{}'::jsonb, now()
		 )
		 ON CONFLICT (user_id, achievement_id) DO UPDATE SET
		   source = excluded.source,
		   expires_at_ms = GREATEST(
		     COALESCE(user_achievement_grants.expires_at_ms, 0),
		     COALESCE(excluded.expires_at_ms, 0)
		   ),
		   reason = COALESCE(excluded.reason, user_achievement_grants.reason),
		   updated_at = now()`,
		userID,
		achievementID,
		SourceAuto,
		nowMs,
		untilMs,
		reason,
	); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO user_equipped_achievements (user_id, achievement_id, updated_at_ms, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   achievement_id = excluded.achievement_id,
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = now()`,
		userID,
		achievementID,
		nowMs,
	); err != nil {
		return err
	}

	_, err := tx.Exec(ctx,
		`INSERT INTO user_forced_achievements (user_id, achievement_id, until_ms, updated_at_ms, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (user_id) DO UPDATE SET
		   achievement_id = excluded.achievement_id,
		   until_ms = GREATEST(user_forced_achievements.until_ms, excluded.until_ms),
		   updated_at_ms = excluded.updated_at_ms,
		   updated_at = now()`,
		userID,
		achievementID,
		untilMs,
		nowMs,
	)
	return err
}
