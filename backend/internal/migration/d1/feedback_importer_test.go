package d1

import (
	"strings"
	"testing"
)

func TestPlanFeedbackImportParsesLegacyItemsMessagesAndLikes(t *testing.T) {
	plan, err := PlanFeedbackImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('feedback:item:fb-1','{"id":"fb-1","userId":99011,"username":"alice","title":"  标题  ","contact":"qq@example.com","anonymous":false,"status":"open","createdAt":1700000000000,"updatedAt":1700000000100}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES('msg-1','feedback:messages:fb-1','{"id":"msg-1","feedbackId":"fb-1","role":"user","content":"  内容  ","images":[{"url":"/a.png","type":"image"}],"createdAt":1700000000200,"createdBy":"alice"}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('msg-2','feedback:messages:fb-1','{"role":"admin","content":"已处理","createdAt":"1700000000300","createdBy":"admin"}');
INSERT INTO "kv_sets" ("key","member") VALUES('feedback:likes:fb-1','99012');
`))
	if err != nil {
		t.Fatalf("PlanFeedbackImport returned error: %v", err)
	}

	if len(plan.Items) != 1 {
		t.Fatalf("expected 1 feedback item, got %+v warnings=%+v", plan.Items, plan.Warnings)
	}
	item := plan.Items[0]
	if item.ID != "fb-1" || item.UserID != 99011 || item.Username != "alice" || item.Status != "open" || item.Title == nil || *item.Title != "标题" {
		t.Fatalf("unexpected item: %+v", item)
	}
	if len(plan.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %+v warnings=%+v", plan.Messages, plan.Warnings)
	}
	byID := map[string]FeedbackMessageImportRecord{}
	for _, message := range plan.Messages {
		byID[message.ID] = message
	}
	if byID["msg-1"].Content != "内容" || byID["msg-1"].ImagesJSON != `[{"type":"image","url":"/a.png"}]` {
		t.Fatalf("unexpected first message: %+v", byID["msg-1"])
	}
	if byID["msg-2"].FeedbackID != "fb-1" || byID["msg-2"].Role != "admin" || byID["msg-2"].CreatedAtMs != 1700000000300 {
		t.Fatalf("unexpected second message: %+v", byID["msg-2"])
	}
	if len(plan.Likes) != 1 || plan.Likes[0].FeedbackID != "fb-1" || plan.Likes[0].UserID != 99012 {
		t.Fatalf("unexpected likes: %+v", plan.Likes)
	}
	if len(plan.Users) != 2 {
		t.Fatalf("expected placeholder users for owner and liker, got %+v", plan.Users)
	}
}

func TestPlanFeedbackImportSkipsInvalidRows(t *testing.T) {
	plan, err := PlanFeedbackImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('feedback:item:bad-json','not-json',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('feedback:item:bad-user','{"id":"bad-user","userId":0,"username":"alice","status":"open","createdAt":1,"updatedAt":1}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('feedback:item:bad-status','{"id":"bad-status","userId":99013,"username":"alice","status":"unknown","createdAt":1,"updatedAt":1}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES('bad-role','feedback:messages:fb-1','{"id":"bad-role","role":"robot","content":"x","createdAt":1,"createdBy":"alice"}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('empty-message','feedback:messages:fb-1','{"id":"empty-message","role":"user","content":"","images":[],"createdAt":1,"createdBy":"alice"}');
INSERT INTO "kv_sets" ("key","member") VALUES('feedback:likes:fb-1','bad-user');
`))
	if err != nil {
		t.Fatalf("PlanFeedbackImport returned error: %v", err)
	}
	if len(plan.Items) != 0 || len(plan.Messages) != 0 || len(plan.Likes) != 0 {
		t.Fatalf("expected invalid rows to be skipped, got items=%+v messages=%+v likes=%+v", plan.Items, plan.Messages, plan.Likes)
	}
	if len(plan.Warnings) < 6 {
		t.Fatalf("expected warnings for invalid rows, got %+v", plan.Warnings)
	}
}
