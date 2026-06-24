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

	"redemption/backend/internal/config"
	"redemption/backend/internal/farm"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFarmStatusRouteCreatesInitialState(t *testing.T) {
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

	userID := int64(21001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_status_http")

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodGet, "/api/farm/status", nil)
	request.AddCookie(testSessionCookieFor(userID, "farm_status_http", "Farm Status HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.State.UserID != userID || payload.Data.State.Points != 100 {
		t.Fatalf("unexpected farm status payload: %+v", payload)
	}
	if len(payload.Data.ComputedLands) != 8 || len(payload.Data.PlantableCrops) == 0 || payload.Data.World.Date == "" {
		t.Fatalf("unexpected farm status computed fields: %+v", payload.Data)
	}

	var stateCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM farm_states WHERE user_id = $1`, userID).Scan(&stateCount); err != nil {
		t.Fatalf("query farm state count failed: %v", err)
	}
	if stateCount != 1 {
		t.Fatalf("expected one farm state, got %d", stateCount)
	}

	var balance int64
	if err := db.QueryRow(ctx, `SELECT balance FROM point_accounts WHERE user_id = $1`, userID).Scan(&balance); err != nil {
		t.Fatalf("query point balance failed: %v", err)
	}
	if balance != 100 {
		t.Fatalf("expected initial balance 100, got %d", balance)
	}

	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND id = $2 AND amount = 100 AND description = '开心农场初始积分'`,
		userID,
		fmt.Sprintf("farm_initial_%d", userID),
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query initial ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one initial ledger, got %d", ledgerCount)
	}
}

func TestFarmStealDoRoutePersistsAttempt(t *testing.T) {
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

	suffix := time.Now().UnixNano() % 1_000_000_000
	thiefID := int64(22001 + suffix)
	targetID := int64(23001 + suffix)
	cleanupFarmHTTPUsers(t, ctx, db, thiefID, targetID)
	defer cleanupFarmHTTPUsers(t, ctx, db, thiefID, targetID)
	insertFarmHTTPUser(t, ctx, db, thiefID, "farm_steal_http_thief")
	insertFarmHTTPUser(t, ctx, db, targetID, "farm_steal_http_target")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		thiefID,
	); err != nil {
		t.Fatalf("insert thief point account failed: %v", err)
	}

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	saveFarmHTTPState(t, ctx, store, farmHTTPInitialState(thiefID, nowMs, true), nowMs)
	saveFarmHTTPState(t, ctx, store, farmHTTPStealableTargetState(targetID, nowMs), nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/steal/do", strings.NewReader(fmt.Sprintf(`{"targetUserId":%d}`, targetID)))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(thiefID, "farm_steal_http_thief", "Farm Steal HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Steal   struct {
			Success bool        `json:"success"`
			Amount  int64       `json:"amount"`
			CropID  farm.CropID `json:"cropId"`
			Balance int64       `json:"balance"`
		} `json:"steal"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.State.UserID != thiefID || len(payload.Data.ComputedLands) != 8 {
		t.Fatalf("unexpected steal response payload: %+v", payload)
	}

	persistedThief := readFarmHTTPState(t, ctx, store, thiefID)
	if persistedThief.MyStealMap[fmt.Sprintf("%d", targetID)] != 1 {
		t.Fatalf("expected steal attempt to consume daily count, got %+v", persistedThief.MyStealMap)
	}
	persistedTarget := readFarmHTTPState(t, ctx, store, targetID)
	if payload.Steal.Success {
		if payload.Steal.Amount <= 0 || payload.Steal.CropID != farm.CropCarrot || payload.Steal.Balance <= 100 {
			t.Fatalf("unexpected successful steal response: %+v", payload.Steal)
		}
		if persistedTarget.Lands[0].Status != farm.LandStatusEmpty || persistedTarget.Lands[0].Crop != nil || persistedTarget.StolenTodayCount != 1 {
			t.Fatalf("expected successful steal to clear target crop, got %+v", persistedTarget.Lands[0])
		}
		assertFarmHTTPPointLedgerExists(t, ctx, db, thiefID, "偷菜成功:")
		return
	}

	if persistedTarget.Lands[0].Status != farm.LandStatusMature || persistedTarget.Lands[0].Crop == nil || persistedTarget.StolenTodayCount != 0 {
		t.Fatalf("expected failed steal to keep target crop, got land=%+v count=%d", persistedTarget.Lands[0], persistedTarget.StolenTodayCount)
	}
	assertFarmHTTPNoStealLedger(t, ctx, db, thiefID)
}

func TestFarmPlantRoutePersistsCrop(t *testing.T) {
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

	userID := int64(24001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_plant_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	saveFarmHTTPState(t, ctx, store, farmHTTPInitialState(userID, nowMs, false), nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/plant", strings.NewReader(`{"plotIndex":0,"cropId":"wheat"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_plant_http", "Farm Plant HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Balance != 100 || payload.Data.State.UserID != userID {
		t.Fatalf("unexpected plant response: %+v", payload)
	}
	if payload.Data.State.Lands[0].Status != farm.LandStatusGrowing || payload.Data.State.Lands[0].Crop == nil || payload.Data.State.Lands[0].Crop.CropID != farm.CropWheat {
		t.Fatalf("expected planted crop in response, got %+v", payload.Data.State.Lands[0])
	}
	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Lands[0].Status != farm.LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Lands[0].Crop.CropID != farm.CropWheat {
		t.Fatalf("expected persisted planted crop, got %+v", persisted.Lands[0])
	}
}

func TestFarmWaterRoutePersistsCropAndBonus(t *testing.T) {
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

	userID := int64(25001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_water_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Lands[0].Status = farm.LandStatusThirsty
	state.Lands[0].Crop = &farm.CropInstance{
		CropID:         farm.CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs - 1,
		WaterMissCount: 1,
		PlantedSeason:  farm.SeasonSpring,
		WeatherAtPlant: farm.WeatherSunny,
	}
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/water", strings.NewReader(`{"plotIndex":0}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_water_http", "Farm Water HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Bonus   int64               `json:"bonus"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Bonus != 5 || payload.Data.State.Points != 105 {
		t.Fatalf("unexpected water response: %+v", payload)
	}
	if payload.Data.State.Lands[0].Status != farm.LandStatusGrowing || payload.Data.State.Lands[0].Crop == nil {
		t.Fatalf("expected watered crop in response, got %+v", payload.Data.State.Lands[0])
	}
	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Lands[0].Status != farm.LandStatusGrowing || persisted.Lands[0].Crop == nil || persisted.Points != 105 {
		t.Fatalf("expected persisted watered crop and points, got land=%+v points=%d", persisted.Lands[0], persisted.Points)
	}
}

func TestFarmWaterAllRoutePersistsEligibleCrops(t *testing.T) {
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

	userID := int64(26001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_water_all_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	for index := 0; index < 3; index++ {
		state.Lands[index].Status = farm.LandStatusGrowing
		state.Lands[index].Crop = &farm.CropInstance{
			CropID:         farm.CropWheat,
			PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
			MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs - 1,
			PlantedSeason:  farm.SeasonSpring,
			WeatherAtPlant: farm.WeatherSunny,
		}
	}
	state.Lands[1].Status = farm.LandStatusThirsty
	state.Lands[2].Status = farm.LandStatusMature
	state.Lands[2].Crop.MatureAt = nowMs - 1
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/water-all", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "farm_water_all_http", "Farm Water All HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Count   int64               `json:"count"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Count != 2 {
		t.Fatalf("unexpected water-all response: %+v", payload)
	}
	for _, index := range []int{0, 1} {
		if payload.Data.State.Lands[index].Status != farm.LandStatusGrowing || payload.Data.State.Lands[index].Crop == nil {
			t.Fatalf("expected watered crop in response at %d, got %+v", index, payload.Data.State.Lands[index])
		}
	}
	persisted := readFarmHTTPState(t, ctx, store, userID)
	for _, index := range []int{0, 1} {
		if persisted.Lands[index].Status != farm.LandStatusGrowing || persisted.Lands[index].Crop == nil {
			t.Fatalf("expected persisted watered crop at %d, got %+v", index, persisted.Lands[index])
		}
	}
	if persisted.Lands[2].Status != farm.LandStatusMature {
		t.Fatalf("expected mature land unchanged, got %+v", persisted.Lands[2])
	}
}

func TestFarmHarvestRoutePersistsStateAndPoints(t *testing.T) {
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

	userID := int64(27001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_harvest_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Lands[0].Status = farm.LandStatusMature
	state.Lands[0].Crop = &farm.CropInstance{
		CropID:         farm.CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs - 1,
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		WaterMissCount: 0,
		PlantedSeason:  farm.SeasonSpring,
		WeatherAtPlant: farm.WeatherSunny,
	}
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/harvest", strings.NewReader(`{"plotIndex":0}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_harvest_http", "Farm Harvest HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Harvest struct {
			CropID     farm.CropID `json:"cropId"`
			CropName   string      `json:"cropName"`
			FinalYield int64       `json:"finalYield"`
		} `json:"harvest"`
		Balance int64 `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Harvest.CropID != farm.CropWheat || payload.Harvest.CropName != "小麦" || payload.Harvest.FinalYield <= 0 {
		t.Fatalf("unexpected harvest response: %+v", payload)
	}
	if payload.Balance != payload.Data.State.Points || payload.Balance != 100+payload.Harvest.FinalYield+10 {
		t.Fatalf("unexpected harvest balance response: balance=%d points=%d harvest=%+v", payload.Balance, payload.Data.State.Points, payload.Harvest)
	}
	if payload.Data.State.Lands[0].Status != farm.LandStatusEmpty || payload.Data.State.Lands[0].Crop != nil {
		t.Fatalf("expected harvested land in response to be empty, got %+v", payload.Data.State.Lands[0])
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Lands[0].Status != farm.LandStatusEmpty || persisted.Lands[0].Crop != nil || persisted.Points != payload.Balance {
		t.Fatalf("expected persisted harvest state, got land=%+v points=%d", persisted.Lands[0], persisted.Points)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND (description LIKE '农场收获: 小麦（%' OR description = '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query harvest ledgers failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected harvest and first harvest ledgers, got %d", ledgerCount)
	}
}

func TestFarmHarvestAllRoutePersistsStateAndPoints(t *testing.T) {
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

	userID := int64(28001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_harvest_all_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	for index := 0; index < 2; index++ {
		state.Lands[index].Status = farm.LandStatusMature
		state.Lands[index].Crop = &farm.CropInstance{
			CropID:         farm.CropWheat,
			PlantedAt:      nowMs - int64(time.Duration(index+1)*time.Hour/time.Millisecond),
			MatureAt:       nowMs - 1,
			LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
			NextWaterDueAt: nowMs,
			WaterMissCount: 0,
			PlantedSeason:  farm.SeasonSpring,
			WeatherAtPlant: farm.WeatherSunny,
		}
	}
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/harvest-all", nil)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.AddCookie(testSessionCookieFor(userID, "farm_harvest_all_http", "Farm Harvest All HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success  bool                `json:"success"`
		Data     farm.StatusResponse `json:"data"`
		Harvests []struct {
			CropID     farm.CropID `json:"cropId"`
			FinalYield int64       `json:"finalYield"`
		} `json:"harvests"`
		Total   int64 `json:"total"`
		Balance int64 `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || len(payload.Harvests) != 2 || payload.Total <= 0 {
		t.Fatalf("unexpected harvest-all response: %+v", payload)
	}
	for _, item := range payload.Harvests {
		if item.CropID != farm.CropWheat || item.FinalYield <= 0 {
			t.Fatalf("unexpected harvest-all item: %+v", item)
		}
	}
	if payload.Balance != payload.Data.State.Points || payload.Balance != 100+payload.Total+10 {
		t.Fatalf("unexpected harvest-all balance: balance=%d points=%d total=%d", payload.Balance, payload.Data.State.Points, payload.Total)
	}
	for _, index := range []int{0, 1} {
		if payload.Data.State.Lands[index].Status != farm.LandStatusEmpty || payload.Data.State.Lands[index].Crop != nil {
			t.Fatalf("expected response land %d empty, got %+v", index, payload.Data.State.Lands[index])
		}
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	for _, index := range []int{0, 1} {
		if persisted.Lands[index].Status != farm.LandStatusEmpty || persisted.Lands[index].Crop != nil {
			t.Fatalf("expected persisted land %d empty, got %+v", index, persisted.Lands[index])
		}
	}
	if persisted.Points != payload.Balance {
		t.Fatalf("expected persisted points %d, got %d", payload.Balance, persisted.Points)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND (description = '农场一键收获: 2 块' OR description = '农场首次收获奖励')`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query harvest-all ledgers failed: %v", err)
	}
	if ledgerCount != 2 {
		t.Fatalf("expected harvest-all and first harvest ledgers, got %d", ledgerCount)
	}
}

func TestFarmRemoveRoutePersistsClearedLand(t *testing.T) {
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

	userID := int64(29001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_remove_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Lands[0].Status = farm.LandStatusWithered
	state.Lands[0].Crop = &farm.CropInstance{
		CropID:         farm.CropWheat,
		PlantedAt:      nowMs - int64(time.Hour/time.Millisecond),
		MatureAt:       nowMs + int64(time.Hour/time.Millisecond),
		LastWaterAt:    nowMs - int64(time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs,
		PlantedSeason:  farm.SeasonSpring,
		WeatherAtPlant: farm.WeatherSunny,
	}
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/remove", strings.NewReader(`{"plotIndex":0}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_remove_http", "Farm Remove HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.State.UserID != userID {
		t.Fatalf("unexpected remove response: %+v", payload)
	}
	if payload.Data.State.Lands[0].Status != farm.LandStatusEmpty || payload.Data.State.Lands[0].Crop != nil {
		t.Fatalf("expected response land cleared, got %+v", payload.Data.State.Lands[0])
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Lands[0].Status != farm.LandStatusEmpty || persisted.Lands[0].Crop != nil {
		t.Fatalf("expected persisted land cleared, got %+v", persisted.Lands[0])
	}
}

func TestFarmBuySeedsRoutePersistsInventoryAndPoints(t *testing.T) {
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

	userID := int64(30001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_buy_seeds_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.SeedInventory = json.RawMessage(`{"wheat":4}`)
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/seeds/buy", strings.NewReader(`{"cropId":"wheat","qty":3}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_buy_seeds_http", "Farm Buy Seeds HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Balance != 85 || payload.Data.State.Points != 85 {
		t.Fatalf("unexpected buy seeds response: %+v", payload)
	}
	if seedCount := decodeFarmHTTPIntMap(t, payload.Data.State.SeedInventory)["wheat"]; seedCount != 7 {
		t.Fatalf("expected response wheat seeds 7, got %d", seedCount)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Points != 85 || decodeFarmHTTPIntMap(t, persisted.SeedInventory)["wheat"] != 7 {
		t.Fatalf("expected persisted seed purchase, points=%d seeds=%s", persisted.Points, string(persisted.SeedInventory))
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -15 AND source = 'exchange' AND description = '农场购买种子: 小麦 x3' AND balance_after = 85`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query buy seeds ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one buy seeds ledger, got %d", ledgerCount)
	}
}

func TestFarmBuyLandRoutePersistsLandAndPoints(t *testing.T) {
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

	userID := int64(31001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_buy_land_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/buy-land", strings.NewReader(`{"landIndex":5}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_buy_land_http", "Farm Buy Land HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Balance != 50 || payload.Data.State.Points != 50 {
		t.Fatalf("unexpected buy land response: %+v", payload)
	}
	if payload.Data.State.Lands[4].Status != farm.LandStatusEmpty {
		t.Fatalf("expected response fifth land unlocked, got %+v", payload.Data.State.Lands[4])
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Points != 50 || persisted.Lands[4].Status != farm.LandStatusEmpty {
		t.Fatalf("expected persisted land purchase, points=%d land=%+v", persisted.Points, persisted.Lands[4])
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -50 AND source = 'exchange' AND description = '农场购买第 5 块土地' AND balance_after = 50`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query buy land ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one buy land ledger, got %d", ledgerCount)
	}
}

func TestFarmBuyShopItemRoutePersistsInventoryPointsAndDailyCount(t *testing.T) {
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

	userID := int64(32001 + time.Now().UnixNano()%1_000_000_000)
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_buy_shop_http")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	saveFarmHTTPState(t, ctx, store, state, nowMs)
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/shop/buy", strings.NewReader(`{"key":"pet_food_normal","qty":2}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_buy_shop_http", "Farm Buy Shop HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Balance != 70 || payload.Data.State.Points != 70 {
		t.Fatalf("unexpected buy shop response: %+v", payload)
	}
	if payload.Data.ShopDailyPurchases["pet_food_normal"] != 2 {
		t.Fatalf("expected response daily purchase count 2, got %+v", payload.Data.ShopDailyPurchases)
	}
	if count := decodeFarmHTTPInventory(t, payload.Data.State.Inventory)["pet_food_normal"].Count; count != 2 {
		t.Fatalf("expected response pet_food_normal count 2, got %d", count)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.Points != 70 || decodeFarmHTTPInventory(t, persisted.Inventory)["pet_food_normal"].Count != 2 {
		t.Fatalf("expected persisted shop purchase, points=%d inventory=%s", persisted.Points, string(persisted.Inventory))
	}
	var purchaseCount int64
	if err := db.QueryRow(ctx,
		`SELECT purchase_count
		   FROM farm_daily_shop_purchases
		  WHERE user_id = $1 AND item_key = 'pet_food_normal'`,
		userID,
	).Scan(&purchaseCount); err != nil {
		t.Fatalf("query daily purchase count failed: %v", err)
	}
	if purchaseCount != 2 {
		t.Fatalf("expected daily purchase count 2, got %d", purchaseCount)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = -30 AND source = 'exchange' AND description = '农场购买: 普通宠粮 x2' AND balance_after = 70`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query shop buy ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one shop buy ledger, got %d", ledgerCount)
	}
}

func TestFarmUseShopItemRoutePersistsState(t *testing.T) {
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

	userID := int64(25001 + time.Now().UnixNano()%1_000_000_000)
	nowMs := time.Now().UnixMilli()
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_use_shop_http")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	farmHTTPAddInventory(t, &state, "scarecrow", 1, nowMs)
	saveFarmHTTPState(t, ctx, store, state, nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/shop/use", strings.NewReader(`{"key":"scarecrow"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_use_shop_http", "Farm Use Shop HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.State.ScarecrowUntil == nil {
		t.Fatalf("unexpected use shop response: %+v", payload)
	}
	if count := decodeFarmHTTPInventory(t, payload.Data.State.Inventory)["scarecrow"].Count; count != 0 {
		t.Fatalf("expected response scarecrow consumed, got %d", count)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	if persisted.ScarecrowUntil == nil || *persisted.ScarecrowUntil <= nowMs {
		t.Fatalf("expected persisted scarecrow effect, got %+v", persisted.ScarecrowUntil)
	}
	if count := decodeFarmHTTPInventory(t, persisted.Inventory)["scarecrow"].Count; count != 0 {
		t.Fatalf("expected persisted scarecrow consumed, got %d", count)
	}
}

func TestFarmAdoptPetRoutePersistsPetAndBonus(t *testing.T) {
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

	userID := int64(26001 + time.Now().UnixNano()%1_000_000_000)
	nowMs := time.Now().UnixMilli()
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_adopt_pet_http")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	saveFarmHTTPState(t, ctx, store, state, nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/pet/adopt", strings.NewReader(`{"type":"dog","name":"豆豆"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_adopt_pet_http", "Farm Adopt Pet HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Balance != 110 || payload.Data.State.Points != 110 {
		t.Fatalf("unexpected adopt pet response: %+v", payload)
	}
	pet := decodeFarmHTTPPet(t, payload.Data.State.Pet)
	if pet["type"] != "dog" || pet["name"] != "豆豆" {
		t.Fatalf("unexpected response pet: %+v", pet)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	persistedPet := decodeFarmHTTPPet(t, persisted.Pet)
	if persistedPet["type"] != "dog" || persistedPet["name"] != "豆豆" || persisted.Points != 110 {
		t.Fatalf("unexpected persisted adopt state: pet=%+v points=%d", persistedPet, persisted.Points)
	}
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger
		  WHERE user_id = $1 AND amount = 10 AND source = 'game_play' AND description = '农场首次领养奖励' AND balance_after = 110`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query adopt ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one adopt ledger, got %d", ledgerCount)
	}
}

func TestFarmFeedPetRoutePersistsPetAndInventory(t *testing.T) {
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

	userID := int64(27001 + time.Now().UnixNano()%1_000_000_000)
	nowMs := time.Now().UnixMilli()
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_feed_pet_http")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":0,"hunger":80,"cleanliness":80,"mood":55,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":[],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	farmHTTPAddInventory(t, &state, "pet_food_normal", 1, nowMs)
	saveFarmHTTPState(t, ctx, store, state, nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/pet/feed", strings.NewReader(`{"kind":"normal"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_feed_pet_http", "Farm Feed Pet HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Balance int64               `json:"balance"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	pet := decodeFarmHTTPPet(t, payload.Data.State.Pet)
	feedToday := pet["feedToday"].(map[string]any)
	if !payload.Success || payload.Balance != 100 || feedToday["normal"].(float64) != 1 {
		t.Fatalf("unexpected feed pet response: payload=%+v pet=%+v", payload, pet)
	}
	if count := decodeFarmHTTPInventory(t, payload.Data.State.Inventory)["pet_food_normal"].Count; count != 0 {
		t.Fatalf("expected response food consumed, got %d", count)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	persistedPet := decodeFarmHTTPPet(t, persisted.Pet)
	if persistedPet["growth"].(float64) != 5 || decodeFarmHTTPInventory(t, persisted.Inventory)["pet_food_normal"].Count != 0 {
		t.Fatalf("unexpected persisted feed state: pet=%+v inventory=%s", persistedPet, string(persisted.Inventory))
	}
}

func TestFarmPetItemRoutesPersistPetAndInventory(t *testing.T) {
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

	userID := int64(28001 + time.Now().UnixNano()%1_000_000_000)
	nowMs := time.Now().UnixMilli()
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_pet_item_http")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"child","growth":0,"hunger":80,"cleanliness":80,"mood":55,"thirst":80,"hydrationVersion":2,"health":85,"learnedSkills":[],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	farmHTTPAddInventory(t, &state, "pet_milk", 1, nowMs)
	farmHTTPAddInventory(t, &state, "pet_vitamin", 1, nowMs)
	farmHTTPAddInventory(t, &state, "pet_nest", 1, nowMs)
	saveFarmHTTPState(t, ctx, store, state, nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	session := testSessionCookieFor(userID, "farm_pet_item_http", "Farm Pet Item HTTP")
	requests := []struct {
		path string
		body string
	}{
		{path: "/api/farm/pet/drink", body: `{"itemKey":"pet_milk"}`},
		{path: "/api/farm/pet/wash", body: `{"itemKey":"pet_vitamin"}`},
		{path: "/api/farm/pet/play", body: `{"mode":"rest","itemKey":"pet_nest"}`},
	}
	for _, item := range requests {
		request := httptest.NewRequest(http.MethodPost, item.path, strings.NewReader(item.body))
		request.Host = "example.com"
		request.Header.Set("Origin", "http://example.com")
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(session)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s expected 200, got %d body=%s", item.path, response.Code, response.Body.String())
		}
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	pet := decodeFarmHTTPPet(t, persisted.Pet)
	if pet["thirst"].(float64) < 99 || pet["health"].(float64) < 99 || pet["cleanliness"].(float64) < 99 {
		t.Fatalf("unexpected persisted pet after item routes: %+v", pet)
	}
	inventory := decodeFarmHTTPInventory(t, persisted.Inventory)
	for _, key := range []string{"pet_milk", "pet_vitamin", "pet_nest"} {
		if inventory[key].Count != 0 {
			t.Fatalf("expected %s consumed, inventory=%+v", key, inventory)
		}
	}
}

func TestFarmDispatchPetRoutePersistsTask(t *testing.T) {
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

	userID := int64(28501 + time.Now().UnixNano()%1_000_000_000)
	nowMs := time.Now().UnixMilli()
	cleanupFarmHTTPUsers(t, ctx, db, userID)
	defer cleanupFarmHTTPUsers(t, ctx, db, userID)
	insertFarmHTTPUser(t, ctx, db, userID, "farm_dispatch_pet_http")
	if _, err := db.Exec(ctx,
		`INSERT INTO point_accounts (user_id, balance, updated_at)
		 VALUES ($1, 100, now())`,
		userID,
	); err != nil {
		t.Fatalf("insert point account failed: %v", err)
	}

	store := farm.NewStore(db)
	state := farmHTTPInitialState(userID, nowMs, false)
	state.Pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":90,"cleanliness":90,"mood":90,"thirst":90,"hydrationVersion":2,"health":95,"learnedSkills":["water"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"stealTarget":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	saveFarmHTTPState(t, ctx, store, state, nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodPost, "/api/farm/pet/dispatch", strings.NewReader(`{"task":"water"}`))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(userID, "farm_dispatch_pet_http", "Farm Dispatch Pet HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool                `json:"success"`
		Data    farm.StatusResponse `json:"data"`
		Message string              `json:"message"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || payload.Data.State.UserID != userID {
		t.Fatalf("unexpected dispatch response payload: %+v", payload)
	}
	pet := decodeFarmHTTPPet(t, payload.Data.State.Pet)
	if pet["currentTask"] != "water" || pet["taskEndAt"].(float64) <= float64(nowMs) || pet["cooldownEndAt"].(float64) <= pet["taskEndAt"].(float64) {
		t.Fatalf("unexpected response pet task: %+v", pet)
	}

	persisted := readFarmHTTPState(t, ctx, store, userID)
	persistedPet := decodeFarmHTTPPet(t, persisted.Pet)
	if persistedPet["currentTask"] != "water" || persistedPet["taskEndAt"].(float64) != pet["taskEndAt"].(float64) {
		t.Fatalf("unexpected persisted pet task: %+v response=%+v", persistedPet, pet)
	}
}

func TestFarmStealListRouteReturnsCandidates(t *testing.T) {
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

	suffix := time.Now().UnixNano() % 1_000_000_000
	currentID := int64(28601 + suffix)
	eligibleID := int64(28701 + suffix)
	alreadyStolenID := int64(28801 + suffix)
	cleanupFarmHTTPUsers(t, ctx, db, currentID, eligibleID, alreadyStolenID)
	defer cleanupFarmHTTPUsers(t, ctx, db, currentID, eligibleID, alreadyStolenID)
	insertFarmHTTPUser(t, ctx, db, currentID, "farm_steal_list_http_current")
	insertFarmHTTPUser(t, ctx, db, eligibleID, "farm_steal_list_http_target")
	insertFarmHTTPUser(t, ctx, db, alreadyStolenID, "farm_steal_list_http_seen")

	nowMs := time.Now().UnixMilli()
	store := farm.NewStore(db)
	current := farmHTTPInitialState(currentID, nowMs, false)
	current.MyStealMap[fmt.Sprintf("%d", alreadyStolenID)] = 1
	saveFarmHTTPState(t, ctx, store, current, nowMs)
	saveFarmHTTPState(t, ctx, store, farmHTTPStealableTargetState(eligibleID, nowMs), nowMs)
	saveFarmHTTPState(t, ctx, store, farmHTTPStealableTargetState(alreadyStolenID, nowMs), nowMs)

	handler := newFarmHTTPIntegrationHandler(db)
	request := httptest.NewRequest(http.MethodGet, "/api/farm/steal/list", nil)
	request.AddCookie(testSessionCookieFor(currentID, "farm_steal_list_http_current", "Farm Steal List HTTP"))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success bool `json:"success"`
		Data    struct {
			Candidates []farm.StealCandidate `json:"candidates"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if !payload.Success || len(payload.Data.Candidates) != 1 {
		t.Fatalf("unexpected steal list payload: %+v", payload)
	}
	if payload.Data.Candidates[0].UserID != eligibleID || payload.Data.Candidates[0].Nickname != "farm_steal_list_http_target" {
		t.Fatalf("unexpected steal candidate: %+v", payload.Data.Candidates[0])
	}
}

func newFarmHTTPIntegrationHandler(db *pgxpool.Pool) http.Handler {
	resetInMemoryRateLimitsForTest()
	return New(Dependencies{
		Config: config.Config{SessionSecret: testSessionSecret},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	})
}

func insertFarmHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, username string) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID,
		username,
	); err != nil {
		t.Fatalf("insert farm HTTP user %d failed: %v", userID, err)
	}
}

func cleanupFarmHTTPUsers(t *testing.T, ctx context.Context, db *pgxpool.Pool, userIDs ...int64) {
	t.Helper()
	for _, userID := range userIDs {
		if _, err := db.Exec(ctx, `DELETE FROM farm_water_email_dedupes WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup farm water dedupe %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM farm_maturity_email_dedupes WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup farm maturity dedupe %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM farm_daily_shop_purchases WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup farm purchases %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM farm_states WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup farm states %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup point ledger %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID); err != nil {
			t.Fatalf("cleanup point accounts %d failed: %v", userID, err)
		}
		if _, err := db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
			t.Fatalf("cleanup users %d failed: %v", userID, err)
		}
	}
}

func farmHTTPInitialState(userID int64, nowMs int64, withStealPet bool) farm.FarmState {
	lands := make([]farm.LandPlot, 0, 8)
	for index := 1; index <= 8; index++ {
		status := farm.LandStatusLocked
		if index <= 4 {
			status = farm.LandStatusEmpty
		}
		lands = append(lands, farm.LandPlot{Index: index, Status: status})
	}
	pet := json.RawMessage(`null`)
	if withStealPet {
		pet = json.RawMessage(`{"type":"cat","name":"小咪","stage":"adult","growth":180,"hunger":90,"cleanliness":90,"mood":90,"thirst":90,"hydrationVersion":2,"health":95,"learnedSkills":["steal"],"currentTask":null,"taskStartAt":null,"taskEndAt":null,"cooldownEndAt":null,"feedToday":{"normal":0,"premium":0},"washToday":0,"waterToday":0,"playToday":0,"toyToday":0,"dailyResetAt":0}`)
	}
	return farm.FarmState{
		UserID:                userID,
		Points:                100,
		Lands:                 lands,
		Pet:                   pet,
		StolenByMap:           map[string]int64{},
		MyStealMap:            map[string]int64{},
		Inventory:             json.RawMessage(`{}`),
		PurchasedSkillBooks:   json.RawMessage(`{}`),
		SeedInventory:         json.RawMessage(`{"wheat":4,"carrot":2,"lettuce":1}`),
		Events:                json.RawMessage(`[]`),
		LastDailyResetAt:      nowMs,
		LastSeasonProcessedAt: nowMs,
		LastTickAt:            nowMs,
		Bonuses:               json.RawMessage(`{"firstWater":false,"firstHarvest":false,"firstAdopt":false}`),
		CreatedAt:             nowMs,
		UpdatedAt:             nowMs,
	}
}

func farmHTTPStealableTargetState(userID int64, nowMs int64) farm.FarmState {
	state := farmHTTPInitialState(userID, nowMs, false)
	birdNetUntil := nowMs + int64(time.Hour/time.Millisecond)
	state.Lands[0].Status = farm.LandStatusMature
	state.Lands[0].Crop = &farm.CropInstance{
		CropID:         farm.CropCarrot,
		PlantedAt:      nowMs - int64(2*time.Hour/time.Millisecond),
		MatureAt:       nowMs - int64(time.Minute/time.Millisecond),
		LastWaterAt:    nowMs - int64(2*time.Hour/time.Millisecond),
		NextWaterDueAt: nowMs + int64(time.Hour/time.Millisecond),
		WaterMissCount: 0,
		PlantedSeason:  farm.SeasonSpring,
		WeatherAtPlant: farm.WeatherSunny,
		BirdNetUntil:   &birdNetUntil,
	}
	return state
}

func saveFarmHTTPState(t *testing.T, ctx context.Context, store *farm.Store, state farm.FarmState, nowMs int64) {
	t.Helper()
	stateJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatalf("marshal farm HTTP state failed: %v", err)
	}
	if err := store.SaveState(ctx, farm.StateRecord{UserID: state.UserID, StateJSON: stateJSON, LastTickAtMs: state.LastTickAt, UpdatedAtMs: nowMs}); err != nil {
		t.Fatalf("save farm HTTP state %d failed: %v", state.UserID, err)
	}
}

func readFarmHTTPState(t *testing.T, ctx context.Context, store *farm.Store, userID int64) farm.FarmState {
	t.Helper()
	record, err := store.GetState(ctx, userID)
	if err != nil {
		t.Fatalf("read farm HTTP state %d failed: %v", userID, err)
	}
	if !record.Exists {
		t.Fatalf("expected farm HTTP state %d to exist", userID)
	}
	var state farm.FarmState
	if err := json.Unmarshal(record.StateJSON, &state); err != nil {
		t.Fatalf("decode farm HTTP state %d failed: %v", userID, err)
	}
	return state
}

func decodeFarmHTTPIntMap(t *testing.T, raw json.RawMessage) map[string]int64 {
	t.Helper()
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]int64{}
	}
	var result map[string]int64
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("decode int map failed: %v", err)
	}
	return result
}

func decodeFarmHTTPInventory(t *testing.T, raw json.RawMessage) map[string]struct {
	Count     int64 `json:"count"`
	UpdatedAt int64 `json:"updatedAt"`
} {
	t.Helper()
	if len(raw) == 0 || string(raw) == "null" {
		return map[string]struct {
			Count     int64 `json:"count"`
			UpdatedAt int64 `json:"updatedAt"`
		}{}
	}
	var result map[string]struct {
		Count     int64 `json:"count"`
		UpdatedAt int64 `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatalf("decode inventory failed: %v", err)
	}
	return result
}

func farmHTTPAddInventory(t *testing.T, state *farm.FarmState, key string, qty int64, nowMs int64) {
	t.Helper()
	inventory := decodeFarmHTTPInventory(t, state.Inventory)
	item := inventory[key]
	item.Count += qty
	item.UpdatedAt = nowMs
	inventory[key] = item
	raw, err := json.Marshal(inventory)
	if err != nil {
		t.Fatalf("encode inventory failed: %v", err)
	}
	state.Inventory = raw
}

func decodeFarmHTTPPet(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		t.Fatalf("decode pet failed: %v raw=%s", err, string(raw))
	}
	return result
}

func assertFarmHTTPPointLedgerExists(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, descriptionPrefix string) {
	t.Helper()
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND description LIKE $2`,
		userID,
		descriptionPrefix+"%",
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query farm HTTP steal ledger failed: %v", err)
	}
	if ledgerCount != 1 {
		t.Fatalf("expected one steal ledger, got %d", ledgerCount)
	}
}

func assertFarmHTTPNoStealLedger(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	var ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND description LIKE '偷菜成功:%'`,
		userID,
	).Scan(&ledgerCount); err != nil {
		t.Fatalf("query farm HTTP no steal ledger failed: %v", err)
	}
	if ledgerCount != 0 {
		t.Fatalf("expected no steal ledger after failed attempt, got %d", ledgerCount)
	}
}
