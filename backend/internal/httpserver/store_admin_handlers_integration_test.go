//go:build integration

package httpserver

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"

	"redemption/backend/internal/config"
	"redemption/backend/internal/economy"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
)

func TestStoreAdminFarmItemPatchRouteSavesOverride(t *testing.T) {
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

	handler := New(Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})

	initialResponse := performAdminJSONRequest(handler, http.MethodGet, "/api/store/admin", "")
	if initialResponse.Code != http.StatusOK {
		t.Fatalf("expected initial get 200, got %d body=%s", initialResponse.Code, initialResponse.Body.String())
	}
	var initialPayload struct {
		Success bool `json:"success"`
		Data    struct {
			FarmItems []economy.EffectiveFarmItem `json:"farmItems"`
		} `json:"data"`
	}
	if err := json.Unmarshal(initialResponse.Body.Bytes(), &initialPayload); err != nil {
		t.Fatalf("decode initial response failed: %v", err)
	}
	if !initialPayload.Success || !containsHTTPFarmItem(initialPayload.Data.FarmItems, "speed_normal") {
		t.Fatalf("initial farm items should include speed_normal: %+v", initialPayload)
	}

	patchBody := `{"kind":"farm-item","key":"speed_normal","cost":44,"dailyLimit":3,"speedReduceMinutes":9,"petEffect":{"mood":6}}`
	patchResponse := performAdminJSONRequest(handler, http.MethodPatch, "/api/store/admin", patchBody)
	if patchResponse.Code != http.StatusOK {
		t.Fatalf("expected patch 200, got %d body=%s", patchResponse.Code, patchResponse.Body.String())
	}
	var patchPayload struct {
		Success bool `json:"success"`
		Data    struct {
			Override economy.FarmShopItemOverride `json:"override"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(patchResponse.Body.Bytes(), &patchPayload); err != nil {
		t.Fatalf("decode patch response failed: %v", err)
	}
	if !patchPayload.Success || patchPayload.Message != "农场商品配置已保存" || patchPayload.Data.Override.Cost == nil || *patchPayload.Data.Override.Cost != 44 || patchPayload.Data.Override.PetEffect["mood"] != 6 {
		t.Fatalf("unexpected patch payload: %+v", patchPayload)
	}

	nextResponse := performAdminJSONRequest(handler, http.MethodGet, "/api/store/admin", "")
	if nextResponse.Code != http.StatusOK {
		t.Fatalf("expected next get 200, got %d body=%s", nextResponse.Code, nextResponse.Body.String())
	}
	var nextPayload struct {
		Data struct {
			FarmItems []economy.EffectiveFarmItem `json:"farmItems"`
		} `json:"data"`
	}
	if err := json.Unmarshal(nextResponse.Body.Bytes(), &nextPayload); err != nil {
		t.Fatalf("decode next response failed: %v", err)
	}
	item, ok := findHTTPFarmItem(nextPayload.Data.FarmItems, "speed_normal")
	if !ok {
		t.Fatalf("speed_normal should be returned")
	}
	if item.Cost != 44 || item.DailyLimit == nil || *item.DailyLimit != 3 || item.SpeedReduceMinutes == nil || *item.SpeedReduceMinutes != 9 || item.PetEffect["mood"] != 6 || item.Override == nil {
		t.Fatalf("unexpected effective farm item: %+v", item)
	}

	missingResponse := performAdminJSONRequest(handler, http.MethodPatch, "/api/store/admin", `{"kind":"farm-item","key":"missing_item","cost":1}`)
	if missingResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected missing item 400, got %d body=%s", missingResponse.Code, missingResponse.Body.String())
	}
}

func containsHTTPFarmItem(items []economy.EffectiveFarmItem, key string) bool {
	_, ok := findHTTPFarmItem(items, key)
	return ok
}

func findHTTPFarmItem(items []economy.EffectiveFarmItem, key string) (economy.EffectiveFarmItem, bool) {
	for _, item := range items {
		if item.Key == key {
			return item, true
		}
	}
	return economy.EffectiveFarmItem{}, false
}
