package d1

import (
	"strings"
	"testing"
)

func TestPlanUsersPointsImportUsesNativeBalanceBeforeLegacy(t *testing.T) {
	plan, err := PlanUsersPointsImport(strings.NewReader(`
INSERT INTO "native_users" ("user_id","username","first_seen","updated_at") VALUES(100,'alice',1000,2000);
INSERT INTO "native_user_points" ("user_id","balance","updated_at") VALUES(100,300,2000);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:100','999',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:101','{"id":101,"username":"bob","firstSeen":3000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:101','50',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUsersPointsImport returned error: %v", err)
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected 2 users, got %d", len(plan.Users))
	}
	if len(plan.PointAccounts) != 2 {
		t.Fatalf("expected 2 point accounts, got %d", len(plan.PointAccounts))
	}

	balances := map[int64]int64{}
	for _, account := range plan.PointAccounts {
		balances[account.UserID] = account.Balance
	}
	if balances[100] != 300 {
		t.Fatalf("native balance should win for user 100, got %d", balances[100])
	}
	if balances[101] != 50 {
		t.Fatalf("legacy balance should import for user 101, got %d", balances[101])
	}
	if len(plan.Warnings) == 0 {
		t.Fatalf("expected warning when native and legacy balances coexist")
	}
}

func TestPlanUsersPointsImportCreatesPlaceholderUserForOrphanBalance(t *testing.T) {
	plan, err := PlanUsersPointsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('points:102','88',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUsersPointsImport returned error: %v", err)
	}
	if len(plan.Users) != 1 || plan.Users[0].ID != 102 || plan.Users[0].Username != "user_102" {
		t.Fatalf("expected placeholder user for orphan balance, got %+v", plan.Users)
	}
}
