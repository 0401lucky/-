//go:build integration

package announcements

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"redemption/backend/internal/auth"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServicePublishesAnnouncementsAndFansOutNotifications(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过公告集成测试")
	}

	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, "../../migrations").Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	baseID := int64(850001 + time.Now().UnixNano()%1_000_000_000)
	userIDs := []int64{baseID, baseID + 1}
	cleanupAnnouncementIntegrationState(t, ctx, db, userIDs)
	defer cleanupAnnouncementIntegrationState(t, ctx, db, userIDs)

	for index, userID := range userIDs {
		if _, err := db.Exec(ctx,
			`INSERT INTO users (id, username, display_name)
			 VALUES ($1, $2, $3)`,
			userID,
			"announcement_user_"+strconv.Itoa(index),
			"Announcement User "+strconv.Itoa(index),
		); err != nil {
			t.Fatalf("seed user %d failed: %v", userID, err)
		}
	}
	expectedFanout := countAnnouncementTargetUsers(t, ctx, db)
	if expectedFanout < int64(len(userIDs)) {
		t.Fatalf("expected at least seeded users for fanout, got %d", expectedFanout)
	}

	now := time.Date(2026, 6, 25, 10, 0, 0, 0, time.UTC)
	service := NewServiceWithNow(db, func() time.Time { return now })
	admin := auth.User{ID: 1, Username: "admin", DisplayName: "Admin", IsAdmin: true}

	draft, err := service.Create(ctx, SaveInput{
		Title:   "维护通知",
		Content: "今天会进行维护",
		Status:  StatusDraft,
	}, admin)
	if err != nil {
		t.Fatalf("create draft failed: %v", err)
	}
	if draft.Announcement.Status != StatusDraft || draft.NotifiedUsers != 0 {
		t.Fatalf("unexpected draft result: %+v", draft)
	}
	assertAnnouncementNotificationCount(t, ctx, db, draft.Announcement.ID, 0)

	publishedStatus := StatusPublished
	published, err := service.Update(ctx, draft.Announcement.ID, UpdateInput{Status: &publishedStatus, HasStatus: true}, admin)
	if err != nil {
		t.Fatalf("publish draft failed: %v", err)
	}
	if published.Announcement.Status != StatusPublished || published.Announcement.PublishedAt == nil || published.NotifiedUsers != expectedFanout {
		t.Fatalf("unexpected publish result: %+v", published)
	}
	assertAnnouncementNotificationCount(t, ctx, db, draft.Announcement.ID, expectedFanout)

	secondPublish, err := service.Update(ctx, draft.Announcement.ID, UpdateInput{Status: &publishedStatus, HasStatus: true}, admin)
	if err != nil {
		t.Fatalf("repeat publish failed: %v", err)
	}
	if secondPublish.NotifiedUsers != 0 {
		t.Fatalf("repeat publish should not fan out again: %+v", secondPublish)
	}
	assertAnnouncementNotificationCount(t, ctx, db, draft.Announcement.ID, expectedFanout)

	list, err := service.ListPublished(ctx, ListOptions{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("list published failed: %v", err)
	}
	if !containsAnnouncement(list.Items, draft.Announcement.ID) {
		t.Fatalf("published list should contain announcement %s: %+v", draft.Announcement.ID, list.Items)
	}

	archived, err := service.Archive(ctx, draft.Announcement.ID, admin)
	if err != nil {
		t.Fatalf("archive failed: %v", err)
	}
	if archived.Status != StatusArchived || archived.PublishedAt != nil {
		t.Fatalf("unexpected archived item: %+v", archived)
	}

	afterArchive, err := service.ListPublished(ctx, ListOptions{Page: 1, Limit: 10})
	if err != nil {
		t.Fatalf("list after archive failed: %v", err)
	}
	if containsAnnouncement(afterArchive.Items, draft.Announcement.ID) {
		t.Fatalf("archived announcement should be hidden from published list: %+v", afterArchive.Items)
	}
}

func assertAnnouncementNotificationCount(t *testing.T, ctx context.Context, db *pgxpool.Pool, announcementID string, expected int64) {
	t.Helper()

	var dedupeCount int64
	var notificationCount int64
	if err := db.QueryRow(ctx,
		`SELECT
		   (SELECT count(*) FROM announcement_notifications WHERE announcement_id = $1),
		   (SELECT count(*) FROM notifications WHERE data->>'announcementId' = $1)`,
		announcementID,
	).Scan(&dedupeCount, &notificationCount); err != nil {
		t.Fatalf("query announcement notification counts failed: %v", err)
	}
	if dedupeCount != expected || notificationCount != expected {
		t.Fatalf("unexpected notification counts for %s: dedupe=%d notifications=%d expected=%d", announcementID, dedupeCount, notificationCount, expected)
	}
}

func countAnnouncementTargetUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool) int64 {
	t.Helper()

	var count int64
	if err := db.QueryRow(ctx, `SELECT count(*) FROM users WHERE id > 0`).Scan(&count); err != nil {
		t.Fatalf("count users failed: %v", err)
	}
	return count
}

func containsAnnouncement(items []Item, id string) bool {
	for _, item := range items {
		if item.ID == id {
			return true
		}
	}
	return false
}

func cleanupAnnouncementIntegrationState(t *testing.T, ctx context.Context, db *pgxpool.Pool, userIDs []int64) {
	t.Helper()

	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE data->>'announcementId' IN (SELECT id FROM announcements WHERE title = '维护通知')`)
	_, _ = db.Exec(ctx, `DELETE FROM announcement_notifications WHERE announcement_id IN (SELECT id FROM announcements WHERE title = '维护通知')`)
	_, _ = db.Exec(ctx, `DELETE FROM announcements WHERE title = '维护通知'`)

	for _, userID := range userIDs {
		_, _ = db.Exec(ctx, `DELETE FROM announcement_notifications WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM user_assets WHERE user_id = $1`, userID)
		_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	}
}
