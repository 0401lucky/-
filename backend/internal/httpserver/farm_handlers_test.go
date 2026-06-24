package httpserver

import (
	"net/http"
	"strings"
	"testing"
)

func TestFarmStealDoRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/steal/do", `{"targetUserId":2}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmStealListRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/farm/steal/list", "", false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmStatusRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/farm/status", "", false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmStatusReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	getResponse := performJSONRequest(handler, http.MethodGet, "/api/farm/status", "", true)
	if getResponse.Code != http.StatusServiceUnavailable || !strings.Contains(getResponse.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected GET unavailable response: status=%d body=%s", getResponse.Code, getResponse.Body.String())
	}

	postResponse := performJSONRequest(handler, http.MethodPost, "/api/farm/status", `{}`, true)
	if postResponse.Code != http.StatusServiceUnavailable || !strings.Contains(postResponse.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected POST unavailable response: status=%d body=%s", postResponse.Code, postResponse.Body.String())
	}
}

func TestFarmStealDoValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/steal/do", `{"targetUserId":0}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmStealDoReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/steal/do", `{"targetUserId":2}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmStealListReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodGet, "/api/farm/steal/list", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmPlantRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/plant", `{"plotIndex":0,"cropId":"wheat"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmPlantValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	missingPlot := performJSONRequest(handler, http.MethodPost, "/api/farm/plant", `{"cropId":"wheat"}`, true)
	if missingPlot.Code != http.StatusBadRequest || !strings.Contains(missingPlot.Body.String(), "参数无效") {
		t.Fatalf("unexpected missing plot response: status=%d body=%s", missingPlot.Code, missingPlot.Body.String())
	}

	missingCrop := performJSONRequest(handler, http.MethodPost, "/api/farm/plant", `{"plotIndex":0}`, true)
	if missingCrop.Code != http.StatusBadRequest || !strings.Contains(missingCrop.Body.String(), "参数无效") {
		t.Fatalf("unexpected missing crop response: status=%d body=%s", missingCrop.Code, missingCrop.Body.String())
	}
}

func TestFarmPlantReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/plant", `{"plotIndex":0,"cropId":"wheat"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmWaterRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/water", `{"plotIndex":0}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmWaterValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/water", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmWaterReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/water", `{"plotIndex":0}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmWaterAllRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/water-all", "", false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmWaterAllReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/water-all", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmHarvestRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/harvest", `{"plotIndex":0}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmHarvestValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/harvest", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmHarvestReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/harvest", `{"plotIndex":0}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmHarvestAllRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/harvest-all", "", false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmHarvestAllReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/harvest-all", "", true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmRemoveRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/remove", `{"plotIndex":0}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmRemoveValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/remove", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmRemoveReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/remove", `{"plotIndex":0}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuySeedsRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/seeds/buy", `{"cropId":"wheat","qty":1}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmBuySeedsValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/seeds/buy", `{"qty":1}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuySeedsReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/seeds/buy", `{"cropId":"wheat","qty":1}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuyLandRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/buy-land", `{"landIndex":5}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmBuyLandValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/buy-land", `{}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuyLandReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/buy-land", `{"landIndex":5}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuyShopItemRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/buy", `{"key":"pet_food_normal","qty":1}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmBuyShopItemValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/buy", `{"qty":1}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmBuyShopItemReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/buy", `{"key":"pet_food_normal","qty":1}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmUseShopItemRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/use", `{"key":"scarecrow"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmUseShopItemValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/use", `{"plotIndex":0}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmUseShopItemReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/shop/use", `{"key":"scarecrow"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmAdoptPetRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/adopt", `{"type":"cat","name":"小咪"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmAdoptPetValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/adopt", `{"name":"小咪"}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmAdoptPetReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/adopt", `{"type":"cat","name":"小咪"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmFeedPetRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/feed", `{"kind":"normal"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmFeedPetValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/feed", `{"kind":"bad"}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmFeedPetReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/feed", `{"kind":"normal"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmPetItemRoutesRequireLogin(t *testing.T) {
	handler := New(testDependencies())

	for _, path := range []string{"/api/farm/pet/drink", "/api/farm/pet/wash", "/api/farm/pet/play"} {
		t.Run(path, func(t *testing.T) {
			response := performJSONRequest(handler, http.MethodPost, path, `{}`, false)
			if response.Code != http.StatusUnauthorized {
				t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestFarmPetItemRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	for _, path := range []string{"/api/farm/pet/drink", "/api/farm/pet/wash", "/api/farm/pet/play"} {
		t.Run(path, func(t *testing.T) {
			response := performJSONRequest(handler, http.MethodPost, path, `{}`, true)
			if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
				t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestFarmDispatchPetRequiresLogin(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/dispatch", `{"task":"water"}`, false)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d body=%s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "未登录") {
		t.Fatalf("expected unauthenticated response, got %s", response.Body.String())
	}
}

func TestFarmDispatchPetValidatesPayload(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/dispatch", `{"task":"steal"}`, true)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), "任务参数无效") {
		t.Fatalf("unexpected validation response: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestFarmDispatchPetReturnsUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependencies())

	response := performJSONRequest(handler, http.MethodPost, "/api/farm/pet/dispatch", `{"task":"water"}`, true)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "农场数据库未配置") {
		t.Fatalf("unexpected unavailable response: status=%d body=%s", response.Code, response.Body.String())
	}
}
