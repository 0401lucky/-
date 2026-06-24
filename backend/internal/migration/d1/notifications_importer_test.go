package d1

import (
	"strings"
	"testing"
)

func TestPlanNotificationsImportParsesLegacyItems(t *testing.T) {
	plan, err := PlanNotificationsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:n-1','{"id":"n-1","userId":99001,"type":"system","title":"  系统通知  ","content":"内容","data":{"link":"/notifications"},"createdAt":1700000000000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:n-2','{"userId":"99001","type":"wallet","title":"钱包","content":"到账","createdAt":1700000000100,"readAt":1700000000200}',NULL);
INSERT INTO "kv_zsets" ("key","score","member") VALUES('notifications:user:99001:index',1700000000000,'n-1');
INSERT INTO "kv_sets" ("key","member") VALUES('notifications:user:99001:unread','n-1');
`))
	if err != nil {
		t.Fatalf("PlanNotificationsImport returned error: %v", err)
	}

	if len(plan.Notifications) != 2 {
		t.Fatalf("expected 2 notifications, got %+v warnings=%+v", plan.Notifications, plan.Warnings)
	}
	if len(plan.Users) != 1 || plan.Users[0].ID != 99001 {
		t.Fatalf("expected placeholder user 99001, got %+v", plan.Users)
	}

	byID := map[string]NotificationImportRecord{}
	for _, notification := range plan.Notifications {
		byID[notification.ID] = notification
	}
	first := byID["n-1"]
	if first.UserID != 99001 || first.Type != "system" || first.Title != "系统通知" || first.Content != "内容" || first.DataJSON != `{"link":"/notifications"}` || first.ReadAtMs != nil {
		t.Fatalf("unexpected first notification: %+v", first)
	}
	second := byID["n-2"]
	if second.UserID != 99001 || second.Type != "wallet" || second.ReadAtMs == nil || *second.ReadAtMs != 1700000000200 {
		t.Fatalf("unexpected second notification: %+v", second)
	}
	if len(plan.Warnings) != 1 || !strings.Contains(plan.Warnings[0], "缺少 id") {
		t.Fatalf("expected fallback id warning, got %+v", plan.Warnings)
	}
}

func TestPlanNotificationsImportSkipsInvalidItems(t *testing.T) {
	plan, err := PlanNotificationsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-json','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-user','{"id":"bad-user","userId":0,"type":"system","title":"标题","content":"内容","createdAt":1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-type','{"id":"bad-type","userId":99002,"type":"unknown","title":"标题","content":"内容","createdAt":1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-created','{"id":"bad-created","userId":99002,"type":"system","title":"标题","content":"内容","createdAt":0}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:bad-read','{"id":"bad-read","userId":99002,"type":"system","title":"标题","content":"内容","data":[],"createdAt":100,"readAt":50}',NULL);
`))
	if err != nil {
		t.Fatalf("PlanNotificationsImport returned error: %v", err)
	}

	if len(plan.Notifications) != 1 {
		t.Fatalf("expected only bad-read to be imported as unread, got %+v", plan.Notifications)
	}
	record := plan.Notifications[0]
	if record.ID != "bad-read" || record.ReadAtMs != nil || record.DataJSON != "{}" {
		t.Fatalf("unexpected imported fallback record: %+v", record)
	}
	if len(plan.Warnings) < 5 {
		t.Fatalf("expected warnings for invalid rows, got %+v", plan.Warnings)
	}
}
