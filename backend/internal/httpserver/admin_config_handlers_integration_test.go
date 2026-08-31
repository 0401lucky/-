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
	"strings"
	"testing"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"
	"redemption/backend/internal/systemconfig"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 提交给 handler 的 9 个取值。刻意做到两两互不相等，且都与迁移默认值不同：
// handler 是按 values[] 数组下标把 9 个值装进 UpdateInput 的，下标错位不会编译失败
// 也不会越界，只会把某个字段的值静默写进另一个字段。取值互不相等时，
// 任何一处错位都会让下面逐字段的断言变红。
const (
	adminConfigWantDailyPointsLimit          = int64(12345)
	adminConfigWantDailyWithdrawLimit        = int64(7)
	adminConfigWantVIPDailyWithdrawLimit     = int64(11)
	adminConfigWantVIPPricePoints            = int64(4567)
	adminConfigWantVIPDurationDays           = int64(45)
	adminConfigWantVIPWithdrawFeePercent     = int64(33)
	adminConfigWantVIPDailyLotterySpins      = int64(6)
	adminConfigWantVIPMaxTotalDays           = int64(730)
	adminConfigWantWithdrawBalanceCapDollars = int64(98765)
)

// adminConfigUpdatePayload 每个字段都是指针：这些 key 是 json tag 里的字符串字面量，
// 编译器不校验；值类型解码时拼错的 key 会静默留下零值，断言反而抓不到。
type adminConfigUpdatePayload struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Config  struct {
		DailyPointsLimit          *int64  `json:"dailyPointsLimit"`
		DailyWithdrawLimit        *int64  `json:"dailyWithdrawLimit"`
		VIPDailyWithdrawLimit     *int64  `json:"vipDailyWithdrawLimit"`
		VIPPricePoints            *int64  `json:"vipPricePoints"`
		VIPDurationDays           *int64  `json:"vipDurationDays"`
		VIPWithdrawFeePercent     *int64  `json:"vipWithdrawFeePercent"`
		VIPDailyLotterySpins      *int64  `json:"vipDailyLotterySpins"`
		VIPMaxTotalDays           *int64  `json:"vipMaxTotalDays"`
		WithdrawBalanceCapDollars *int64  `json:"withdrawBalanceCapDollars"`
		UpdatedBy                 *string `json:"updatedBy"`
	} `json:"config"`
}

// TestAdminConfigUpdatePersistsAllNineFields 验证全量提交时 9 个字段各自落到正确的列，
// 顺带覆盖漏字段与跨字段冲突两条 400 路径（计划 Task 10 Step 4 的三种情况）。
func TestAdminConfigUpdatePersistsAllNineFields(t *testing.T) {
	ctx := context.Background()
	db, done := openAdminConfigHTTPDatabase(t, ctx)
	defer done()
	defer restoreAdminConfigHTTPRow(t, ctx, db)

	handler := New(adminConfigHTTPDependencies(db))

	// 情况一：全量提交应成功，且 9 个字段逐一等于提交值
	response := performRequest(handler, adminConfigHTTPPut(`{
		"dailyPointsLimit":12345,
		"dailyWithdrawLimit":7,
		"vipDailyWithdrawLimit":11,
		"vipPricePoints":4567,
		"vipDurationDays":45,
		"vipWithdrawFeePercent":33,
		"vipDailyLotterySpins":6,
		"vipMaxTotalDays":730,
		"withdrawBalanceCapDollars":98765
	}`))
	if response.Code != http.StatusOK {
		t.Fatalf("expected config update 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload adminConfigUpdatePayload
	body := decodeAdminConfigHTTPJSON(t, response, &payload)
	if !payload.Success || payload.Message != "配置已更新" {
		t.Fatalf("unexpected update envelope: %+v body=%s", payload, body)
	}

	for name, field := range map[string]struct {
		actual *int64
		want   int64
	}{
		"dailyPointsLimit":          {payload.Config.DailyPointsLimit, adminConfigWantDailyPointsLimit},
		"dailyWithdrawLimit":        {payload.Config.DailyWithdrawLimit, adminConfigWantDailyWithdrawLimit},
		"vipDailyWithdrawLimit":     {payload.Config.VIPDailyWithdrawLimit, adminConfigWantVIPDailyWithdrawLimit},
		"vipPricePoints":            {payload.Config.VIPPricePoints, adminConfigWantVIPPricePoints},
		"vipDurationDays":           {payload.Config.VIPDurationDays, adminConfigWantVIPDurationDays},
		"vipWithdrawFeePercent":     {payload.Config.VIPWithdrawFeePercent, adminConfigWantVIPWithdrawFeePercent},
		"vipDailyLotterySpins":      {payload.Config.VIPDailyLotterySpins, adminConfigWantVIPDailyLotterySpins},
		"vipMaxTotalDays":           {payload.Config.VIPMaxTotalDays, adminConfigWantVIPMaxTotalDays},
		"withdrawBalanceCapDollars": {payload.Config.WithdrawBalanceCapDollars, adminConfigWantWithdrawBalanceCapDollars},
	} {
		if field.actual == nil {
			t.Fatalf("响应缺少字段 %s，响应体=%s", name, body)
		}
		if *field.actual != field.want {
			t.Fatalf("字段 %s 串值：got %d want %d，响应体=%s", name, *field.actual, field.want, body)
		}
	}
	if payload.Config.UpdatedBy == nil || *payload.Config.UpdatedBy != "admin" {
		t.Fatalf("expected updatedBy=admin, got %v body=%s", payload.Config.UpdatedBy, body)
	}

	// 直接读列，确认不是只在响应里对上而列写错了位置
	assertAdminConfigHTTPColumns(t, ctx, db)

	// 情况二：漏一个字段应 400，而不是把它静默重置成默认值
	partial := performRequest(handler, adminConfigHTTPPut(`{"dailyPointsLimit":5000}`))
	if partial.Code != http.StatusBadRequest || !strings.Contains(partial.Body.String(), "普通用户每日提现次数必须在 1 - 100 之间") {
		t.Fatalf("expected partial submit 400, got %d body=%s", partial.Code, partial.Body.String())
	}
	// 被拒的请求不能落库：列应仍是情况一写入的值
	assertAdminConfigHTTPColumns(t, ctx, db)

	// 情况三：跨字段冲突应 400（两个字段各自都在合法区间内）
	conflict := performRequest(handler, adminConfigHTTPPut(`{
		"dailyPointsLimit":5000,
		"dailyWithdrawLimit":4,
		"vipDailyWithdrawLimit":8,
		"vipPricePoints":3000,
		"vipDurationDays":30,
		"vipWithdrawFeePercent":50,
		"vipDailyLotterySpins":2,
		"vipMaxTotalDays":20,
		"withdrawBalanceCapDollars":98765
	}`))
	if conflict.Code != http.StatusBadRequest || !strings.Contains(conflict.Body.String(), "VIP 累计时长上限不能小于月卡时长") {
		t.Fatalf("expected cross-field conflict 400, got %d body=%s", conflict.Code, conflict.Body.String())
	}
	assertAdminConfigHTTPColumns(t, ctx, db)
}

// assertAdminConfigHTTPColumns 按列名逐个读回，确认每个值落在正确的列上。
func assertAdminConfigHTTPColumns(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	var (
		dailyPointsLimit          int64
		dailyWithdrawLimit        int64
		vipDailyWithdrawLimit     int64
		vipPricePoints            int64
		vipDurationDays           int64
		vipWithdrawFeePercent     int64
		vipDailyLotterySpins      int64
		vipMaxTotalDays           int64
		withdrawBalanceCapDollars int64
	)
	if err := db.QueryRow(ctx,
		`SELECT daily_points_limit, daily_withdraw_limit, vip_daily_withdraw_limit,
		        vip_price_points, vip_duration_days, vip_withdraw_fee_percent,
		        vip_daily_lottery_spins, vip_max_total_days, withdraw_balance_cap_dollars
		   FROM system_config WHERE id = 'system'`,
	).Scan(
		&dailyPointsLimit, &dailyWithdrawLimit, &vipDailyWithdrawLimit,
		&vipPricePoints, &vipDurationDays, &vipWithdrawFeePercent,
		&vipDailyLotterySpins, &vipMaxTotalDays, &withdrawBalanceCapDollars,
	); err != nil {
		t.Fatalf("read back system_config failed: %v", err)
	}
	for name, field := range map[string]struct {
		actual int64
		want   int64
	}{
		"daily_points_limit":           {dailyPointsLimit, adminConfigWantDailyPointsLimit},
		"daily_withdraw_limit":         {dailyWithdrawLimit, adminConfigWantDailyWithdrawLimit},
		"vip_daily_withdraw_limit":     {vipDailyWithdrawLimit, adminConfigWantVIPDailyWithdrawLimit},
		"vip_price_points":             {vipPricePoints, adminConfigWantVIPPricePoints},
		"vip_duration_days":            {vipDurationDays, adminConfigWantVIPDurationDays},
		"vip_withdraw_fee_percent":     {vipWithdrawFeePercent, adminConfigWantVIPWithdrawFeePercent},
		"vip_daily_lottery_spins":      {vipDailyLotterySpins, adminConfigWantVIPDailyLotterySpins},
		"vip_max_total_days":           {vipMaxTotalDays, adminConfigWantVIPMaxTotalDays},
		"withdraw_balance_cap_dollars": {withdrawBalanceCapDollars, adminConfigWantWithdrawBalanceCapDollars},
	} {
		if field.actual != field.want {
			t.Fatalf("列 %s 的值不对：got %d want %d", name, field.actual, field.want)
		}
	}
}

// restoreAdminConfigHTTPRow 把 system_config 这一行恢复成迁移默认值。
// system_config 是单行表，本用例又必然改写全部列；app_test 是共享测试库，
// 不恢复会让同库的其它用例（如 luckytd 对账读 daily_points_limit、
// systemconfig 包断言 updated_at_ms/updated_by）以「值不对」的形式变红。
func restoreAdminConfigHTTPRow(t *testing.T, ctx context.Context, db *pgxpool.Pool) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`UPDATE system_config
		    SET daily_points_limit       = $1,
		        daily_withdraw_limit     = $2,
		        vip_daily_withdraw_limit = $3,
		        vip_price_points         = $4,
		        vip_duration_days        = $5,
		        vip_withdraw_fee_percent = $6,
		        vip_daily_lottery_spins  = $7,
		        vip_max_total_days       = $8,
		        withdraw_balance_cap_dollars = $9,
		        updated_at_ms            = 1,
		        updated_by               = NULL,
		        updated_at               = now()
		  WHERE id = 'system'`,
		systemconfig.DefaultDailyPointsLimit,
		systemconfig.DefaultDailyWithdrawLimit,
		systemconfig.DefaultVIPDailyWithdrawLimit,
		systemconfig.DefaultVIPPricePoints,
		systemconfig.DefaultVIPDurationDays,
		systemconfig.DefaultVIPWithdrawFeePercent,
		systemconfig.DefaultVIPDailyLotterySpins,
		systemconfig.DefaultVIPMaxTotalDays,
		systemconfig.DefaultWithdrawBalanceCapDollars,
	); err != nil {
		t.Fatalf("restore system config failed: %v", err)
	}
}

func openAdminConfigHTTPDatabase(t *testing.T, ctx context.Context) (*pgxpool.Pool, func()) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过后台配置 HTTP 集成测试")
	}
	db, err := dbpostgres.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open postgres failed: %v", err)
	}
	if _, err := pgmigration.NewRunner(db, httpMigrationsDir(t)).Apply(ctx, false); err != nil {
		db.Close()
		t.Fatalf("apply migrations failed: %v", err)
	}
	return db, db.Close
}

func adminConfigHTTPDependencies(db *pgxpool.Pool) Dependencies {
	resetInMemoryRateLimitsForTest()
	return Dependencies{
		Config: config.Config{
			SessionSecret:  testSessionSecret,
			AdminUsernames: map[string]struct{}{"admin": {}},
		},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
	}
}

func adminConfigHTTPPut(body string) *http.Request {
	request := httptest.NewRequest(http.MethodPut, "/api/admin/config", strings.NewReader(body))
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(testSessionCookieFor(1, "admin", "Admin"))
	return request
}

// decodeAdminConfigHTTPJSON 先把响应体取成字符串再解码，并把它交还给调用方：
// json.Decoder 会读空 ResponseRecorder 的缓冲区，断言失败时反而看不到响应体。
func decodeAdminConfigHTTPJSON(t *testing.T, response *httptest.ResponseRecorder, target any) string {
	t.Helper()
	body := response.Body.String()
	if err := json.Unmarshal([]byte(body), target); err != nil {
		t.Fatalf("decode response failed: %v body=%s", err, body)
	}
	return body
}
