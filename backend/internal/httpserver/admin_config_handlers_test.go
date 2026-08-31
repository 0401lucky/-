package httpserver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminConfigRoutesRequireAdminAndValidatePayload(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	unauthenticated := performJSONRequest(handler, http.MethodGet, "/api/admin/config", "", false)
	if unauthenticated.Code != http.StatusUnauthorized || !strings.Contains(unauthenticated.Body.String(), "未登录") {
		t.Fatalf("expected admin config get to require login, got status=%d body=%s", unauthenticated.Code, unauthenticated.Body.String())
	}

	nonAdmin := performJSONRequest(handler, http.MethodPut, "/api/admin/config", `{"dailyPointsLimit":5000}`, true)
	if nonAdmin.Code != http.StatusForbidden || !strings.Contains(nonAdmin.Body.String(), "无管理员权限") {
		t.Fatalf("expected admin config put to require admin, got status=%d body=%s", nonAdmin.Code, nonAdmin.Body.String())
	}

	invalid := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", `{"dailyPointsLimit":99}`, testSessionCookieFor(1, "admin", "Admin"))
	if invalid.Code != http.StatusBadRequest || !strings.Contains(invalid.Body.String(), "每日积分上限必须在 100 - 100000 之间") {
		t.Fatalf("expected invalid limit response, got status=%d body=%s", invalid.Code, invalid.Body.String())
	}
}

func TestAdminConfigRoutesReturnUnavailableWithoutDatabase(t *testing.T) {
	handler := New(testDependenciesWithAdmin())
	get := performJSONRequestWithCookie(handler, http.MethodGet, "/api/admin/config", "", testSessionCookieFor(1, "admin", "Admin"))
	if get.Code != http.StatusServiceUnavailable || !strings.Contains(get.Body.String(), "系统配置数据库未配置") {
		t.Fatalf("expected no-db get response, got status=%d body=%s", get.Code, get.Body.String())
	}

	put := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", adminConfigFullPayload(6000, 365), testSessionCookieFor(1, "admin", "Admin"))
	if put.Code != http.StatusServiceUnavailable || !strings.Contains(put.Body.String(), "系统配置数据库未配置") {
		t.Fatalf("expected no-db put response, got status=%d body=%s", put.Code, put.Body.String())
	}
}

// adminConfigFullPayload 拼出全部 9 个字段都合法的请求体。
// 缺失字段现在一律 400，所以想走到 handler 后段的用例必须全量提交。
func adminConfigFullPayload(dailyPointsLimit int64, vipMaxTotalDays int64) string {
	return fmt.Sprintf(
		`{"dailyPointsLimit":%d,"dailyWithdrawLimit":4,"vipDailyWithdrawLimit":8,`+
			`"vipPricePoints":3000,"vipDurationDays":30,"vipWithdrawFeePercent":50,`+
			`"vipDailyLotterySpins":2,"vipMaxTotalDays":%d,"withdrawBalanceCapDollars":10000}`,
		dailyPointsLimit, vipMaxTotalDays,
	)
}

// TestAdminConfigUpdateRejectsMissingField 逐个字段验证「漏传即 400」。
// systemconfig.Update 的 nil 语义是「重置为默认值」，若 handler 回落默认值，
// 管理员只提交一个字段就会静默把其余 8 项刷成默认值。
func TestAdminConfigUpdateRejectsMissingField(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	// key 是被删掉的字段，value 是期望的中文提示
	cases := map[string]string{
		"dailyPointsLimit":          "每日积分上限必须在 100 - 100000 之间",
		"dailyWithdrawLimit":        "普通用户每日提现次数必须在 1 - 100 之间",
		"vipDailyWithdrawLimit":     "VIP 每日提现次数必须在 1 - 100 之间",
		"vipPricePoints":            "月卡价格必须在 1 - 1000000 积分之间",
		"vipDurationDays":           "月卡时长必须在 1 - 365 天之间",
		"vipWithdrawFeePercent":     "VIP 手续费百分比必须在 0 - 100 之间",
		"vipDailyLotterySpins":      "VIP 每日赠送抽奖次数必须在 0 - 50 之间",
		"vipMaxTotalDays":           "VIP 累计时长上限必须在 1 - 3650 天之间",
		"withdrawBalanceCapDollars": "账户额度提现上限必须在 $1 - $1000000000000 之间",
	}
	full := map[string]int64{
		"dailyPointsLimit":          5000,
		"dailyWithdrawLimit":        4,
		"vipDailyWithdrawLimit":     8,
		"vipPricePoints":            3000,
		"vipDurationDays":           30,
		"vipWithdrawFeePercent":     50,
		"vipDailyLotterySpins":      2,
		"vipMaxTotalDays":           365,
		"withdrawBalanceCapDollars": 10000,
	}

	for omitted, message := range cases {
		partial := make(map[string]int64, len(full))
		for key, value := range full {
			if key != omitted {
				partial[key] = value
			}
		}
		body, err := json.Marshal(partial)
		if err != nil {
			t.Fatalf("marshal payload failed: %v", err)
		}
		response := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", string(body), testSessionCookieFor(1, "admin", "Admin"))
		if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), message) {
			t.Fatalf("漏传 %s 应返回 400 与「%s」，实际 status=%d body=%s",
				omitted, message, response.Code, response.Body.String())
		}
	}
}

// TestAdminConfigUpdateRejectsVIPDurationAboveMaxTotal 覆盖跨字段校验。
// 两个字段各自都在合法区间内，只有组合非法，所以逐项校验抓不到。
func TestAdminConfigUpdateRejectsVIPDurationAboveMaxTotal(t *testing.T) {
	handler := New(testDependenciesWithAdmin())

	// vipDurationDays=30 合法、vipMaxTotalDays=20 合法，但上限小于月卡时长
	conflict := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", adminConfigFullPayload(5000, 20), testSessionCookieFor(1, "admin", "Admin"))
	if conflict.Code != http.StatusBadRequest || !strings.Contains(conflict.Body.String(), "VIP 累计时长上限不能小于月卡时长") {
		t.Fatalf("expected cross-field conflict 400, got status=%d body=%s", conflict.Code, conflict.Body.String())
	}

	// 上限等于月卡时长是允许的：此时无数据库，说明已越过校验走到 Update
	boundary := performJSONRequestWithCookie(handler, http.MethodPut, "/api/admin/config", adminConfigFullPayload(5000, 30), testSessionCookieFor(1, "admin", "Admin"))
	if boundary.Code != http.StatusServiceUnavailable {
		t.Fatalf("上限等于月卡时长应通过跨字段校验，实际 status=%d body=%s", boundary.Code, boundary.Body.String())
	}
}

func performJSONRequestWithCookie(handler http.Handler, method string, path string, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = bytes.NewBufferString(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch || method == http.MethodDelete {
		request.Host = "example.com"
		request.Header.Set("Origin", "http://example.com")
	}
	request.AddCookie(cookie)
	return performRequest(handler, request)
}
