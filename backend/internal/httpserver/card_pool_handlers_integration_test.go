//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/cards"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCardLimitedPoolHTTPConfigAndDraws(t *testing.T) {
	ctx := context.Background()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过 PostgreSQL 集成测试")
	}
	parentDB, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer parentDB.Close()
	schema := fmt.Sprintf("http_cards_limited_%d", time.Now().UnixNano())
	quotedSchema := pgx.Identifier{schema}.Sanitize()
	if _, err := parentDB.Exec(ctx, "CREATE SCHEMA "+quotedSchema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = parentDB.Exec(ctx, "DROP SCHEMA "+quotedSchema+" CASCADE") }()
	poolConfig := parentDB.Config()
	poolConfig.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		t.Fatal(err)
	}
	deps := testDependenciesWithAdmin()
	deps.DB, deps.Logger = db, slog.New(slog.NewTextHandler(io.Discard, nil))
	admin := newAdminCardHandlers(deps)
	public := newCardHandlers(deps)
	now := time.Now().UnixMilli()
	pool := cards.LimitedPoolSettings{Enabled: true, AlbumID: "tarot", DrawCost: 3, StartsAt: now - 3600000, EndsAt: now + 3600000}
	updatePool := func(pool cards.LimitedPoolSettings) int64 {
		t.Helper()
		body, _ := json.Marshal(map[string]any{"limitedPool": pool})
		response := performAdminCardHandlerWriteRequest(admin.updateRules, http.MethodPatch, "/api/admin/cards/rules", string(body))
		var payload struct {
			Data struct {
				LimitedPool cards.LimitedPoolSettings `json:"limitedPool"`
				UpdatedAt   int64                     `json:"updatedAt"`
			} `json:"data"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &payload) != nil || payload.Data.LimitedPool != pool {
			t.Fatalf("admin configuration did not round trip: status=%d body=%s", response.Code, response.Body.String())
		}
		return payload.Data.UpdatedAt
	}
	updatePool(pool)
	rulesResponse := httptest.NewRecorder()
	public.rules(rulesResponse, httptest.NewRequest(http.MethodGet, "/api/cards/rules", nil))
	var rulesPayload struct {
		Data struct {
			LimitedPool cards.LimitedPoolSettings `json:"limitedPool"`
			ServerTime  int64                     `json:"serverTime"`
		} `json:"data"`
	}
	if rulesResponse.Code != http.StatusOK || json.Unmarshal(rulesResponse.Body.Bytes(), &rulesPayload) != nil || rulesPayload.Data.LimitedPool != pool || rulesPayload.Data.ServerTime <= 0 {
		t.Fatalf("public rules must match admin configuration: %s", rulesResponse.Body.String())
	}
	pool.AlbumID, pool.DrawCost = "hok-modern-s1", 2
	version := updatePool(pool)
	userID := int64(99941)
	insertAdminCardHTTPUser(t, ctx, db, userID, "limited_http_test", time.Now())
	store := cards.NewStore(db)
	state := cards.DefaultUserState(userID)
	state.DrawsAvailable = 11
	if err := store.SaveUserState(ctx, state); err != nil {
		t.Fatal(err)
	}
	draw := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/cards/draw", strings.NewReader(body))
		request.Host = "example.com"
		request.Header.Set("Origin", "http://example.com")
		request.AddCookie(testSessionCookieFor(userID, "limited_http_test", "Limited HTTP Test"))
		response := httptest.NewRecorder()
		public.draw(response, request)
		return response
	}
	stale := draw(fmt.Sprintf(`{"count":1,"poolId":"limited","rulesUpdatedAt":%d}`, version-1))
	if stale.Code != http.StatusBadRequest || !strings.Contains(stale.Body.String(), "配置已更新") {
		t.Fatalf("stale rule version should not charge: status=%d body=%s", stale.Code, stale.Body.String())
	}
	response := draw(fmt.Sprintf(`{"count":5,"poolId":"limited","rulesUpdatedAt":%d}`, version))
	var payload struct {
		Data struct {
			Cards []struct {
				Card cards.Card `json:"card"`
			} `json:"cards"`
			DrawsConsumed  int64 `json:"drawsConsumed"`
			DrawsAvailable int64 `json:"drawsAvailable"`
		} `json:"data"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &payload) != nil || len(payload.Data.Cards) != 5 || payload.Data.DrawsConsumed != 10 || payload.Data.DrawsAvailable != 1 {
		t.Fatalf("HTTP limited five draws should consume 10: status=%d body=%s", response.Code, response.Body.String())
	}
	for _, result := range payload.Data.Cards {
		if result.Card.AlbumID != "hok-modern-s1" {
			t.Fatalf("limited pool returned a different album: %+v", result.Card)
		}
	}
	insufficient := draw(`{"count":1,"poolId":"limited"}`)
	if insufficient.Code != http.StatusBadRequest || !strings.Contains(insufficient.Body.String(), "需要2次，当前1次") {
		t.Fatalf("HTTP should reject insufficient limited balance: %s", insufficient.Body.String())
	}
	standard := draw(`{"count":1}`)
	var single struct {
		Data struct {
			Card          cards.Card `json:"card"`
			DrawsConsumed int64      `json:"drawsConsumed"`
		} `json:"data"`
	}
	if standard.Code != http.StatusOK || json.Unmarshal(standard.Body.Bytes(), &single) != nil || single.Data.DrawsConsumed != 1 || single.Data.Card.AlbumID == "hok-modern-s1" {
		t.Fatalf("default request must use standard pool: %s", standard.Body.String())
	}
	state, err = store.GetUserState(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	state.DrawsAvailable = 2
	if err := store.SaveUserState(ctx, state); err != nil {
		t.Fatal(err)
	}
	pool.EndsAt = now - 1
	updatePool(pool)
	expired := draw(`{"count":1,"poolId":"limited"}`)
	if expired.Code != http.StatusBadRequest || !strings.Contains(expired.Body.String(), "已结束") {
		t.Fatalf("expired pool must be rejected at HTTP layer: %s", expired.Body.String())
	}
	var logCount int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM card_draw_logs WHERE user_id = $1`, userID).Scan(&logCount); err != nil || logCount != 6 {
		t.Fatalf("failed requests must not write draw logs: %d, error=%v", logCount, err)
	}
}
