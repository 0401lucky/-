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

func TestApplyNotificationsImportWritesNotifications(t *testing.T) {
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

	userID := int64(99401)
	if _, err := db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup notifications failed: %v", err)
	}
	if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Fatalf("cleanup user failed: %v", err)
	}
	defer func() {
		_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}()

	plan, err := PlanNotificationsImport(strings.NewReader(`
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-99401-1','{"id":"notif-99401-1","userId":99401,"type":"system","title":"导入通知","content":"内容","data":{"link":"/notifications"},"createdAt":1700000000000}',NULL);
INSERT INTO "kv_data" ("key","value","expires_at") VALUES('notifications:item:notif-99401-2','{"id":"notif-99401-2","userId":99401,"type":"wallet","title":"已读通知","content":"内容","createdAt":1700000000100,"readAt":1700000000200}',NULL);
`))
	if err != nil {
		t.Fatalf("plan import failed: %v", err)
	}
	result, err := ApplyNotificationsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("apply import failed: %v", err)
	}
	if result.UsersUpserted != 1 || result.NotificationsUpserted != 2 {
		t.Fatalf("unexpected import result: %+v", result)
	}

	var username string
	if err := db.QueryRow(ctx, `SELECT username FROM users WHERE id = $1`, userID).Scan(&username); err != nil {
		t.Fatalf("query placeholder user failed: %v", err)
	}
	if username != "user_99401" {
		t.Fatalf("unexpected placeholder username: %s", username)
	}

	var unreadCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at_ms IS NULL`, userID).Scan(&unreadCount); err != nil {
		t.Fatalf("query unread count failed: %v", err)
	}
	if unreadCount != 1 {
		t.Fatalf("expected 1 unread notification, got %d", unreadCount)
	}

	var title string
	var dataLink string
	if err := db.QueryRow(ctx,
		`SELECT title, data->>'link'
		   FROM notifications
		  WHERE id = 'notif-99401-1'`,
	).Scan(&title, &dataLink); err != nil {
		t.Fatalf("query imported notification failed: %v", err)
	}
	if title != "导入通知" || dataLink != "/notifications" {
		t.Fatalf("unexpected notification title=%q link=%q", title, dataLink)
	}

	again, err := ApplyNotificationsImport(ctx, db, plan)
	if err != nil {
		t.Fatalf("repeat apply import failed: %v", err)
	}
	if again.NotificationsUpserted != 2 {
		t.Fatalf("repeat import should upsert 2 notifications, got %+v", again)
	}
	var total int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id = $1`, userID).Scan(&total); err != nil {
		t.Fatalf("query total notifications failed: %v", err)
	}
	if total != 2 {
		t.Fatalf("repeat import should keep 2 notifications, got %d", total)
	}
}
