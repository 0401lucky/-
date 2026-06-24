package d1

import (
	"strings"
	"testing"
)

func TestPlanRewardClaimsImportParsesBatchesClaimsAndNotificationFallback(t *testing.T) {
	plan, err := PlanRewardClaimsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:batch:batch-1','{"id":"batch-1","type":"points","amount":30,"targetMode":"selected","targetUserIds":[99011,99012],"title":"奖励","message":"领取奖励","createdBy":"admin","createdAt":1700000000000,"status":"completed","totalTargets":2,"distributedCount":2,"claimedCount":1,"failedClaimCount":0}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:claim:batch-1:99011','{"id":"claim-1","batchId":"batch-1","userId":99011,"notificationId":"notif-claim-1","type":"points","amount":30,"status":"claimed","claimedAt":1700000001000,"retryCount":1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-claim-2','{"id":"notif-claim-2","userId":99012,"type":"reward","title":"奖励","content":"领取","data":{"rewardBatchId":"batch-1","rewardType":"points","rewardAmount":30,"claimStatus":"pending"},"createdAt":1700000000200}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-other','{"id":"notif-other","userId":99012,"type":"system","title":"系统","content":"内容","createdAt":1700000000300}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanRewardClaimsImport returned error: %v", err)
	}

	if len(plan.Batches) != 1 {
		t.Fatalf("expected 1 batch, got %+v warnings=%+v", plan.Batches, plan.Warnings)
	}
	batch := plan.Batches[0]
	if batch.ID != "batch-1" || batch.Type != "points" || batch.Amount != "30" || batch.TargetUserIDsJSON != `[99011,99012]` {
		t.Fatalf("unexpected batch: %+v", batch)
	}
	if len(plan.Claims) != 2 {
		t.Fatalf("expected 2 claims, got %+v warnings=%+v", plan.Claims, plan.Warnings)
	}
	byUser := map[int64]RewardClaimImportRecord{}
	for _, claim := range plan.Claims {
		byUser[claim.UserID] = claim
	}
	if byUser[99011].ID != "claim-1" || byUser[99011].Status != "claimed" || byUser[99011].ClaimedAtMs == nil {
		t.Fatalf("unexpected explicit claim: %+v", byUser[99011])
	}
	if byUser[99012].ID != "notification-notif-claim-2" || byUser[99012].Status != "pending" || byUser[99012].NotificationID != "notif-claim-2" {
		t.Fatalf("unexpected fallback claim: %+v", byUser[99012])
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected 2 placeholder users, got %+v", plan.Users)
	}
}

func TestPlanRewardClaimsImportPrefersExplicitClaimOverNotificationFallback(t *testing.T) {
	plan, err := PlanRewardClaimsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:claim:batch-2:99021','{"id":"claim-explicit","batchId":"batch-2","userId":99021,"notificationId":"notif-explicit","type":"quota","amount":2.5,"status":"failed","failReason":"失败","retryCount":2}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-explicit','{"id":"notif-explicit","userId":99021,"type":"reward","title":"奖励","content":"领取","data":{"rewardBatchId":"batch-2","rewardType":"quota","rewardAmount":2.5,"claimStatus":"pending"},"createdAt":1700000000200}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanRewardClaimsImport returned error: %v", err)
	}
	if len(plan.Claims) != 1 {
		t.Fatalf("expected 1 claim, got %+v", plan.Claims)
	}
	claim := plan.Claims[0]
	if claim.ID != "claim-explicit" || claim.Status != "failed" || claim.Amount != "2.5" || claim.FailReason == nil || *claim.FailReason != "失败" {
		t.Fatalf("expected explicit claim to win, got %+v", claim)
	}
}

func TestPlanRewardClaimsImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanRewardClaimsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:batch:bad-json','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:batch:bad-type','{"id":"bad-type","type":"bad","amount":1,"targetMode":"all","title":"t","message":"m","createdBy":"a","createdAt":1,"status":"completed"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('rewards:claim:bad:0','{"id":"bad-claim","batchId":"bad","userId":0,"notificationId":"n","type":"points","amount":1,"status":"pending"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-reward','{"id":"bad-reward","userId":99031,"type":"reward","title":"奖励","content":"领取","data":{"rewardBatchId":"","rewardType":"points","rewardAmount":0},"createdAt":1}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanRewardClaimsImport returned error: %v", err)
	}
	if len(plan.Batches) != 0 || len(plan.Claims) != 0 {
		t.Fatalf("expected invalid rows skipped, got batches=%+v claims=%+v", plan.Batches, plan.Claims)
	}
	if len(plan.Warnings) < 4 {
		t.Fatalf("expected warnings, got %+v", plan.Warnings)
	}
}
