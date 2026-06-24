//go:build integration

package rewards

import (
	"context"
	"os"
	"sync"
	"testing"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestClaimPointsRewardIsIdempotent(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	user := auth.User{ID: 99201, Username: "reward_user", DisplayName: "Reward User"}
	batchID := "reward-batch-99201"
	notificationID := "reward-notif-99201"
	cleanupRewardClaimTestData(t, ctx, db, user.ID, batchID, notificationID)
	defer cleanupRewardClaimTestData(t, ctx, db, user.ID, batchID, notificationID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name`,
		user.ID,
		user.Username,
		user.DisplayName,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 10)
		 ON CONFLICT (user_id) DO UPDATE SET balance = 10`,
		user.ID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO reward_batches (
		   id, type, amount, target_mode, target_user_ids, title, message, created_by,
		   created_at_ms, status, total_targets, distributed_count
		 ) VALUES ($1, 'points', 25, 'selected', '[]'::jsonb, '奖励', '内容', 'admin', 1700000000000, 'completed', 1, 1)`,
		batchID,
	); err != nil {
		t.Fatalf("insert reward batch failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms)
		 VALUES ($1, $2, 'reward', '奖励通知', '内容', $3::jsonb, 1700000000100)`,
		notificationID,
		user.ID,
		`{"rewardBatchId":"reward-batch-99201","rewardType":"points","rewardAmount":25,"claimStatus":"pending"}`,
	); err != nil {
		t.Fatalf("insert notification failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO reward_claims (id, batch_id, user_id, notification_id, type, amount, status)
		 VALUES ('reward-claim-99201', $1, $2, $3, 'points', 25, 'pending')`,
		batchID,
		user.ID,
		notificationID,
	); err != nil {
		t.Fatalf("insert reward claim failed: %v", err)
	}

	service := NewService(db, economy.NewService(db), nil)
	result, err := service.Claim(ctx, user, notificationID)
	if err != nil {
		t.Fatalf("claim reward failed: %v", err)
	}
	if !result.Success || result.ClaimStatus != "claimed" {
		t.Fatalf("unexpected claim result: %+v", result)
	}

	again, err := service.Claim(ctx, user, notificationID)
	if err != nil {
		t.Fatalf("repeat claim reward failed: %v", err)
	}
	if !again.Success || again.Message != "奖励已领取" {
		t.Fatalf("unexpected repeat claim result: %+v", again)
	}

	var balance int64
	var status string
	var notificationStatus string
	var readAt *int64
	var claimedCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance, c.status, n.data->>'claimStatus', n.read_at_ms, b.claimed_count
		   FROM point_accounts p
		   JOIN reward_claims c ON c.user_id = p.user_id
		   JOIN notifications n ON n.id = c.notification_id
		   JOIN reward_batches b ON b.id = c.batch_id
		  WHERE p.user_id = $1`,
		user.ID,
	).Scan(&balance, &status, &notificationStatus, &readAt, &claimedCount); err != nil {
		t.Fatalf("query claim state failed: %v", err)
	}
	if balance != 35 || status != "claimed" || notificationStatus != "claimed" || readAt == nil || claimedCount != 1 {
		t.Fatalf("unexpected state balance=%d status=%s notification=%s readAt=%v claimed=%d", balance, status, notificationStatus, readAt, claimedCount)
	}
}

func TestClaimPointsRewardRebuildsMissingClaimAndHandlesConcurrency(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()

	if _, err := pgmigration.NewRunner(db, migrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	user := auth.User{ID: 99202, Username: "reward_rebuild", DisplayName: "Reward Rebuild"}
	batchID := "reward-batch-99202"
	notificationID := "reward-notif-99202"
	cleanupRewardClaimTestData(t, ctx, db, user.ID, batchID, notificationID)
	defer cleanupRewardClaimTestData(t, ctx, db, user.ID, batchID, notificationID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name) VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name`,
		user.ID,
		user.Username,
		user.DisplayName,
	); err != nil {
		t.Fatalf("insert user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance) VALUES ($1, 0)
		 ON CONFLICT (user_id) DO UPDATE SET balance = 0`,
		user.ID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms)
		 VALUES ($1, $2, 'reward', '恢复奖励', '内容', $3::jsonb, 1700000000200)`,
		notificationID,
		user.ID,
		`{"rewardBatchId":"reward-batch-99202","rewardType":"points","rewardAmount":40,"claimStatus":"pending"}`,
	); err != nil {
		t.Fatalf("insert notification failed: %v", err)
	}

	service := NewService(db, economy.NewService(db), nil)
	var waitGroup sync.WaitGroup
	errors := make(chan error, 8)
	for i := 0; i < 8; i++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			result, err := service.Claim(ctx, user, notificationID)
			if err != nil {
				errors <- err
				return
			}
			if !result.Success {
				errors <- os.ErrInvalid
			}
		}()
	}
	waitGroup.Wait()
	close(errors)
	for err := range errors {
		t.Fatalf("concurrent claim failed: %v", err)
	}

	var balance int64
	var claims int64
	var ledgers int64
	if err := db.QueryRow(ctx,
		`SELECT
		    (SELECT balance FROM point_accounts WHERE user_id = $1),
		    (SELECT COUNT(*) FROM reward_claims WHERE user_id = $1 AND notification_id = $2),
		    (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'reward_claim')
		`,
		user.ID,
		notificationID,
	).Scan(&balance, &claims, &ledgers); err != nil {
		t.Fatalf("query concurrent claim state failed: %v", err)
	}
	if balance != 40 || claims != 1 || ledgers != 1 {
		t.Fatalf("expected one grant and one rebuilt claim, got balance=%d claims=%d ledgers=%d", balance, claims, ledgers)
	}
}

func cleanupRewardClaimTestData(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, batchID string, notificationID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM reward_claims WHERE user_id = $1 OR batch_id = $2 OR notification_id = $3`, userID, batchID, notificationID)
	_, _ = db.Exec(ctx, `DELETE FROM reward_batches WHERE id = $1`, batchID)
	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1 OR id = $2`, userID, notificationID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	return "../../migrations"
}
