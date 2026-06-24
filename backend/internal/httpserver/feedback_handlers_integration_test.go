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

func TestFeedbackHTTPReadOnlyRoutes(t *testing.T) {
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

	userID := int64(83001 + time.Now().UnixNano()%1_000_000_000)
	likerID := userID + 1
	publicID := "feedback-http-public-" + strconv.FormatInt(userID, 10)
	anonymousID := "feedback-http-anon-" + strconv.FormatInt(userID, 10)
	createdIDs := []string{}
	cleanupHTTPTestFeedback(t, ctx, db, userID, likerID, publicID, anonymousID)
	defer func() {
		ids := []string{publicID, anonymousID}
		ids = append(ids, createdIDs...)
		cleanupHTTPTestFeedback(t, ctx, db, userID, likerID, ids...)
	}()

	nowMs := time.Now().UnixMilli()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name)
		 VALUES ($1, 'feedback_user', 'Feedback User'), ($2, 'feedback_liker', 'Feedback Liker')
		 ON CONFLICT (id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name`,
		userID,
		likerID,
	); err != nil {
		t.Fatalf("seed users failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO user_profiles (user_id, display_name, avatar_url, updated_at_ms)
		 VALUES ($1, '墙用户', 'https://example.com/a.png', $2)
		 ON CONFLICT (user_id) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`,
		userID,
		nowMs,
	); err != nil {
		t.Fatalf("seed user profile failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO feedback_items (id, user_id, username, title, contact, anonymous, status, created_at_ms, updated_at_ms)
		 VALUES
		   ($1, $2, 'feedback_user', '公开反馈', 'qq@example.com', false, 'open', $4::bigint, $4::bigint + 20),
		   ($3, $2, 'feedback_user', '匿名反馈', 'secret@example.com', true, 'open', $4::bigint + 1, $4::bigint + 30)`,
		publicID,
		userID,
		anonymousID,
		nowMs,
	); err != nil {
		t.Fatalf("seed feedback items failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO feedback_messages (id, feedback_id, role, content, images, created_at_ms, created_by)
		 VALUES
		   ($1, $4, 'user', '第一条', '[{"url":"/api/feedback/images/a.png"}]'::jsonb, $6::bigint, 'feedback_user'),
		   ($2, $4, 'admin', '管理员回复', '[]'::jsonb, $6::bigint + 10, 'admin'),
		   ($3, $5, 'user', '匿名内容', '[]'::jsonb, $6::bigint + 1, 'feedback_user')`,
		"feedback-http-msg-1-"+strconv.FormatInt(userID, 10),
		"feedback-http-msg-2-"+strconv.FormatInt(userID, 10),
		"feedback-http-msg-3-"+strconv.FormatInt(userID, 10),
		publicID,
		anonymousID,
		nowMs,
	); err != nil {
		t.Fatalf("seed feedback messages failed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO feedback_likes (feedback_id, user_id)
		 VALUES ($1, $2), ($1, $3)
		 ON CONFLICT DO NOTHING`,
		publicID,
		userID,
		likerID,
	); err != nil {
		t.Fatalf("seed feedback likes failed: %v", err)
	}

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:    testSessionSecret,
			AdminUsernames:   map[string]struct{}{"admin": {}},
			FeedbackMediaDir: t.TempDir(),
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	wallRequest := httptest.NewRequest(http.MethodGet, "/api/feedback?scope=wall&page=1&limit=10", nil)
	wallRequest.AddCookie(testSessionCookieFor(userID, "feedback_user", "Feedback User"))
	wallResponse := performRequest(handler, wallRequest)
	if wallResponse.Code != http.StatusOK {
		t.Fatalf("expected wall 200, got %d body=%s", wallResponse.Code, wallResponse.Body.String())
	}
	var wallPayload struct {
		Success bool `json:"success"`
		Items   []struct {
			ID               string `json:"id"`
			Title            string `json:"title"`
			Contact          string `json:"contact"`
			DisplayName      string `json:"displayName"`
			LikeCount        int64  `json:"likeCount"`
			LikedByMe        bool   `json:"likedByMe"`
			ReplyCount       int64  `json:"replyCount"`
			FirstMessage     any    `json:"firstMessage"`
			LatestAdminReply any    `json:"latestAdminReply"`
		} `json:"items"`
		Pagination struct {
			Total int64 `json:"total"`
		} `json:"pagination"`
	}
	if err := json.NewDecoder(wallResponse.Body).Decode(&wallPayload); err != nil {
		t.Fatalf("decode wall response failed: %v", err)
	}
	if !wallPayload.Success || wallPayload.Pagination.Total != 1 || len(wallPayload.Items) != 1 {
		t.Fatalf("unexpected wall payload: %+v", wallPayload)
	}
	if wallPayload.Items[0].ID != publicID || wallPayload.Items[0].Contact != "" || wallPayload.Items[0].DisplayName != "墙用户" || wallPayload.Items[0].LikeCount != 2 || !wallPayload.Items[0].LikedByMe || wallPayload.Items[0].ReplyCount != 1 {
		t.Fatalf("unexpected wall item: %+v", wallPayload.Items[0])
	}
	if wallPayload.Items[0].FirstMessage == nil || wallPayload.Items[0].LatestAdminReply == nil {
		t.Fatalf("wall item should include first message and latest admin reply: %+v", wallPayload.Items[0])
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/feedback/"+publicID, nil)
	detailRequest.AddCookie(testSessionCookieFor(userID, "feedback_user", "Feedback User"))
	detailResponse := performRequest(handler, detailRequest)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("expected detail 200, got %d body=%s", detailResponse.Code, detailResponse.Body.String())
	}
	var detailPayload struct {
		Success  bool `json:"success"`
		Feedback struct {
			ID      string `json:"id"`
			Contact string `json:"contact"`
		} `json:"feedback"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(detailResponse.Body).Decode(&detailPayload); err != nil {
		t.Fatalf("decode detail response failed: %v", err)
	}
	if !detailPayload.Success || detailPayload.Feedback.ID != publicID || detailPayload.Feedback.Contact != "qq@example.com" {
		t.Fatalf("unexpected detail feedback: %+v", detailPayload)
	}
	if len(detailPayload.Messages) != 2 || detailPayload.Messages[0].Content != "第一条" || detailPayload.Messages[1].Role != "admin" {
		t.Fatalf("unexpected detail messages: %+v", detailPayload.Messages)
	}

	otherDetailRequest := httptest.NewRequest(http.MethodGet, "/api/feedback/"+anonymousID, nil)
	otherDetailRequest.AddCookie(testSessionCookieFor(likerID, "feedback_liker", "Feedback Liker"))
	otherDetailResponse := performRequest(handler, otherDetailRequest)
	if otherDetailResponse.Code != http.StatusForbidden {
		t.Fatalf("expected anonymous feedback detail 403 for non-owner, got %d body=%s", otherDetailResponse.Code, otherDetailResponse.Body.String())
	}

	adminListRequest := httptest.NewRequest(http.MethodGet, "/api/admin/feedback?page=1&limit=10", nil)
	adminListRequest.AddCookie(testSessionCookieFor(999, "admin", "Admin"))
	adminListResponse := performRequest(handler, adminListRequest)
	if adminListResponse.Code != http.StatusOK {
		t.Fatalf("expected admin list 200, got %d body=%s", adminListResponse.Code, adminListResponse.Body.String())
	}
	var adminListPayload struct {
		Success bool `json:"success"`
		Items   []struct {
			ID      string `json:"id"`
			Contact string `json:"contact"`
		} `json:"items"`
		Pagination struct {
			Total int64 `json:"total"`
		} `json:"pagination"`
	}
	if err := json.NewDecoder(adminListResponse.Body).Decode(&adminListPayload); err != nil {
		t.Fatalf("decode admin list failed: %v", err)
	}
	if !adminListPayload.Success || adminListPayload.Pagination.Total != 2 || len(adminListPayload.Items) != 2 {
		t.Fatalf("unexpected admin list payload: %+v", adminListPayload)
	}

	likeRequest := httptest.NewRequest(http.MethodPost, "/api/feedback/"+publicID+"/like", nil)
	likeRequest.AddCookie(testSessionCookieFor(likerID, "feedback_liker", "Feedback Liker"))
	likeResponse := performRequest(handler, likeRequest)
	if likeResponse.Code != http.StatusOK {
		t.Fatalf("expected like 200, got %d body=%s", likeResponse.Code, likeResponse.Body.String())
	}
	var likePayload struct {
		Success   bool  `json:"success"`
		LikeCount int64 `json:"likeCount"`
		LikedByMe bool  `json:"likedByMe"`
	}
	if err := json.NewDecoder(likeResponse.Body).Decode(&likePayload); err != nil {
		t.Fatalf("decode like response failed: %v", err)
	}
	if !likePayload.Success || likePayload.LikeCount != 1 || likePayload.LikedByMe {
		t.Fatalf("unexpected like payload: %+v", likePayload)
	}

	userMessageRequest := httptest.NewRequest(http.MethodPost, "/api/feedback/"+publicID+"/messages", strings.NewReader(`{"content":"我也遇到了"}`))
	userMessageRequest.AddCookie(testSessionCookieFor(likerID, "feedback_liker", "Feedback Liker"))
	userMessageResponse := performRequest(handler, userMessageRequest)
	if userMessageResponse.Code != http.StatusCreated {
		t.Fatalf("expected user message 201, got %d body=%s", userMessageResponse.Code, userMessageResponse.Body.String())
	}
	var userMessagePayload struct {
		Success         bool `json:"success"`
		FeedbackMessage struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"feedbackMessage"`
	}
	if err := json.NewDecoder(userMessageResponse.Body).Decode(&userMessagePayload); err != nil {
		t.Fatalf("decode user message failed: %v", err)
	}
	if !userMessagePayload.Success || userMessagePayload.FeedbackMessage.Role != "user" || userMessagePayload.FeedbackMessage.Content != "我也遇到了" {
		t.Fatalf("unexpected user message payload: %+v", userMessagePayload)
	}

	blockedAnonymousMessage := httptest.NewRequest(http.MethodPost, "/api/feedback/"+anonymousID+"/messages", strings.NewReader(`{"content":"看不到"}`))
	blockedAnonymousMessage.AddCookie(testSessionCookieFor(likerID, "feedback_liker", "Feedback Liker"))
	blockedAnonymousResponse := performRequest(handler, blockedAnonymousMessage)
	if blockedAnonymousResponse.Code != http.StatusForbidden {
		t.Fatalf("expected anonymous message 403 for non-owner, got %d body=%s", blockedAnonymousResponse.Code, blockedAnonymousResponse.Body.String())
	}

	adminMessageRequest := httptest.NewRequest(http.MethodPost, "/api/admin/feedback/"+publicID+"/messages", strings.NewReader(`{"content":"后台已收到"}`))
	adminMessageRequest.AddCookie(testSessionCookieFor(999, "admin", "Admin"))
	adminMessageResponse := performRequest(handler, adminMessageRequest)
	if adminMessageResponse.Code != http.StatusCreated {
		t.Fatalf("expected admin message 201, got %d body=%s", adminMessageResponse.Code, adminMessageResponse.Body.String())
	}
	var adminMessagePayload struct {
		Success  bool `json:"success"`
		Feedback struct {
			Status string `json:"status"`
		} `json:"feedback"`
		FeedbackMessage struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"feedbackMessage"`
	}
	if err := json.NewDecoder(adminMessageResponse.Body).Decode(&adminMessagePayload); err != nil {
		t.Fatalf("decode admin message failed: %v", err)
	}
	if !adminMessagePayload.Success || adminMessagePayload.Feedback.Status != "processing" || adminMessagePayload.FeedbackMessage.Role != "admin" {
		t.Fatalf("unexpected admin message payload: %+v", adminMessagePayload)
	}

	patchRequest := httptest.NewRequest(http.MethodPatch, "/api/admin/feedback/"+publicID, strings.NewReader(`{"status":"resolved"}`))
	patchRequest.AddCookie(testSessionCookieFor(999, "admin", "Admin"))
	patchResponse := performRequest(handler, patchRequest)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("expected patch 200, got %d body=%s", patchResponse.Code, patchResponse.Body.String())
	}
	var patchPayload struct {
		Success  bool `json:"success"`
		Feedback struct {
			Status string `json:"status"`
		} `json:"feedback"`
	}
	if err := json.NewDecoder(patchResponse.Body).Decode(&patchPayload); err != nil {
		t.Fatalf("decode patch failed: %v", err)
	}
	if !patchPayload.Success || patchPayload.Feedback.Status != "resolved" {
		t.Fatalf("unexpected patch payload: %+v", patchPayload)
	}

	var replyNotifications int64
	var statusNotifications int64
	if err := db.QueryRow(ctx,
		`SELECT
		    COUNT(*) FILTER (WHERE type = 'feedback_reply'),
		    COUNT(*) FILTER (WHERE type = 'feedback_status')
		   FROM notifications
		  WHERE user_id = $1
		    AND data->>'feedbackId' = $2`,
		userID,
		publicID,
	).Scan(&replyNotifications, &statusNotifications); err != nil {
		t.Fatalf("count feedback notifications failed: %v", err)
	}
	if replyNotifications != 2 || statusNotifications != 2 {
		t.Fatalf("unexpected feedback notifications reply=%d status=%d", replyNotifications, statusNotifications)
	}

	createRequest := httptest.NewRequest(http.MethodPost, "/api/feedback", strings.NewReader(`{"title":"新反馈","content":"文本反馈","contact":"contact@example.com","anonymous":false}`))
	createRequest.AddCookie(testSessionCookieFor(userID, "feedback_user", "Feedback User"))
	createResponse := performRequest(handler, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("expected create 201, got %d body=%s", createResponse.Code, createResponse.Body.String())
	}
	var createPayload struct {
		Success  bool `json:"success"`
		Feedback struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Contact string `json:"contact"`
			Status  string `json:"status"`
		} `json:"feedback"`
		FirstMessage struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"firstMessage"`
	}
	if err := json.NewDecoder(createResponse.Body).Decode(&createPayload); err != nil {
		t.Fatalf("decode create failed: %v", err)
	}
	createdIDs = append(createdIDs, createPayload.Feedback.ID)
	if !createPayload.Success || createPayload.Feedback.ID == "" || createPayload.Feedback.Title != "新反馈" ||
		createPayload.Feedback.Contact != "contact@example.com" || createPayload.Feedback.Status != "open" ||
		createPayload.FirstMessage.Role != "user" || createPayload.FirstMessage.Content != "文本反馈" {
		t.Fatalf("unexpected create payload: %+v", createPayload)
	}

	createWithImageRequest := httptest.NewRequest(http.MethodPost, "/api/feedback", strings.NewReader(`{"content":"","images":[{"dataUrl":"data:image/png;base64,AAAA","mimeType":"image/png","size":3}]}`))
	createWithImageRequest.AddCookie(testSessionCookieFor(userID, "feedback_user", "Feedback User"))
	createWithImageResponse := performRequest(handler, createWithImageRequest)
	if createWithImageResponse.Code != http.StatusCreated {
		t.Fatalf("expected image create 201, got %d body=%s", createWithImageResponse.Code, createWithImageResponse.Body.String())
	}
	var createWithImagePayload struct {
		Success      bool                `json:"success"`
		Feedback     struct{ ID string } `json:"feedback"`
		FirstMessage struct {
			Images []struct {
				DataURL  string `json:"dataUrl"`
				MimeType string `json:"mimeType"`
				Size     int64  `json:"size"`
				Kind     string `json:"kind"`
			} `json:"images"`
		} `json:"firstMessage"`
	}
	if err := json.NewDecoder(createWithImageResponse.Body).Decode(&createWithImagePayload); err != nil {
		t.Fatalf("decode image create failed: %v", err)
	}
	if createWithImagePayload.Feedback.ID != "" {
		createdIDs = append(createdIDs, createWithImagePayload.Feedback.ID)
	}
	if !createWithImagePayload.Success || len(createWithImagePayload.FirstMessage.Images) != 1 {
		t.Fatalf("unexpected image create payload: %+v", createWithImagePayload)
	}
	image := createWithImagePayload.FirstMessage.Images[0]
	if !strings.HasPrefix(image.DataURL, "/api/feedback/images/feedback/") || image.MimeType != "image/png" || image.Size != 3 || image.Kind != "image" {
		t.Fatalf("unexpected stored image: %+v", image)
	}
	imageRequest := httptest.NewRequest(http.MethodGet, image.DataURL, nil)
	imageResponse := performRequest(handler, imageRequest)
	if imageResponse.Code != http.StatusOK || imageResponse.Body.Len() != 3 || imageResponse.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("expected image GET 200 png body, got status=%d type=%s len=%d", imageResponse.Code, imageResponse.Header().Get("Content-Type"), imageResponse.Body.Len())
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/admin/feedback/"+publicID, nil)
	deleteRequest.AddCookie(testSessionCookieFor(999, "admin", "Admin"))
	deleteResponse := performRequest(handler, deleteRequest)
	if deleteResponse.Code != http.StatusOK {
		t.Fatalf("expected delete 200, got %d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}
	var deletePayload struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(deleteResponse.Body).Decode(&deletePayload); err != nil {
		t.Fatalf("decode delete failed: %v", err)
	}
	if !deletePayload.Success || deletePayload.Message != "反馈已删除" {
		t.Fatalf("unexpected delete payload: %+v", deletePayload)
	}
	var deletedItems int64
	var deletedMessages int64
	var deletedLikes int64
	if err := db.QueryRow(ctx,
		`SELECT
		    (SELECT count(*) FROM feedback_items WHERE id = $1),
		    (SELECT count(*) FROM feedback_messages WHERE feedback_id = $1),
		    (SELECT count(*) FROM feedback_likes WHERE feedback_id = $1)`,
		publicID,
	).Scan(&deletedItems, &deletedMessages, &deletedLikes); err != nil {
		t.Fatalf("count deleted feedback rows failed: %v", err)
	}
	if deletedItems != 0 || deletedMessages != 0 || deletedLikes != 0 {
		t.Fatalf("expected delete cascade to remove feedback rows, items=%d messages=%d likes=%d", deletedItems, deletedMessages, deletedLikes)
	}
	repeatDeleteRequest := httptest.NewRequest(http.MethodDelete, "/api/admin/feedback/"+publicID, nil)
	repeatDeleteRequest.AddCookie(testSessionCookieFor(999, "admin", "Admin"))
	repeatDeleteResponse := performRequest(handler, repeatDeleteRequest)
	if repeatDeleteResponse.Code != http.StatusNotFound {
		t.Fatalf("expected repeat delete 404, got %d body=%s", repeatDeleteResponse.Code, repeatDeleteResponse.Body.String())
	}
}

func cleanupHTTPTestFeedback(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, likerID int64, ids ...string) {
	t.Helper()
	for _, id := range ids {
		_, _ = db.Exec(ctx, `DELETE FROM feedback_items WHERE id = $1`, id)
	}
	_, _ = db.Exec(ctx, `DELETE FROM notifications WHERE user_id IN ($1, $2)`, userID, likerID)
	_, _ = db.Exec(ctx, `DELETE FROM user_profiles WHERE user_id IN ($1, $2)`, userID, likerID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id IN ($1, $2)`, userID, likerID)
}
