package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"redemption/backend/internal/farm"
)

type farmHandlers struct {
	deps    Dependencies
	service *farm.Service
}

func newFarmHandlers(deps Dependencies) farmHandlers {
	return farmHandlers{
		deps:    deps,
		service: farm.NewService(farm.NewStore(deps.DB)),
	}
}

func (handlers farmHandlers) status(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "查询农场状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
	})
}

func (handlers farmHandlers) stealDo(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		TargetUserID int64 `json:"targetUserId"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.TargetUserID <= 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteSteal(request.Context(), user.ID, payload.TargetUserID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场偷菜失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场偷菜后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"steal": map[string]any{
			"success":  result.Success,
			"amount":   result.Amount,
			"cropId":   result.CropID,
			"cropName": result.CropName,
			"balance":  result.Balance,
		},
	})
}

func (handlers farmHandlers) stealList(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	candidates, err := handlers.service.ListStealCandidates(request.Context(), user.ID, 8)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场偷菜候选列表失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data": map[string]any{
			"candidates": candidates,
		},
	})
}

func (handlers farmHandlers) plant(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		PlotIndex *int        `json:"plotIndex"`
		CropID    farm.CropID `json:"cropId"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.PlotIndex == nil || payload.CropID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecutePlant(request.Context(), user.ID, *payload.PlotIndex, payload.CropID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场种植失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场种植后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) water(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		PlotIndex *int `json:"plotIndex"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.PlotIndex == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteWater(request.Context(), user.ID, *payload.PlotIndex, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场浇水失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场浇水后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"bonus":   result.Bonus,
	})
}

func (handlers farmHandlers) waterAll(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	result, err := handlers.service.ExecuteWaterAll(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场一键浇水失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场一键浇水后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"count":   result.Count,
	})
}

func (handlers farmHandlers) harvest(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		PlotIndex *int `json:"plotIndex"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.PlotIndex == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteHarvest(request.Context(), user.ID, *payload.PlotIndex, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场收获失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场收获后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"harvest": result.Harvest,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) harvestAll(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	result, err := handlers.service.ExecuteHarvestAll(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场一键收获失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场一键收获后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success":  true,
		"data":     status,
		"harvests": result.Harvests,
		"total":    result.Total,
		"balance":  result.Balance,
	})
}

func (handlers farmHandlers) remove(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		PlotIndex *int `json:"plotIndex"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.PlotIndex == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteRemove(request.Context(), user.ID, *payload.PlotIndex, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场清除枯萎作物失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场清除后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
	})
}

func (handlers farmHandlers) buySeeds(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		CropID farm.CropID `json:"cropId"`
		Qty    *float64    `json:"qty"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.CropID == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}
	qty := int64(1)
	if payload.Qty != nil && *payload.Qty > 0 {
		qty = int64(math.Floor(*payload.Qty))
	}

	result, err := handlers.service.ExecuteBuySeeds(request.Context(), user.ID, payload.CropID, qty, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买种子失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买种子后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) buyLand(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		LandIndex *float64 `json:"landIndex"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.LandIndex == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}
	landIndex := int(math.Trunc(*payload.LandIndex))
	if *payload.LandIndex != math.Trunc(*payload.LandIndex) {
		landIndex = -1
	}

	result, err := handlers.service.ExecuteBuyLand(request.Context(), user.ID, landIndex, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买土地失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买土地后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) buyShopItem(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		Key string   `json:"key"`
		Qty *float64 `json:"qty"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.Key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}
	qty := int64(1)
	if payload.Qty != nil && *payload.Qty > 0 {
		qty = int64(math.Floor(*payload.Qty))
	}

	result, err := handlers.service.ExecuteBuyShopItem(request.Context(), user.ID, payload.Key, qty, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买道具失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场购买道具后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) useShopItem(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload map[string]any
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}
	key, ok := payload["key"].(string)
	if !ok || key == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}
	var plotIndex *int
	if raw, ok := payload["plotIndex"].(float64); ok {
		index := int(math.Floor(raw))
		plotIndex = &index
	}

	result, err := handlers.service.ExecuteUseShopItem(request.Context(), user.ID, key, plotIndex, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场使用道具失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场使用道具后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
	})
}

func (handlers farmHandlers) adoptPet(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.Type == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteAdoptPet(request.Context(), user.ID, payload.Type, payload.Name, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场领养宠物失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场领养宠物后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) feedPet(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		Kind string `json:"kind"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || (payload.Kind != "normal" && payload.Kind != "premium") {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "参数无效"})
		return
	}

	result, err := handlers.service.ExecuteFeedPet(request.Context(), user.ID, payload.Kind, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场喂养宠物失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}

	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场喂养宠物后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"balance": result.Balance,
	})
}

func (handlers farmHandlers) drinkPet(writer http.ResponseWriter, request *http.Request) {
	handlers.usePetItem(writer, request, "drink", "pet_water_basic", false)
}

func (handlers farmHandlers) washPet(writer http.ResponseWriter, request *http.Request) {
	handlers.usePetItem(writer, request, "care", "pet_care_basic", true)
}

func (handlers farmHandlers) playPet(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		Mode    string `json:"mode"`
		ItemKey string `json:"itemKey"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = struct {
			Mode    string `json:"mode"`
			ItemKey string `json:"itemKey"`
		}{}
	}
	mode := payload.Mode
	if mode == "" {
		mode = "play"
	}
	expectedCategory := "play"
	defaultItemKey := "pet_play_basic"
	if mode == "rest" {
		expectedCategory = "rest"
		defaultItemKey = "pet_rest_basic"
	}
	itemKey := payload.ItemKey
	if itemKey == "" {
		itemKey = defaultItemKey
	}

	result, err := handlers.service.ExecuteUsePetItem(request.Context(), user.ID, itemKey, expectedCategory, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场宠物互动失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}
	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场宠物互动后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"success": true, "data": status})
}

func (handlers farmHandlers) dispatchPet(writer http.ResponseWriter, request *http.Request) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		Task string `json:"task"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || !isAllowedFarmPetDispatchTask(payload.Task) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "任务参数无效"})
		return
	}

	result, err := handlers.service.ExecuteDispatchPet(request.Context(), user.ID, payload.Task, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场宠物派遣失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}
	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场宠物派遣后查询状态失败", err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    status,
		"message": result.Msg,
	})
}

func isAllowedFarmPetDispatchTask(task string) bool {
	switch task {
	case "water", "guard", "chase_crow", "harvest", "plant":
		return true
	default:
		return false
	}
}

func (handlers farmHandlers) usePetItem(writer http.ResponseWriter, request *http.Request, expectedCategory string, defaultItemKey string, includeBalance bool) {
	shared := economyHandlers{deps: handlers.deps}
	if shared.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	user, ok := shared.requireUser(writer, request)
	if !ok {
		return
	}
	if shared.rejectRateLimited(writer, request, *user, farmActionRateLimit) {
		return
	}

	var payload struct {
		ItemKey string `json:"itemKey"`
	}
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		payload = struct {
			ItemKey string `json:"itemKey"`
		}{}
	}
	itemKey := payload.ItemKey
	if itemKey == "" {
		itemKey = defaultItemKey
	}

	result, err := handlers.service.ExecuteUsePetItem(request.Context(), user.ID, itemKey, expectedCategory, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场使用宠物物品失败", err)
		return
	}
	if !result.OK {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": result.Msg})
		return
	}
	status, err := handlers.service.GetStatus(request.Context(), user.ID, 0)
	if err != nil {
		handlers.writeFarmServiceError(writer, "农场使用宠物物品后查询状态失败", err)
		return
	}
	payloadOut := map[string]any{"success": true, "data": status}
	if includeBalance {
		payloadOut["balance"] = result.Balance
	}
	writeJSON(writer, http.StatusOK, payloadOut)
}

func (handlers farmHandlers) writeFarmServiceError(writer http.ResponseWriter, logMessage string, err error) {
	if errors.Is(err, farm.ErrUnavailable) {
		writeJSON(writer, http.StatusServiceUnavailable, map[string]any{
			"success": false,
			"message": "农场数据库未配置",
		})
		return
	}
	handlers.deps.Logger.Error(logMessage, "error", err)
	writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "服务器错误"})
}
