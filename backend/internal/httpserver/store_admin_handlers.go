package httpserver

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/economy"
)

type adminStoreItemCreatePayload struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
	CategoryID  string `json:"categoryId"`
	PointsCost  int64  `json:"pointsCost"`
	Value       int64  `json:"value"`
	DailyLimit  *int64 `json:"dailyLimit"`
	SortOrder   int    `json:"sortOrder"`
	Enabled     *bool  `json:"enabled"`
}

type adminStoreItemUpdatePayload struct {
	ID          string          `json:"id"`
	Name        *string         `json:"name"`
	Description *string         `json:"description"`
	Type        *string         `json:"type"`
	CategoryID  *string         `json:"categoryId"`
	PointsCost  *int64          `json:"pointsCost"`
	Value       *int64          `json:"value"`
	DailyLimit  json.RawMessage `json:"dailyLimit"`
	SortOrder   *int            `json:"sortOrder"`
	Enabled     *bool           `json:"enabled"`
}

type adminStoreCategoryPayload struct {
	Kind               string          `json:"kind"`
	ID                 string          `json:"id"`
	Name               string          `json:"name"`
	Color              string          `json:"color"`
	SortOrder          int             `json:"sortOrder"`
	Enabled            *bool           `json:"enabled"`
	Key                string          `json:"key"`
	Cost               json.RawMessage `json:"cost"`
	DailyLimit         json.RawMessage `json:"dailyLimit"`
	DurationMinutes    json.RawMessage `json:"durationMinutes"`
	SpeedReduceMinutes json.RawMessage `json:"speedReduceMinutes"`
	PetEffect          json.RawMessage `json:"petEffect"`
}

type adminStoreDeletePayload struct {
	ID string `json:"id"`
}

func (handlers economyHandlers) getStoreAdmin(writer http.ResponseWriter, request *http.Request) {
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	data, err := handlers.service.GetStoreAdmin(request.Context())
	if err != nil {
		handlers.deps.Logger.Error("查询商城后台失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{
			"success": false,
			"message": "获取商品列表失败",
		})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    data,
	})
}

func (handlers economyHandlers) createStoreAdminItem(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminStoreItemCreatePayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}

	input, ok := buildCreateStoreItemInput(writer, payload)
	if !ok {
		return
	}
	item, err := handlers.service.CreateStoreItem(request.Context(), input)
	if errors.Is(err, economy.ErrStoreCategoryNotFound) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品分类无效"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("创建商城商品失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "创建商品失败"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"item": item},
		"message": "商品创建成功",
	})
}

func (handlers economyHandlers) updateStoreAdminItem(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminStoreItemUpdatePayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	input, ok := buildUpdateStoreItemInput(writer, payload)
	if !ok {
		return
	}
	item, err := handlers.service.UpdateStoreItem(request.Context(), input)
	if errors.Is(err, economy.ErrStoreItemNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "商品不存在"})
		return
	}
	if errors.Is(err, economy.ErrStoreCategoryNotFound) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品分类无效"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("更新商城商品失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "更新商品失败"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"item": item},
		"message": "商品更新成功",
	})
}

func (handlers economyHandlers) saveStoreAdminCategory(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminStoreCategoryPayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	if payload.Kind == "farm-item" {
		if strings.TrimSpace(payload.Key) == "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "农场商品 key 不能为空"})
			return
		}
		override, err := handlers.service.SaveFarmShopItemOverride(request.Context(), economy.FarmShopItemOverrideInput{
			Key:                payload.Key,
			Cost:               normalizeJSONInt64(payload.Cost, 0),
			DailyLimit:         normalizeJSONInt64(payload.DailyLimit, 0),
			DurationMinutes:    normalizeJSONInt64(payload.DurationMinutes, 1),
			SpeedReduceMinutes: normalizeJSONInt64(payload.SpeedReduceMinutes, 1),
			PetEffect:          normalizeJSONPetEffect(payload.PetEffect),
		})
		if errors.Is(err, economy.ErrFarmShopItemNotFound) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "未知农场商品"})
			return
		}
		if err != nil {
			handlers.deps.Logger.Error("保存农场商品配置失败", "error", err)
			writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "保存分类失败"})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{
			"success": true,
			"data":    map[string]any{"override": override},
			"message": "农场商品配置已保存",
		})
		return
	}
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	if strings.TrimSpace(payload.Name) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "分类名称不能为空"})
		return
	}
	if strings.TrimSpace(payload.Color) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "分类颜色不能为空"})
		return
	}

	category, err := handlers.service.SaveStoreCategory(request.Context(), economy.StoreCategoryMutationInput{
		ID:        payload.ID,
		Name:      payload.Name,
		Color:     payload.Color,
		SortOrder: payload.SortOrder,
		Enabled:   enabled,
	})
	if errors.Is(err, economy.ErrStoreCategoryNotFound) {
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "分类不存在"})
		return
	}
	if err != nil {
		handlers.deps.Logger.Error("保存商城分类失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "保存分类失败"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"data":    map[string]any{"category": category},
		"message": "分类保存成功",
	})
}

func (handlers economyHandlers) deleteStoreAdminItem(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}

	var payload adminStoreDeletePayload
	if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "请求体格式无效"})
		return
	}
	if strings.TrimSpace(payload.ID) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品 ID 不能为空"})
		return
	}
	deleted, err := handlers.service.DeleteStoreItem(request.Context(), payload.ID)
	if err != nil {
		handlers.deps.Logger.Error("删除商城商品失败", "error", err)
		writeJSON(writer, http.StatusInternalServerError, map[string]any{"success": false, "message": "删除商品失败"})
		return
	}
	if !deleted {
		writeJSON(writer, http.StatusNotFound, map[string]any{"success": false, "message": "商品不存在"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"success": true,
		"message": "商品删除成功",
	})
}

func (handlers economyHandlers) adminStoreResetDisabled(writer http.ResponseWriter, request *http.Request) {
	if handlers.rejectUntrustedUnsafeRequest(writer, request) {
		return
	}
	if _, ok := handlers.requireAdmin(writer, request); !ok {
		return
	}
	writeJSON(writer, http.StatusGone, map[string]any{
		"success": false,
		"code":    "ADMIN_STORE_RESET_DISABLED",
		"message": "旧商店重置接口已下线。Zeabur 生产环境使用 PostgreSQL 商品表，请通过后台商品管理逐项编辑或使用受控迁移脚本处理。",
	})
}

func (handlers economyHandlers) requireAdmin(writer http.ResponseWriter, request *http.Request) (*auth.User, bool) {
	user, ok := handlers.requireUser(writer, request)
	if !ok {
		return nil, false
	}
	if !user.IsAdmin {
		writeJSON(writer, http.StatusForbidden, map[string]any{
			"success": false,
			"message": "无管理员权限",
		})
		return nil, false
	}
	return user, true
}

func buildCreateStoreItemInput(writer http.ResponseWriter, payload adminStoreItemCreatePayload) (economy.StoreItemMutationInput, bool) {
	if strings.TrimSpace(payload.Name) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品名称不能为空"})
		return economy.StoreItemMutationInput{}, false
	}
	if !isAdminStoreItemType(payload.Type) {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品类型无效，必须是 lottery_spin / card_draw / makeup_card"})
		return economy.StoreItemMutationInput{}, false
	}
	if strings.TrimSpace(payload.CategoryID) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品分类无效"})
		return economy.StoreItemMutationInput{}, false
	}
	if payload.PointsCost < 1 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "积分价格必须是正整数（≥1）"})
		return economy.StoreItemMutationInput{}, false
	}
	if payload.Value < 1 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "获得数值必须是正数"})
		return economy.StoreItemMutationInput{}, false
	}
	if payload.Enabled == nil {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "上架状态必须是布尔值"})
		return economy.StoreItemMutationInput{}, false
	}
	dailyLimit := normalizeAdminDailyLimit(payload.DailyLimit)
	return economy.StoreItemMutationInput{
		Name:        payload.Name,
		Description: payload.Description,
		Type:        payload.Type,
		CategoryID:  payload.CategoryID,
		PointsCost:  payload.PointsCost,
		Value:       payload.Value,
		DailyLimit:  dailyLimit,
		SortOrder:   payload.SortOrder,
		Enabled:     *payload.Enabled,
	}, true
}

func buildUpdateStoreItemInput(writer http.ResponseWriter, payload adminStoreItemUpdatePayload) (economy.StoreItemUpdateInput, bool) {
	if strings.TrimSpace(payload.ID) == "" {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品 ID 不能为空"})
		return economy.StoreItemUpdateInput{}, false
	}
	input := economy.StoreItemUpdateInput{ID: payload.ID}
	updates := 0

	if payload.Name != nil {
		if strings.TrimSpace(*payload.Name) == "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品名称不能为空"})
			return economy.StoreItemUpdateInput{}, false
		}
		input.Name = payload.Name
		updates++
	}
	if payload.Description != nil {
		input.Description = payload.Description
		updates++
	}
	if payload.Type != nil {
		if !isAdminStoreItemType(*payload.Type) {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品类型无效"})
			return economy.StoreItemUpdateInput{}, false
		}
		input.Type = payload.Type
		updates++
	}
	if payload.CategoryID != nil {
		if strings.TrimSpace(*payload.CategoryID) == "" {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "商品分类无效"})
			return economy.StoreItemUpdateInput{}, false
		}
		input.CategoryID = payload.CategoryID
		updates++
	}
	if payload.PointsCost != nil {
		if *payload.PointsCost < 1 {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "积分价格必须是正整数（≥1）"})
			return economy.StoreItemUpdateInput{}, false
		}
		input.PointsCost = payload.PointsCost
		updates++
	}
	if payload.Value != nil {
		if *payload.Value < 1 {
			writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "获得数值必须是正数"})
			return economy.StoreItemUpdateInput{}, false
		}
		input.Value = payload.Value
		updates++
	}
	if payload.SortOrder != nil {
		input.SortOrder = payload.SortOrder
		updates++
	}
	if payload.Enabled != nil {
		input.Enabled = payload.Enabled
		updates++
	}
	if payload.DailyLimit != nil {
		dailyLimit, ok := parseAdminDailyLimitRaw(writer, payload.DailyLimit)
		if !ok {
			return economy.StoreItemUpdateInput{}, false
		}
		input.DailyLimitSet = true
		input.DailyLimit = dailyLimit
		updates++
	}
	if updates == 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "没有提供更新字段"})
		return economy.StoreItemUpdateInput{}, false
	}
	return input, true
}

func normalizeAdminDailyLimit(value *int64) *int64 {
	if value == nil || *value <= 0 {
		return nil
	}
	next := *value
	return &next
}

func parseAdminDailyLimitRaw(writer http.ResponseWriter, raw json.RawMessage) (*int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, true
	}
	var value int64
	if err := json.Unmarshal(raw, &value); err != nil || value < 0 {
		writeJSON(writer, http.StatusBadRequest, map[string]any{"success": false, "message": "每日限购必须是非负整数"})
		return nil, false
	}
	if value == 0 {
		return nil, true
	}
	return &value, true
}

func isAdminStoreItemType(itemType string) bool {
	return itemType == economy.ItemTypeLotterySpin ||
		itemType == economy.ItemTypeCardDraw ||
		itemType == economy.ItemTypeMakeupCard
}

func (handlers economyHandlers) rejectUntrustedUnsafeRequest(writer http.ResponseWriter, request *http.Request) bool {
	switch request.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return false
	}

	origin := strings.TrimRight(request.Header.Get("Origin"), "/")
	if origin != "" {
		if originAllowed(request, origin) {
			return false
		}
		writeJSON(writer, http.StatusForbidden, map[string]any{"success": false, "message": "请求来源不合法"})
		return true
	}

	fetchSite := request.Header.Get("Sec-Fetch-Site")
	if fetchSite == "same-origin" || fetchSite == "same-site" || fetchSite == "none" {
		return false
	}
	if fetchSite != "" {
		writeJSON(writer, http.StatusForbidden, map[string]any{"success": false, "message": "跨站请求已被拒绝"})
		return true
	}
	if request.Header.Get("Authorization") != "" {
		return false
	}

	writeJSON(writer, http.StatusForbidden, map[string]any{"success": false, "message": "缺少可信请求来源"})
	return true
}

func originAllowed(request *http.Request, origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false
	}
	if strings.EqualFold(parsed.Host, request.Host) {
		return true
	}
	return strings.EqualFold(origin, "http://localhost:3000")
}

func normalizeJSONInt64(raw json.RawMessage, min int64) *int64 {
	if len(raw) == 0 || string(raw) == "null" || string(raw) == `""` {
		return nil
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil
	}
	number, ok := numberFromJSONValue(value)
	if !ok || number < float64(min) || number > float64(math.MaxInt64) {
		return nil
	}
	normalized := int64(number)
	return &normalized
}

func normalizeJSONPetEffect(raw json.RawMessage) economy.PetItemEffect {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var payload map[string]any
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil
	}

	effect := make(economy.PetItemEffect)
	for _, key := range []string{"hunger", "cleanliness", "mood", "thirst", "health", "growth"} {
		number, ok := numberFromJSONValue(payload[key])
		if ok && number <= float64(math.MaxInt64) && number >= float64(math.MinInt64) {
			effect[key] = int64(number)
		}
	}
	if len(effect) == 0 {
		return nil
	}
	return effect
}

func numberFromJSONValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case string:
		if strings.TrimSpace(typed) == "" {
			return 0, false
		}
		number, err := strconv.ParseFloat(typed, 64)
		return number, err == nil && !math.IsNaN(number) && !math.IsInf(number, 0)
	default:
		return 0, false
	}
}
