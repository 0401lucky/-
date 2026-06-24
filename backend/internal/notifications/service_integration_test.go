//go:build integration

package notifications

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
	"time"

	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCountUnreadCountsOnlyUnreadNotificationsForUser(t *testing.T) {
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

	userID := int64(61001 + time.Now().UnixNano()%1_000_000_000)
	otherUserID := userID + 1
	cleanupNotificationIntegrationUser(t, ctx, db, userID)
	cleanupNotificationIntegrationUser(t, ctx, db, otherUserID)
	defer cleanupNotificationIntegrationUser(t, ctx, db, userID)
	defer cleanupNotificationIntegrationUser(t, ctx, db, otherUserID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, created_at_ms, read_at_ms)
		 VALUES
		   ($1, $2, 'system', '未读 1', '内容', $6, NULL),
		   ($3, $2, 'wallet', '未读 2', '内容', $6 + 1, NULL),
		   ($4, $2, 'system', '已读', '内容', $6 + 2, $6 + 3),
		   ($5, $7, 'system', '其他用户未读', '内容', $6 + 4, NULL)`,
		"notify-service-unread-1-"+strconv.FormatInt(userID, 10),
		userID,
		"notify-service-unread-2-"+strconv.FormatInt(userID, 10),
		"notify-service-read-"+strconv.FormatInt(userID, 10),
		"notify-service-other-"+strconv.FormatInt(userID, 10),
		nowMs,
		otherUserID,
	); err != nil {
		t.Fatalf("seed notifications failed: %v", err)
	}

	count, err := NewService(db).CountUnread(ctx, userID)
	if err != nil {
		t.Fatalf("count unread failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 unread notifications, got %d", count)
	}

	result, err := NewService(db).List(ctx, userID, ListOptions{Page: 1, Limit: 2, Filter: FilterAll})
	if err != nil {
		t.Fatalf("list notifications failed: %v", err)
	}
	if result.UnreadCount != 2 || result.Pagination.Total != 3 || result.Pagination.TotalPages != 2 || !result.Pagination.HasMore {
		t.Fatalf("unexpected list summary: %+v", result)
	}
	if len(result.Items) != 2 || result.Items[0].ID != "notify-service-read-"+strconv.FormatInt(userID, 10) || !result.Items[0].IsRead {
		t.Fatalf("unexpected first page items: %+v", result.Items)
	}
	if result.Counts.All != 3 || result.Counts.Unread != 2 || result.Counts.Redeem != 1 || result.Counts.System != 2 {
		t.Fatalf("unexpected counts: %+v", result.Counts)
	}

	unreadResult, err := NewService(db).List(ctx, userID, ListOptions{Page: 1, Limit: 10, Filter: FilterUnread})
	if err != nil {
		t.Fatalf("list unread notifications failed: %v", err)
	}
	if unreadResult.Pagination.Total != 2 || len(unreadResult.Items) != 2 {
		t.Fatalf("unexpected unread result: %+v", unreadResult)
	}
	for _, item := range unreadResult.Items {
		if item.IsRead {
			t.Fatalf("unread filter returned read item: %+v", item)
		}
	}

	walletResult, err := NewService(db).List(ctx, userID, ListOptions{Page: 1, Limit: 10, Type: TypeWallet})
	if err != nil {
		t.Fatalf("list wallet notifications failed: %v", err)
	}
	if walletResult.Pagination.Total != 1 || len(walletResult.Items) != 1 || walletResult.Items[0].Type != TypeWallet {
		t.Fatalf("unexpected wallet result: %+v", walletResult)
	}

	markResult, err := NewService(db).MarkRead(ctx, userID, MarkReadOptions{
		IDs:   []string{"notify-service-unread-1-" + strconv.FormatInt(userID, 10), "missing-id"},
		NowMs: nowMs + 10,
	})
	if err != nil {
		t.Fatalf("mark read failed: %v", err)
	}
	if markResult.Updated != 1 || markResult.UnreadCount != 1 {
		t.Fatalf("unexpected mark read result: %+v", markResult)
	}

	deleteUnreadResult, err := NewService(db).Delete(ctx, userID, []string{"notify-service-unread-2-" + strconv.FormatInt(userID, 10)})
	if err != nil {
		t.Fatalf("delete unread failed: %v", err)
	}
	if deleteUnreadResult.Deleted != 0 || deleteUnreadResult.UnreadCount != 1 {
		t.Fatalf("unread item should not be deleted, got %+v", deleteUnreadResult)
	}

	markAllResult, err := NewService(db).MarkRead(ctx, userID, MarkReadOptions{MarkAll: true, NowMs: nowMs + 20})
	if err != nil {
		t.Fatalf("mark all read failed: %v", err)
	}
	if markAllResult.Updated != 1 || markAllResult.UnreadCount != 0 {
		t.Fatalf("unexpected mark all result: %+v", markAllResult)
	}

	otherUnread, err := NewService(db).CountUnread(ctx, otherUserID)
	if err != nil {
		t.Fatalf("count other unread failed: %v", err)
	}
	if otherUnread != 1 {
		t.Fatalf("other user unread count should remain 1, got %d", otherUnread)
	}

	deleteResult, err := NewService(db).Delete(ctx, userID, []string{"notify-service-read-" + strconv.FormatInt(userID, 10), "notify-service-other-" + strconv.FormatInt(userID, 10)})
	if err != nil {
		t.Fatalf("delete read failed: %v", err)
	}
	if deleteResult.Deleted != 1 || deleteResult.UnreadCount != 0 {
		t.Fatalf("unexpected delete result: %+v", deleteResult)
	}

	var ownTotal int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM notifications WHERE user_id = $1`, userID).Scan(&ownTotal); err != nil {
		t.Fatalf("count own notifications after delete failed: %v", err)
	}
	if ownTotal != 2 {
		t.Fatalf("expected 2 own notifications after deleting one read item, got %d", ownTotal)
	}
}

func cleanupNotificationIntegrationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup notification user %d failed: %v", userID, err)
	}
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("cannot resolve test file path")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
