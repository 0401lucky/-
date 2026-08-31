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
	"strconv"
	"strings"
	"testing"
	"time"

	"redemption/backend/internal/config"
	pgmigration "redemption/backend/internal/migration/postgres"
	dbpostgres "redemption/backend/internal/platform/postgres"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// walletOverviewPayload 刻意把每个字段都写成指针：这些 key 是 handler / 服务层
// json tag 里的字符串字面量，编译器不校验；值类型解码时拼错的 key 会静默留下零值，
// 断言反而抓不到。
type walletOverviewPayload struct {
	Success bool `json:"success"`
	Data    struct {
		Balance           *int64 `json:"balance"`
		PointsPerDollar   *int64 `json:"pointsPerDollar"`
		MinWithdrawPoints *int64 `json:"minWithdrawPoints"`
		MinTopupDollars   *int64 `json:"minTopupDollars"`
		FeePercent        *int64 `json:"feePercent"`
		DailyWithdraw     struct {
			Used      *int64 `json:"used"`
			Limit     *int64 `json:"limit"`
			Remaining *int64 `json:"remaining"`
			ResetAtMs *int64 `json:"resetAtMs"`
		} `json:"dailyWithdraw"`
		VIP struct {
			Active                bool    `json:"active"`
			ExpiresAt             *int64  `json:"expiresAt"`
			PricePoints           *int64  `json:"pricePoints"`
			DurationDays          *int64  `json:"durationDays"`
			MaxTotalDays          *int64  `json:"maxTotalDays"`
			CanPurchase           *bool   `json:"canPurchase"`
			PurchaseBlockedReason *string `json:"purchaseBlockedReason"`
			Benefits              struct {
				DailyWithdrawLimit *int64 `json:"dailyWithdrawLimit"`
				WithdrawFeePercent *int64 `json:"withdrawFeePercent"`
				DailyLotterySpins  *int64 `json:"dailyLotterySpins"`
			} `json:"benefits"`
		} `json:"vip"`
	} `json:"data"`
}

func TestWalletOverviewHandlerReturnsFullShape(t *testing.T) {
	ctx := context.Background()
	db, done := openWalletHTTPDatabase(t, ctx)
	defer done()

	userID := int64(99901 + time.Now().UnixNano()%1_000_000_000)
	cleanupWalletHTTPUser(t, ctx, db, userID)
	defer cleanupWalletHTTPUser(t, ctx, db, userID)
	seedWalletHTTPUser(t, ctx, db, userID, 5000)

	handler := New(walletHTTPDependencies(db, nil, config.Config{SessionSecret: testSessionSecret}))

	anonymous := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/wallet", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous wallet 401, got %d body=%s", anonymous.Code, anonymous.Body.String())
	}

	response := performRequest(handler, walletHTTPGet("/api/wallet", userID))
	if response.Code != http.StatusOK {
		t.Fatalf("expected wallet 200, got %d body=%s", response.Code, response.Body.String())
	}
	var payload walletOverviewPayload
	body := decodeWalletHTTPJSON(t, response, &payload)
	if !payload.Success {
		t.Fatalf("expected success wallet overview, got %+v", payload)
	}
	for name, actual := range map[string]*int64{
		"balance":                         payload.Data.Balance,
		"pointsPerDollar":                 payload.Data.PointsPerDollar,
		"minWithdrawPoints":               payload.Data.MinWithdrawPoints,
		"minTopupDollars":                 payload.Data.MinTopupDollars,
		"feePercent":                      payload.Data.FeePercent,
		"dailyWithdraw.used":              payload.Data.DailyWithdraw.Used,
		"dailyWithdraw.limit":             payload.Data.DailyWithdraw.Limit,
		"dailyWithdraw.remaining":         payload.Data.DailyWithdraw.Remaining,
		"dailyWithdraw.resetAtMs":         payload.Data.DailyWithdraw.ResetAtMs,
		"vip.pricePoints":                 payload.Data.VIP.PricePoints,
		"vip.durationDays":                payload.Data.VIP.DurationDays,
		"vip.maxTotalDays":                payload.Data.VIP.MaxTotalDays,
		"vip.benefits.dailyWithdrawLimit": payload.Data.VIP.Benefits.DailyWithdrawLimit,
		"vip.benefits.withdrawFeePercent": payload.Data.VIP.Benefits.WithdrawFeePercent,
		"vip.benefits.dailyLotterySpins":  payload.Data.VIP.Benefits.DailyLotterySpins,
	} {
		if actual == nil {
			t.Fatalf("wallet overview 缺少字段 %s，响应体=%s", name, body)
		}
	}
	if payload.Data.VIP.CanPurchase == nil {
		t.Fatalf("wallet overview 缺少字段 vip.canPurchase")
	}

	if *payload.Data.Balance != 5000 || *payload.Data.FeePercent != 100 {
		t.Fatalf("unexpected balance/feePercent: %d/%d", *payload.Data.Balance, *payload.Data.FeePercent)
	}
	if *payload.Data.DailyWithdraw.Used != 0 || *payload.Data.DailyWithdraw.Limit != 4 || *payload.Data.DailyWithdraw.Remaining != 4 {
		t.Fatalf("unexpected dailyWithdraw: %+v", payload.Data.DailyWithdraw)
	}
	if *payload.Data.DailyWithdraw.ResetAtMs <= time.Now().UnixMilli() {
		t.Fatalf("resetAtMs 应晚于当前时间，got %d", *payload.Data.DailyWithdraw.ResetAtMs)
	}
	// 从未购买过 VIP：active=false 且 expiresAt 键省略
	if payload.Data.VIP.Active || payload.Data.VIP.ExpiresAt != nil {
		t.Fatalf("unexpected vip state: %+v", payload.Data.VIP)
	}
	if !*payload.Data.VIP.CanPurchase || payload.Data.VIP.PurchaseBlockedReason != nil {
		t.Fatalf("非 VIP 用户应可购买且无阻断原因: %+v", payload.Data.VIP)
	}
	if *payload.Data.VIP.PricePoints != 3000 || *payload.Data.VIP.DurationDays != 30 || *payload.Data.VIP.MaxTotalDays != 365 {
		t.Fatalf("unexpected vip config: %+v", payload.Data.VIP)
	}
	if *payload.Data.VIP.Benefits.DailyWithdrawLimit != 8 ||
		*payload.Data.VIP.Benefits.WithdrawFeePercent != 50 ||
		*payload.Data.VIP.Benefits.DailyLotterySpins != 2 {
		t.Fatalf("unexpected vip benefits: %+v", payload.Data.VIP.Benefits)
	}
}

func TestWalletTransactionsHandlerPaginatesAndClampsQuery(t *testing.T) {
	ctx := context.Background()
	db, done := openWalletHTTPDatabase(t, ctx)
	defer done()

	userID := int64(99911 + time.Now().UnixNano()%1_000_000_000)
	cleanupWalletHTTPUser(t, ctx, db, userID)
	defer cleanupWalletHTTPUser(t, ctx, db, userID)
	seedWalletHTTPUser(t, ctx, db, userID, 0)
	for index := 0; index < 3; index++ {
		seedWalletHTTPTransaction(t, ctx, db, userID, index)
	}

	handler := New(walletHTTPDependencies(db, nil, config.Config{SessionSecret: testSessionSecret}))

	anonymous := performRequest(handler, httptest.NewRequest(http.MethodGet, "/api/wallet/transactions", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("expected anonymous transactions 401, got %d body=%s", anonymous.Code, anonymous.Body.String())
	}

	firstPage := decodeWalletTransactionsPage(t, handler, "/api/wallet/transactions?limit=2&offset=0", userID)
	if !firstPage.Success || *firstPage.Data.Total != 3 || len(firstPage.Data.Transactions) != 2 {
		t.Fatalf("unexpected first page: success=%v %s", firstPage.Success, firstPage.pagingString())
	}
	if *firstPage.Data.Limit != 2 || *firstPage.Data.Offset != 0 || !*firstPage.Data.HasMore {
		t.Fatalf("unexpected first page paging: %s", firstPage.pagingString())
	}
	// 倒序返回，最新的 seed-2 在最前
	if firstPage.Data.Transactions[0].Message != "wallet http seed 2" {
		t.Fatalf("expected newest transaction first, got %+v", firstPage.Data.Transactions)
	}
	if firstPage.Data.Transactions[0].Operation != "withdraw" ||
		firstPage.Data.Transactions[0].Status != "success" ||
		firstPage.Data.Transactions[0].PointsDelta == nil ||
		*firstPage.Data.Transactions[0].PointsDelta != -100 ||
		firstPage.Data.Transactions[0].FeePoints == nil ||
		*firstPage.Data.Transactions[0].FeePoints != 50 {
		t.Fatalf("unexpected transaction shape: %+v", firstPage.Data.Transactions[0])
	}

	lastPage := decodeWalletTransactionsPage(t, handler, "/api/wallet/transactions?limit=2&offset=2", userID)
	if len(lastPage.Data.Transactions) != 1 || *lastPage.Data.Offset != 2 || *lastPage.Data.HasMore {
		t.Fatalf("unexpected last page: %s", lastPage.pagingString())
	}

	// limit 超上限夹到 100；offset 为负与 limit 非法都回落到默认值
	clamped := decodeWalletTransactionsPage(t, handler, "/api/wallet/transactions?limit=500&offset=-5", userID)
	if *clamped.Data.Limit != 100 || *clamped.Data.Offset != 0 || len(clamped.Data.Transactions) != 3 {
		t.Fatalf("unexpected clamped page: %s", clamped.pagingString())
	}
	fallback := decodeWalletTransactionsPage(t, handler, "/api/wallet/transactions?limit=abc", userID)
	if *fallback.Data.Limit != 20 || *fallback.Data.Offset != 0 {
		t.Fatalf("unexpected fallback page: %s", fallback.pagingString())
	}
}

func TestPurchaseVIPHandlerRequiresIdempotencyKeyAndReplaysSameResult(t *testing.T) {
	ctx := context.Background()
	db, done := openWalletHTTPDatabase(t, ctx)
	defer done()

	userID := int64(99921 + time.Now().UnixNano()%1_000_000_000)
	cleanupWalletHTTPUser(t, ctx, db, userID)
	defer cleanupWalletHTTPUser(t, ctx, db, userID)
	seedWalletHTTPUser(t, ctx, db, userID, 0)

	handler := New(walletHTTPDependencies(db, nil, config.Config{SessionSecret: testSessionSecret}))

	// 缺少幂等键必须被拒：beginIdempotency 遇到空 key 会直接放行，
	// 重试就会重复扣掉一整个周期的积分。
	missingKey := performRequest(handler, walletHTTPPost("/api/vip/purchase", userID, `{}`, ""))
	if missingKey.Code != http.StatusBadRequest {
		t.Fatalf("expected missing idempotency key 400, got %d body=%s", missingKey.Code, missingKey.Body.String())
	}
	var missingPayload struct {
		Success bool   `json:"success"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	decodeWalletHTTPJSON(t, missingKey, &missingPayload)
	if missingPayload.Success || missingPayload.Code != "IDEMPOTENCY_KEY_REQUIRED" || missingPayload.Message == "" {
		t.Fatalf("unexpected missing key payload: %+v", missingPayload)
	}
	// 只有空白字符也算缺失
	blankKey := performRequest(handler, walletHTTPPost("/api/vip/purchase", userID, `{"idempotencyKey":"   "}`, "  "))
	if blankKey.Code != http.StatusBadRequest || !strings.Contains(blankKey.Body.String(), "IDEMPOTENCY_KEY_REQUIRED") {
		t.Fatalf("expected blank idempotency key 400, got %d body=%s", blankKey.Code, blankKey.Body.String())
	}

	// 余额不足是业务失败：400 而不是 500，且带上 code
	poor := performRequest(handler, walletHTTPPost("/api/vip/purchase", userID, "", "vip-http-poor"))
	if poor.Code != http.StatusBadRequest {
		t.Fatalf("expected insufficient points 400, got %d body=%s", poor.Code, poor.Body.String())
	}
	poorPayload, _ := decodePurchaseVIPPayload(t, poor)
	if poorPayload.Success || poorPayload.Code != "INSUFFICIENT_POINTS" {
		t.Fatalf("unexpected insufficient points payload: %+v", poorPayload)
	}

	if _, err := db.Exec(ctx, `UPDATE point_accounts SET balance = 3000 WHERE user_id = $1`, userID); err != nil {
		t.Fatalf("top up points failed: %v", err)
	}

	first := performRequest(handler, walletHTTPPost("/api/vip/purchase", userID, "", "vip-http-1"))
	if first.Code != http.StatusOK {
		t.Fatalf("expected purchase 200, got %d body=%s", first.Code, first.Body.String())
	}
	firstPayload, firstBody := decodePurchaseVIPPayload(t, first)
	if !firstPayload.Success || firstPayload.Code != "" || firstPayload.Message == "" {
		t.Fatalf("unexpected purchase payload: %+v", firstPayload)
	}
	for name, actual := range map[string]*int64{
		"newBalance":  firstPayload.Data.NewBalance,
		"expiresAt":   firstPayload.Data.ExpiresAt,
		"daysAdded":   firstPayload.Data.DaysAdded,
		"pointsSpent": firstPayload.Data.PointsSpent,
	} {
		if actual == nil {
			t.Fatalf("purchase 响应缺少字段 data.%s，响应体=%s", name, firstBody)
		}
	}
	if *firstPayload.Data.NewBalance != 0 || *firstPayload.Data.DaysAdded != 30 || *firstPayload.Data.PointsSpent != 3000 {
		t.Fatalf("unexpected purchase data: %+v", firstPayload.Data)
	}
	if *firstPayload.Data.ExpiresAt <= time.Now().UnixMilli() {
		t.Fatalf("expiresAt 应晚于当前时间，got %d", *firstPayload.Data.ExpiresAt)
	}

	// 同一幂等键重放：回放原结果，不再扣分
	replay := performRequest(handler, walletHTTPPost("/api/vip/purchase", userID, "", "vip-http-1"))
	if replay.Code != http.StatusOK {
		t.Fatalf("expected replay 200, got %d body=%s", replay.Code, replay.Body.String())
	}
	replayPayload, _ := decodePurchaseVIPPayload(t, replay)
	if !replayPayload.Success || *replayPayload.Data.NewBalance != 0 ||
		replayPayload.Data.ExpiresAt == nil || *replayPayload.Data.ExpiresAt != *firstPayload.Data.ExpiresAt {
		t.Fatalf("replay 应回放原结果: %+v", replayPayload)
	}

	var balance, purchaseCount, ledgerCount int64
	if err := db.QueryRow(ctx,
		`SELECT p.balance,
		        (SELECT COUNT(*) FROM vip_purchases WHERE user_id = $1),
		        (SELECT COUNT(*) FROM point_ledger WHERE user_id = $1 AND source = 'vip_purchase')
		   FROM point_accounts p
		  WHERE p.user_id = $1`,
		userID,
	).Scan(&balance, &purchaseCount, &ledgerCount); err != nil {
		t.Fatalf("query purchase db facts failed: %v", err)
	}
	if balance != 0 || purchaseCount != 1 || ledgerCount != 1 {
		t.Fatalf("unexpected purchase db facts balance=%d purchases=%d ledger=%d", balance, purchaseCount, ledgerCount)
	}

	// 购买后钱包概览应反映 VIP 生效
	overview := performRequest(handler, walletHTTPGet("/api/wallet", userID))
	var overviewPayload walletOverviewPayload
	overviewBody := decodeWalletHTTPJSON(t, overview, &overviewPayload)
	if !overviewPayload.Data.VIP.Active || overviewPayload.Data.VIP.ExpiresAt == nil ||
		overviewPayload.Data.FeePercent == nil || *overviewPayload.Data.FeePercent != 50 ||
		overviewPayload.Data.DailyWithdraw.Limit == nil || *overviewPayload.Data.DailyWithdraw.Limit != 8 {
		t.Fatalf("购买后概览未反映 VIP，响应体=%s", overviewBody)
	}
}

func TestPurchaseVIPHandlerRejectsCrossSiteOrigin(t *testing.T) {
	ctx := context.Background()
	db, done := openWalletHTTPDatabase(t, ctx)
	defer done()

	userID := int64(99931 + time.Now().UnixNano()%1_000_000_000)
	cleanupWalletHTTPUser(t, ctx, db, userID)
	defer cleanupWalletHTTPUser(t, ctx, db, userID)
	seedWalletHTTPUser(t, ctx, db, userID, 3000)

	handler := New(walletHTTPDependencies(db, nil, config.Config{SessionSecret: testSessionSecret}))

	request := walletHTTPPost("/api/vip/purchase", userID, `{}`, "vip-http-evil")
	request.Header.Set("Origin", "https://evil.example")
	response := performRequest(handler, request)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "请求来源不合法") {
		t.Fatalf("expected cross-site purchase rejected, got %d body=%s", response.Code, response.Body.String())
	}

	var purchaseCount int64
	if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM vip_purchases WHERE user_id = $1`, userID).Scan(&purchaseCount); err != nil {
		t.Fatalf("query vip_purchases failed: %v", err)
	}
	if purchaseCount != 0 {
		t.Fatalf("跨站请求不应产生购买记录，got %d", purchaseCount)
	}
}

// TestWithdrawHandlerReturnsDailyLimitFields 覆盖 withdrawWallet 响应体新增的
// code / dailyWithdrawUsed / dailyWithdrawLimit 三个 key。
//
// 走「今日次数已用完」这条分支：它在 executeWithdrawInner 里早于任何 new-api 调用返回，
// 因此 new-api 只需配置到能让 newWalletQuotaClient 返回非 nil（否则接口先 503），
// 桩地址永远不会被真正请求。钱包操作锁需要真实 Redis。
func TestWithdrawHandlerReturnsDailyLimitFields(t *testing.T) {
	redisURL := os.Getenv("TEST_REDIS_URL")
	if redisURL == "" {
		t.Skip("TEST_REDIS_URL 未设置，跳过提现响应体集成测试")
	}
	redisOptions, err := redis.ParseURL(redisURL)
	if err != nil {
		t.Fatalf("parse redis url failed: %v", err)
	}
	redisClient := redis.NewClient(redisOptions)
	defer redisClient.Close()

	ctx := context.Background()
	db, done := openWalletHTTPDatabase(t, ctx)
	defer done()

	userID := int64(99941 + time.Now().UnixNano()%1_000_000_000)
	cleanupWalletHTTPUser(t, ctx, db, userID)
	defer cleanupWalletHTTPUser(t, ctx, db, userID)
	seedWalletHTTPUser(t, ctx, db, userID, 5000)
	if _, err := db.Exec(ctx,
		`INSERT INTO wallet_daily_withdrawals (user_id, withdraw_date, used_count)
		 VALUES ($1, $2, 4)`,
		userID, time.Now().UTC().Add(8*time.Hour).Format("2006-01-02"),
	); err != nil {
		t.Fatalf("seed daily withdrawals failed: %v", err)
	}

	handler := New(walletHTTPDependencies(db, redisClient, config.Config{
		SessionSecret:          testSessionSecret,
		NewAPIURL:              "http://127.0.0.1:1",
		NewAPIAdminAccessToken: "wallet-http-test-token",
		NewAPIAdminUserID:      "1",
	}))

	response := performRequest(handler, walletHTTPPost("/api/store/withdraw", userID, `{"points":100}`, ""))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected withdraw daily limit 400, got %d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Success   bool   `json:"success"`
		Message   string `json:"message"`
		Code      string `json:"code"`
		Uncertain bool   `json:"uncertain"`
		Data      struct {
			NewBalance         *int64 `json:"newBalance"`
			DailyWithdrawUsed  *int64 `json:"dailyWithdrawUsed"`
			DailyWithdrawLimit *int64 `json:"dailyWithdrawLimit"`
		} `json:"data"`
	}
	withdrawBody := decodeWalletHTTPJSON(t, response, &payload)
	if payload.Success || payload.Uncertain || payload.Code != "WITHDRAW_DAILY_LIMIT" {
		t.Fatalf("unexpected withdraw payload: %+v", payload)
	}
	if payload.Data.DailyWithdrawUsed == nil || payload.Data.DailyWithdrawLimit == nil {
		t.Fatalf("withdraw 响应缺少限次字段，响应体=%s", withdrawBody)
	}
	if *payload.Data.DailyWithdrawUsed != 4 || *payload.Data.DailyWithdrawLimit != 4 {
		t.Fatalf("unexpected withdraw limit fields: used=%d limit=%d",
			*payload.Data.DailyWithdrawUsed, *payload.Data.DailyWithdrawLimit)
	}
}

type walletTransactionsPage struct {
	Success bool `json:"success"`
	Data    struct {
		Transactions []struct {
			ID          string `json:"id"`
			Operation   string `json:"operation"`
			Status      string `json:"status"`
			Message     string `json:"message"`
			PointsDelta *int64 `json:"pointsDelta"`
			FeePoints   *int64 `json:"feePoints"`
			CreatedAt   *int64 `json:"createdAt"`
		} `json:"transactions"`
		Total   *int64 `json:"total"`
		Limit   *int64 `json:"limit"`
		Offset  *int64 `json:"offset"`
		HasMore *bool  `json:"hasMore"`
	} `json:"data"`
}

// pagingString 把分页字段解引用后打印：直接 %+v 打印的是指针地址，断言失败时看不出实际值。
func (page walletTransactionsPage) pagingString() string {
	return fmt.Sprintf("total=%d limit=%d offset=%d hasMore=%v count=%d",
		*page.Data.Total, *page.Data.Limit, *page.Data.Offset, *page.Data.HasMore, len(page.Data.Transactions))
}

func decodeWalletTransactionsPage(t *testing.T, handler http.Handler, path string, userID int64) walletTransactionsPage {
	t.Helper()
	response := performRequest(handler, walletHTTPGet(path, userID))
	if response.Code != http.StatusOK {
		t.Fatalf("expected %s 200, got %d body=%s", path, response.Code, response.Body.String())
	}
	var page walletTransactionsPage
	body := decodeWalletHTTPJSON(t, response, &page)
	for name, actual := range map[string]*int64{"total": page.Data.Total, "limit": page.Data.Limit, "offset": page.Data.Offset} {
		if actual == nil {
			t.Fatalf("%s 响应缺少字段 data.%s，响应体=%s", path, name, body)
		}
	}
	if page.Data.HasMore == nil {
		t.Fatalf("%s 响应缺少字段 data.hasMore，响应体=%s", path, body)
	}
	return page
}

type purchaseVIPPayload struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Code    string `json:"code"`
	Data    struct {
		NewBalance  *int64 `json:"newBalance"`
		ExpiresAt   *int64 `json:"expiresAt"`
		DaysAdded   *int64 `json:"daysAdded"`
		PointsSpent *int64 `json:"pointsSpent"`
	} `json:"data"`
}

func decodePurchaseVIPPayload(t *testing.T, response *httptest.ResponseRecorder) (purchaseVIPPayload, string) {
	t.Helper()
	var payload purchaseVIPPayload
	return payload, decodeWalletHTTPJSON(t, response, &payload)
}

// decodeWalletHTTPJSON 先把响应体取成字符串再解码，并把它交还给调用方：
// json.Decoder 会读空 ResponseRecorder 的缓冲区，解码后再调 Body.String()
// 只会得到空串，断言失败时反而看不到响应体。
func decodeWalletHTTPJSON(t *testing.T, response *httptest.ResponseRecorder, target any) string {
	t.Helper()
	body := response.Body.String()
	if err := json.Unmarshal([]byte(body), target); err != nil {
		t.Fatalf("decode response failed: %v body=%s", err, body)
	}
	return body
}

func openWalletHTTPDatabase(t *testing.T, ctx context.Context) (*pgxpool.Pool, func()) {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL 未设置，跳过钱包 HTTP 集成测试")
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

func walletHTTPDependencies(db *pgxpool.Pool, redisClient *redis.Client, cfg config.Config) Dependencies {
	resetInMemoryRateLimitsForTest()
	return Dependencies{
		Config: cfg,
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		DB:     db,
		Redis:  redisClient,
	}
}

func walletHTTPGet(path string, userID int64) *http.Request {
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.AddCookie(walletHTTPSessionCookie(userID))
	return request
}

func walletHTTPPost(path string, userID int64, body string, idempotencyKey string) *http.Request {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(http.MethodPost, path, reader)
	request.Host = "example.com"
	request.Header.Set("Origin", "http://example.com")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if idempotencyKey != "" {
		request.Header.Set("Idempotency-Key", idempotencyKey)
	}
	request.AddCookie(walletHTTPSessionCookie(userID))
	return request
}

func walletHTTPSessionCookie(userID int64) *http.Cookie {
	name := "wallet_http_" + strconv.FormatInt(userID, 10)
	return testSessionCookieFor(userID, name, name)
}

func seedWalletHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, balance int64) {
	t.Helper()
	name := "wallet_http_" + strconv.FormatInt(userID, 10)
	if _, err := db.Exec(ctx,
		`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
		 VALUES ($1, $2, $2, now(), now())`,
		userID, name,
	); err != nil {
		t.Fatalf("seed user failed: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO point_accounts (user_id, balance) VALUES ($1, $2)`, userID, balance); err != nil {
		t.Fatalf("seed point account failed: %v", err)
	}
}

func seedWalletHTTPTransaction(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64, index int) {
	t.Helper()
	if _, err := db.Exec(ctx,
		`INSERT INTO wallet_transactions
		   (id, user_id, operation, status, points_delta, dollars_delta,
		    requested_points, fee_points, net_points, message, created_at, updated_at)
		 VALUES ($1, $2, 'withdraw', 'success', -100, 0.50, 100, 50, 50, $3, now() + ($4 || ' seconds')::interval, now())`,
		"wallet_http_tx_"+strconv.FormatInt(userID, 10)+"_"+strconv.Itoa(index),
		userID,
		"wallet http seed "+strconv.Itoa(index),
		strconv.Itoa(index),
	); err != nil {
		t.Fatalf("seed wallet transaction %d failed: %v", index, err)
	}
}

func cleanupWalletHTTPUser(t *testing.T, ctx context.Context, db *pgxpool.Pool, userID int64) {
	t.Helper()
	_, _ = db.Exec(ctx, `DELETE FROM idempotency_keys WHERE scope = $1`, "vip:purchase:"+strconv.FormatInt(userID, 10))
	_, _ = db.Exec(ctx, `DELETE FROM point_ledger WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM vip_purchases WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM vip_memberships WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM wallet_transactions WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM wallet_daily_withdrawals WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM point_accounts WHERE user_id = $1`, userID)
	_, _ = db.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}
