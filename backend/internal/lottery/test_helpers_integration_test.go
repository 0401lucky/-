//go:build integration

package lottery

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func cleanupLotteryIntegrationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, recordID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1 OR data->>'lotteryRecordId' = $2`, userID, recordID)
	_, _ = db.Exec(ctx, `DELETE FROM game_records WHERE user_id = $1 OR session_id = $2`, userID, recordID)
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM number_bomb_bets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM lottery_daily_spins WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM lottery_records WHERE id = $1 OR user_id = $2`, recordID, userID)
	_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}
