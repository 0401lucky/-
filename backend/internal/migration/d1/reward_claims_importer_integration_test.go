//go:build integration

package d1

import (
	"context"
	"os"
	"strings"
	"testing"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestApplyRewardClaimsImportWritesBatchesAndClaims(t *testing.T) {
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

	userID := int64(99301)
	batchID := "batch-99301"
	notificationID := "notif-99301"
	if _, err := db.Exec(ctx, `DELETE FROM reward_claims WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup reward claims failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM reward_batches WHERE id = $1`, batchID); err != nil {
		t.Fatalf("cleanup reward batch failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("cleanup user failed: %v", err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM reward_claims WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM reward_batches WHERE id = $1`, batchID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	plan, err := PlanRewardClaimsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:batch:batch-99301','{"id":"batch-99301","type":"points","amount":88,"targetMode":"selected","targetUserIds":[99301],"title":"导入奖励","message":"内容","createdBy":"admin","createdAt":1700000000000,"status":"completed","totalTargets":1,"distributedCount":1,"claimedCount":0,"failedClaimCount":0}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-99301','{"id":"notif-99301","userId":99301,"type":"reward","title":"导入奖励","content":"内容","data":{"rewardBatchId":"batch-99301","rewardType":"points","rewardAmount":88,"claimStatus":"pending"},"createdAt":1700000000100}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyRewardClaimsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.BatchesUpserted != 1 || result.ClaimsUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var batchTitle string
	var claimStatus string
	var amount string
	if err := db.QueryRow(ctx,
		`SELECT b.title, c.status, trim(trailing '.' from trim(trailing '0' from c.amount::text))
		   FROM reward_batches b
		   JOIN reward_claims c ON c.batch_id = b.id
		  WHERE b.id = $1 AND c.notification_id = $2`,
		batchID,
		notificationID,
	).Scan(&batchTitle, &claimStatus, &amount); err != nil {
		t.Fatalf("query imported reward data failed: %v", err)
	}
	if batchTitle != "导入奖励" || claimStatus != "pending" || amount != "88" {
		t.Fatalf("unexpected imported reward data title=%q status=%q amount=%q", batchTitle, claimStatus, amount)
	}

	again, err := ApplyRewardClaimsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("repeat apply import failed: %v", err)
	}
	if again.ClaimsUpserted != 1 {
		t.Fatalf("repeat import should upsert 1 claim, got %+v", again)
	}
	var total int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM reward_claims WHERE user_id = $1`, userID).Scan(&total); err != nil {
		t.Fatalf("query claim total failed: %v", err)
	}
	if total != 1 {
		t.Fatalf("repeat import should keep 1 claim, got %d", total)
	}
}
