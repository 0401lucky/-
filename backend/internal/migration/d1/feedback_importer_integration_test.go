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

func TestApplyFeedbackImportWritesItemsMessagesAndLikes(t *testing.T) {
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

	ownerID := int64(99021)
	likerID := int64(99022)
	feedbackID := "fb-import-99021"
	cleanup := func() {
		_, _ = db.Exec(ctx, `DELETE FROM feedback_items WHERE id = $1`, feedbackID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, ownerID, likerID)
	}
	cleanup()
	defer cleanup()

	plan, err := PlanFeedbackImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('feedback:item:fb-import-99021','{"id":"fb-import-99021","userId":99021,"username":"alice","title":"导入反馈","contact":"qq@example.com","anonymous":false,"status":"processing","createdAt":1700000000000,"updatedAt":1700000000100}',NULL);
INSERT INTO "kv_lists" ("id","key","value") VALUES('msg-import-1','feedback:messages:fb-import-99021','{"id":"msg-import-1","feedbackId":"fb-import-99021","role":"user","content":"内容","createdAt":1700000000200,"createdBy":"alice"}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('msg-import-2','feedback:messages:fb-import-99021','{"id":"msg-import-2","feedbackId":"fb-import-99021","role":"admin","content":"回复","createdAt":1700000000300,"createdBy":"admin"}');
INSERT INTO "kv_lists" ("id","key","value") VALUES('msg-missing','feedback:messages:missing-feedback','{"id":"msg-missing","role":"user","content":"孤儿留言","createdAt":1700000000400,"createdBy":"bob"}');
INSERT INTO "kv_sets" ("key","member") VALUES('feedback:likes:fb-import-99021','99022');
INSERT INTO "kv_sets" ("key","member") VALUES('feedback:likes:missing-feedback','99022');
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyFeedbackImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 2 || result.ItemsUpserted != 1 || result.MessagesUpserted != 2 || result.LikesUpserted != 1 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	if len(result.Warnings) < 2 {
		t.Fatalf("expected warnings for missing feedback rows, got %+v", result.Warnings)
	}

	var status string
	var title string
	if err := db.QueryRow(ctx,
		`SELECT status, title FROM feedback_items WHERE id = $1`,
		feedbackID,
	).Scan(&status, &title); err != nil {
		t.Fatalf("query feedback item failed: %v", err)
	}
	if status != "processing" || title != "导入反馈" {
		t.Fatalf("unexpected feedback item status=%q title=%q", status, title)
	}

	var messageCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM feedback_messages WHERE feedback_id = $1`, feedbackID).Scan(&messageCount); err != nil {
		t.Fatalf("query message count failed: %v", err)
	}
	if messageCount != 2 {
		t.Fatalf("expected 2 messages, got %d", messageCount)
	}

	var likeCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM feedback_likes WHERE feedback_id = $1`, feedbackID).Scan(&likeCount); err != nil {
		t.Fatalf("query like count failed: %v", err)
	}
	if likeCount != 1 {
		t.Fatalf("expected 1 like, got %d", likeCount)
	}

	again, err := ApplyFeedbackImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("repeat apply import failed: %v", err)
	}
	if again.ItemsUpserted != 1 || again.MessagesUpserted != 2 || again.LikesUpserted != 1 {
		t.Fatalf("repeat import should upsert same rows, got %+v", again)
	}
}
