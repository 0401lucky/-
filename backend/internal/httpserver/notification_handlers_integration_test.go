//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotificationUnreadCountHTTPReturnsCurrentUserUnreadCount(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(62001 + time.Now().UnixNano()%1_000_000_000)
	otherUserID := userID + 1
	cleanupHTTPTestNotificationUser(t, ctx, db, userID)
	cleanupHTTPTestNotificationUser(t, ctx, db, otherUserID)
	defer cleanupHTTPTestNotificationUser(t, ctx, db, userID)
	defer cleanupHTTPTestNotificationUser(t, ctx, db, otherUserID)

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, created_at_ms, read_at_ms)
		 VALUES
		   ($1, $2, 'system', '未读 1', '内容', $6, NULL),
		   ($3, $2, 'wallet', '未读 2', '内容', $6 + 1, NULL),
		   ($4, $2, 'system', '已读', '内容', $6 + 2, $6 + 3),
		   ($5, $7, 'system', '其他用户未读', '内容', $6 + 4, NULL)`,
		"notify-http-unread-1-"+strconv.FormatInt(userID, 10),
		userID,
		"notify-http-unread-2-"+strconv.FormatInt(userID, 10),
		"notify-http-read-"+strconv.FormatInt(userID, 10),
		"notify-http-other-"+strconv.FormatInt(userID, 10),
		nowMs,
		otherUserID,
	); err != nil {
		t.Fatalf("seed notifications failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodGet, "/api/notifications/unread-count", nil)
	request.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}

	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			UnreadCount int64 `json:"unreadCount"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.UnreadCount != 2 {
		t.Fatalf("unexpected unread count payload: %+v", payload)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/notifications?page=1&limit=2&filter=all", nil)
	listRequest.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))
	listResponse := performRequest(handler, listRequest)
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d body=%s", listResponse.Code, listResponse.Body.String())
	}

	var listPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Items []struct {
				ID     string `json:"id"`
				Type   string `json:"type"`
				IsRead bool   `json:"isRead"`
			} `json:"items"`
			UnreadCount int64 `json:"unreadCount"`
			Pagination  struct {
				Page       int   `json:"page"`
				Limit      int   `json:"limit"`
				Total      int64 `json:"total"`
				TotalPages int   `json:"totalPages"`
				HasMore    bool  `json:"hasMore"`
			} `json:"pagination"`
			Counts struct {
				All    int64 `json:"all"`
				Unread int64 `json:"unread"`
				System int64 `json:"system"`
				Redeem int64 `json:"redeem"`
			} `json:"counts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(listResponse.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode list response failed: %v", err)
	}
	if !listPayload.Success || listPayload.Data.UnreadCount != 2 || listPayload.Data.Pagination.Total != 3 || !listPayload.Data.Pagination.HasMore {
		t.Fatalf("unexpected list payload summary: %+v", listPayload)
	}
	if len(listPayload.Data.Items) != 2 || listPayload.Data.Items[0].ID != "notify-http-read-"+strconv.FormatInt(userID, 10) || !listPayload.Data.Items[0].IsRead {
		t.Fatalf("unexpected list items: %+v", listPayload.Data.Items)
	}
	if listPayload.Data.Counts.All != 3 || listPayload.Data.Counts.Unread != 2 || listPayload.Data.Counts.System != 2 || listPayload.Data.Counts.Redeem != 1 {
		t.Fatalf("unexpected list counts: %+v", listPayload.Data.Counts)
	}

	deleteUnreadRequest := httptest.NewRequest(http.MethodPost, "/api/notifications/delete", strings.NewReader(`{"ids":["notify-http-unread-1-`+strconv.FormatInt(userID, 10)+`"]}`))
	deleteUnreadRequest.Host = "example.com"
	deleteUnreadRequest.Header.Set("Origin", "http://example.com")
	deleteUnreadRequest.Header.Set("Content-Type", "application/json")
	deleteUnreadRequest.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))
	deleteUnreadResponse := performRequest(handler, deleteUnreadRequest)
	if deleteUnreadResponse.Code != http.StatusBadRequest || !strings.Contains(deleteUnreadResponse.Body.String(), "仅可删除已读通知") {
		t.Fatalf("expected unread delete 400, got %d body=%s", deleteUnreadResponse.Code, deleteUnreadResponse.Body.String())
	}

	readRequest := httptest.NewRequest(http.MethodPost, "/api/notifications/read", strings.NewReader(`{"ids":["notify-http-unread-1-`+strconv.FormatInt(userID, 10)+`","missing"],"markAll":false}`))
	readRequest.Host = "example.com"
	readRequest.Header.Set("Origin", "http://example.com")
	readRequest.Header.Set("Content-Type", "application/json")
	readRequest.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))
	readResponse := performRequest(handler, readRequest)
	if readResponse.Code != http.StatusOK {
		t.Fatalf("expected mark read 200, got %d body=%s", readResponse.Code, readResponse.Body.String())
	}
	var readPayload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Updated     int64 `json:"updated"`
			UnreadCount int64 `json:"unreadCount"`
		} `json:"data"`
	}
	if err := json.NewDecoder(readResponse.Body).Decode(&readPayload); err != nil {
		t.Fatalf("decode mark read response failed: %v", err)
	}
	if !readPayload.Success || readPayload.Message != "标记已读成功" || readPayload.Data.Updated != 1 || readPayload.Data.UnreadCount != 1 {
		t.Fatalf("unexpected mark read payload: %+v", readPayload)
	}

	markAllRequest := httptest.NewRequest(http.MethodPost, "/api/notifications/read", strings.NewReader(`{"markAll":true}`))
	markAllRequest.Host = "example.com"
	markAllRequest.Header.Set("Origin", "http://example.com")
	markAllRequest.Header.Set("Content-Type", "application/json")
	markAllRequest.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))
	markAllResponse := performRequest(handler, markAllRequest)
	if markAllResponse.Code != http.StatusOK {
		t.Fatalf("expected mark all 200, got %d body=%s", markAllResponse.Code, markAllResponse.Body.String())
	}
	var markAllPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Updated     int64 `json:"updated"`
			UnreadCount int64 `json:"unreadCount"`
		} `json:"data"`
	}
	if err := json.NewDecoder(markAllResponse.Body).Decode(&markAllPayload); err != nil {
		t.Fatalf("decode mark all response failed: %v", err)
	}
	if !markAllPayload.Success || markAllPayload.Data.Updated != 1 || markAllPayload.Data.UnreadCount != 0 {
		t.Fatalf("unexpected mark all payload: %+v", markAllPayload)
	}

	deleteReadRequest := httptest.NewRequest(http.MethodPost, "/api/notifications/delete", strings.NewReader(`{"ids":["notify-http-read-`+strconv.FormatInt(userID, 10)+`"]}`))
	deleteReadRequest.Host = "example.com"
	deleteReadRequest.Header.Set("Origin", "http://example.com")
	deleteReadRequest.Header.Set("Content-Type", "application/json")
	deleteReadRequest.AddCookie(testSessionCookieFor(userID, "notify_http_user", "Notify HTTP User"))
	deleteReadResponse := performRequest(handler, deleteReadRequest)
	if deleteReadResponse.Code != http.StatusOK {
		t.Fatalf("expected delete read 200, got %d body=%s", deleteReadResponse.Code, deleteReadResponse.Body.String())
	}
	var deleteReadPayload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Deleted     int64 `json:"deleted"`
			UnreadCount int64 `json:"unreadCount"`
		} `json:"data"`
	}
	if err := json.NewDecoder(deleteReadResponse.Body).Decode(&deleteReadPayload); err != nil {
		t.Fatalf("decode delete response failed: %v", err)
	}
	if !deleteReadPayload.Success || deleteReadPayload.Message != "通知已删除" || deleteReadPayload.Data.Deleted != 1 || deleteReadPayload.Data.UnreadCount != 0 {
		t.Fatalf("unexpected delete payload: %+v", deleteReadPayload)
	}
}

func TestNotificationClaimHTTPClaimsPointsReward(t *testing.T) {
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

	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatalf("apply migrations failed: %v", err)
	}

	userID := int64(72001 + time.Now().UnixNano()%1_000_000_000)
	batchID := "notify-claim-batch-" + strconv.FormatInt(userID, 10)
	notificationID := "notify-claim-" + strconv.FormatInt(userID, 10)
	cleanupHTTPTestRewardClaimUser(t, ctx, db, userID, batchID, notificationID)
	defer cleanupHTTPTestRewardClaimUser(t, ctx, db, userID, batchID, notificationID)

	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name)
		 VALUES ($1, 'notify_claim_user', 'Notify Claim User')
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name`,
		userID,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance)
		 VALUES ($1, 5)
		 ON CONFLICT (user_id) DO UPDATE SET balance = 5`,
		userID,
	); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO reward_batches (
		   id, type, amount, target_mode, target_user_ids, title, message, created_by,
		   created_at_ms, status, total_targets, distributed_count
		 ) VALUES ($1, 'points', 33, 'selected', '[]'::jsonb, 'HTTP 奖励', '内容', 'admin', $2, 'completed', 1, 1)`,
		batchID,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed reward batch failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO notifications (id, user_id, type, title, content, data, created_at_ms)
		 VALUES ($1, $2, 'reward', 'HTTP 奖励', '内容', $3::jsonb, $4)`,
		notificationID,
		userID,
		`{"rewardBatchId":"`+batchID+`","rewardType":"points","rewardAmount":33,"claimStatus":"pending"}`,
		time.Now().UnixMilli(),
	); err != nil {
		t.Fatalf("seed reward notification failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO reward_claims (id, batch_id, user_id, notification_id, type, amount, status)
		 VALUES ($1, $2, $3, $4, 'points', 33, 'pending')`,
		"notify-claim-record-"+strconv.FormatInt(userID, 10),
		batchID,
		userID,
		notificationID,
	); err != nil {
		t.Fatalf("seed reward claim failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
	request := httptest.NewRequest(http.MethodPost, "/api/notifications/claim", strings.NewReader(`{"notificationId":"`+notificationID+`"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "notify_claim_user", "Notify Claim User"))

	response := performRequest(handler, request)
	if response.Code != http.StatusOK {
		t.Fatalf("expected claim 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			ClaimStatus string `json:"claimStatus"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode claim response failed: %v", err)
	}
	if !payload.Success || payload.Data.ClaimStatus != "claimed" {
		t.Fatalf("unexpected claim payload: %+v", payload)
	}

	repeatRequest := httptest.NewRequest(http.MethodPost, "/api/notifications/claim", strings.NewReader(`{"notificationId":"`+notificationID+`"}`))
	repeatRequest.Host = "example.com"
	repeatRequest.Header.Set("Origin", "http://example.com")
	repeatRequest.Header.Set("Content-Type", "application/json")
	repeatRequest.AddCookie(testSessionCookieFor(userID, "notify_claim_user", "Notify Claim User"))
	repeatResponse := performRequest(handler, repeatRequest)
	if repeatResponse.Code != http.StatusOK || !strings.Contains(repeatResponse.Body.String(), "奖励已领取") {
		t.Fatalf("expected repeat claim 200 idempotent, got %d body=%s", repeatResponse.Code, repeatResponse.Body.String())
	}

	var balance int64
	var claimStatus string
	var notificationStatus string
	var readAt *int64
	var claimedCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance, c.status, n.data->>'claimStatus', n.read_at_ms, b.claimed_count
		   FROM point_accounts p
		   JOIN reward_claims c ON c.user_id = p.user_id
		   JOIN notifications n ON n.id = c.notification_id
		   JOIN reward_batches b ON b.id = c.batch_id
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &claimStatus, &notificationStatus, &readAt, &claimedCount); err != nil {
		t.Fatalf("query claim state failed: %v", err)
	}
	if balance != 38 || claimStatus != "claimed" || notificationStatus != "claimed" || readAt == nil || claimedCount != 1 {
		t.Fatalf("unexpected claim state balance=%d status=%s notification=%s readAt=%v claimed=%d", balance, claimStatus, notificationStatus, readAt, claimedCount)
	}
}

func cleanupHTTPTestNotificationUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	if _, err := db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("cleanup notification user %d failed: %v", userID, err)
	}
}

func cleanupHTTPTestRewardClaimUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, batchID string, notificationID string) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM reward_claims WHERE user_id = $1 OR batch_id = $2 OR notification_id = $3`, userID, batchID, notificationID)
	_, _ = db.Exec(ctx, `DELETE FROM reward_batches WHERE id = $1`, batchID)
	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id = $1 OR id = $2`, userID, notificationID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}
