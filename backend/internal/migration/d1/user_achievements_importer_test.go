package d1

import (
	"strings"
	"testing"
)

func TestPlanUserAchievementsImportParsesLegacyAchievementKeys(t *testing.T) {
	plan, err := PlanUserAchievementsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievements:99001','{"beginner":{"id":"beginner","source":"auto","grantedAt":1700000000000,"reason":"注册","metadata":{"from":"legacy"}},"peak_first":{"id":"peak_first","source":"ranking_monthly","grantedAt":1700000000100,"expiresAt":1702592000000,"grantedBy":{"id":1,"username":"admin"}}}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:equipped:99001','"peak_first"',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:forced:99001','{"id":"thief","until":1700003600000}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserAchievementsImport returned error: %v", err)
	}
	if len(plan.Users) != 1 {
		t.Fatalf("expected 1 placeholder user, got %d", len(plan.Users))
	}
	if len(plan.Grants) != 2 {
		t.Fatalf("expected 2 grants, got %d", len(plan.Grants))
	}
	if len(plan.Equipped) != 1 || plan.Equipped[0].AchievementID != "peak_first" {
		t.Fatalf("unexpected equipped records: %+v", plan.Equipped)
	}
	if len(plan.Forced) != 1 || plan.Forced[0].AchievementID != "thief" || plan.Forced[0].UntilMs != 1700003600000 {
		t.Fatalf("unexpected forced records: %+v", plan.Forced)
	}

	grants := map[string]AchievementGrantImportRecord{}
	for _, grant := range plan.Grants {
		grants[grant.AchievementID] = grant
	}
	if grants["beginner"].Source != "auto" || grants["beginner"].Reason == nil || *grants["beginner"].Reason != "注册" {
		t.Fatalf("unexpected beginner grant: %+v", grants["beginner"])
	}
	if grants["peak_first"].Source != "ranking_monthly" || grants["peak_first"].ExpiresAtMs == nil || *grants["peak_first"].ExpiresAtMs != 1702592000000 {
		t.Fatalf("unexpected peak_first grant: %+v", grants["peak_first"])
	}
	if grants["peak_first"].GrantedByUserID == nil || *grants["peak_first"].GrantedByUserID != 1 {
		t.Fatalf("unexpected grantor: %+v", grants["peak_first"])
	}
	if len(plan.Warnings) != 0 {
		t.Fatalf("expected no warnings, got %#v", plan.Warnings)
	}
}

func TestPlanUserAchievementsImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanUserAchievementsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievements:not-number','{}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievements:99002','{"bad":{"id":"unknown","grantedAt":1}}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:equipped:99002','"unknown"',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:achievement:forced:99002','{"id":"thief","until":0}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserAchievementsImport returned error: %v", err)
	}
	if len(plan.Grants) != 0 || len(plan.Equipped) != 0 || len(plan.Forced) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 4 {
		t.Fatalf("expected 4 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}
