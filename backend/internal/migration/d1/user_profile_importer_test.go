package d1

import (
	"strings"
	"testing"
)

func TestPlanUserProfilesImportParsesCustomProfile(t *testing.T) {
	plan, err := PlanUserProfilesImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99001','{"displayName":"  小明  ","avatarUrl":"https://example.com/a.png","qqEmail":"123456@QQ.com","updatedAt":1700000000000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:session:99001','{"displayName":"ignored"}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserProfilesImport returned error: %v", err)
	}
	if len(plan.Users) != 1 {
		t.Fatalf("expected 1 placeholder user, got %d", len(plan.Users))
	}
	if len(plan.Profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(plan.Profiles))
	}

	profile := plan.Profiles[0]
	if profile.UserID != 99001 {
		t.Fatalf("unexpected user id: %d", profile.UserID)
	}
	if profile.DisplayName == nil || *profile.DisplayName != "小明" {
		t.Fatalf("unexpected display name: %#v", profile.DisplayName)
	}
	if profile.AvatarURL == nil || *profile.AvatarURL != "https://example.com/a.png" {
		t.Fatalf("unexpected avatar url: %#v", profile.AvatarURL)
	}
	if profile.QQEmail == nil || *profile.QQEmail != "123456@qq.com" {
		t.Fatalf("unexpected qq email: %#v", profile.QQEmail)
	}
	if profile.UpdatedAtMs == nil || *profile.UpdatedAtMs != 1700000000000 {
		t.Fatalf("unexpected updatedAt: %#v", profile.UpdatedAtMs)
	}
	if len(plan.Warnings) != 0 {
		t.Fatalf("expected no warnings, got %#v", plan.Warnings)
	}
}

func TestPlanUserProfilesImportSkipsInvalidFields(t *testing.T) {
	plan, err := PlanUserProfilesImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99002','{"displayName":"bad\u0001name","avatarUrl":"ftp://bad","qqEmail":"bad"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:not-number','{"displayName":"Alice"}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99003','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99005','{"displayName":"🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂"}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserProfilesImport returned error: %v", err)
	}
	if len(plan.Users) != 0 || len(plan.Profiles) != 0 {
		t.Fatalf("invalid rows should be skipped: %+v", plan)
	}
	if len(plan.Warnings) != 6 {
		t.Fatalf("expected 6 warnings, got %d: %#v", len(plan.Warnings), plan.Warnings)
	}
}

func TestPlanUserProfilesImportAllowsClearedProfileWithUpdatedAt(t *testing.T) {
	plan, err := PlanUserProfilesImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('user:profile:custom:99004','{"displayName":"","avatarUrl":null,"qqEmail":"","updatedAt":1700000000100}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanUserProfilesImport returned error: %v", err)
	}
	if len(plan.Profiles) != 1 {
		t.Fatalf("expected cleared profile row with updatedAt, got %d", len(plan.Profiles))
	}
	if plan.Profiles[0].DisplayName != nil || plan.Profiles[0].AvatarURL != nil || plan.Profiles[0].QQEmail != nil {
		t.Fatalf("expected cleared nullable fields: %+v", plan.Profiles[0])
	}
}
