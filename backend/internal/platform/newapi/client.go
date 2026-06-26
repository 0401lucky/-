package newapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const QuotaPerDollar = int64(500000)

type Client struct {
	baseURL          string
	adminAccessToken string
	adminUserID      string
	httpClient       *http.Client
}

type Options struct {
	BaseURL          string
	AdminAccessToken string
	AdminUserID      string
	HTTPClient       *http.Client
}

type QuotaBalance struct {
	Quota               int64   `json:"quota"`
	UsedQuota           int64   `json:"usedQuota"`
	BalanceDollars      float64 `json:"balanceDollars"`
	BalanceWholeDollars int64   `json:"balanceWholeDollars"`
}

type QuotaResult struct {
	Success                bool
	Message                string
	NewQuota               int64
	NewBalanceDollars      float64
	NewBalanceWholeDollars int64
	Uncertain              bool
}

type apiEnvelope struct {
	Success bool           `json:"success"`
	Message string         `json:"message"`
	Data    map[string]any `json:"data"`
}

func New(options Options) (*Client, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(options.BaseURL), "/")
	if baseURL == "" {
		return nil, errors.New("NEW_API_URL is not set")
	}
	if strings.TrimSpace(options.AdminAccessToken) == "" {
		return nil, errors.New("NEW_API_ADMIN_ACCESS_TOKEN is not set")
	}
	if strings.TrimSpace(options.AdminUserID) == "" {
		return nil, errors.New("NEW_API_ADMIN_USER_ID is not set")
	}
	if _, err := strconv.ParseInt(strings.TrimSpace(options.AdminUserID), 10, 64); err != nil {
		return nil, errors.New("NEW_API_ADMIN_USER_ID must be a numeric new-api user ID")
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	return &Client{
		baseURL:          baseURL,
		adminAccessToken: strings.TrimSpace(options.AdminAccessToken),
		adminUserID:      strings.TrimSpace(options.AdminUserID),
		httpClient:       httpClient,
	}, nil
}

func DollarsToQuota(dollars float64) int64 {
	if math.IsNaN(dollars) || math.IsInf(dollars, 0) {
		return 0
	}
	return int64(math.Floor(dollars * float64(QuotaPerDollar)))
}

func QuotaToDollars(quota int64) float64 {
	if quota < 0 {
		quota = 0
	}
	return math.Round((float64(quota)/float64(QuotaPerDollar))*100) / 100
}

func QuotaToWholeDollars(quota int64) int64 {
	if quota <= 0 {
		return 0
	}
	return quota / QuotaPerDollar
}

func (client *Client) GetQuotaBalance(ctx context.Context, userID int64) (QuotaBalance, error) {
	user, err := client.fetchUser(ctx, userID)
	if err != nil {
		return QuotaBalance{}, err
	}
	quota := readInt64(user["quota"])
	usedQuota := readInt64(user["used_quota"])
	return QuotaBalance{
		Quota:               quota,
		UsedQuota:           usedQuota,
		BalanceDollars:      QuotaToDollars(quota),
		BalanceWholeDollars: QuotaToWholeDollars(quota),
	}, nil
}

func (client *Client) CreditQuota(ctx context.Context, userID int64, dollars float64) (QuotaResult, error) {
	quotaToAdd := DollarsToQuota(dollars)
	if quotaToAdd <= 0 {
		return QuotaResult{Success: false, Message: "充值金额无效"}, nil
	}
	user, err := client.fetchUser(ctx, userID)
	if err != nil {
		return QuotaResult{}, err
	}
	currentQuota := readInt64(user["quota"])
	expectedQuota := currentQuota + quotaToAdd

	message, err := client.manageQuota(ctx, userID, "add", quotaToAdd)
	if err == nil {
		return quotaSuccess(fmt.Sprintf("成功充值 $%s", formatDollars(dollars)), expectedQuota), nil
	}
	verify := client.verifyQuotaUpdated(ctx, userID, expectedQuota, true)
	if verify.Success || verify.Uncertain {
		return verify, nil
	}
	if message != "" {
		verify.Message = message
	}
	return verify, nil
}

func (client *Client) DeductQuota(ctx context.Context, userID int64, dollars float64) (QuotaResult, error) {
	quotaToDeduct := DollarsToQuota(dollars)
	if quotaToDeduct <= 0 {
		return QuotaResult{Success: false, Message: "扣减金额无效"}, nil
	}
	user, err := client.fetchUser(ctx, userID)
	if err != nil {
		return QuotaResult{}, err
	}
	currentQuota := readInt64(user["quota"])
	if currentQuota < quotaToDeduct {
		return QuotaResult{
			Success:                false,
			Message:                fmt.Sprintf("账户额度不足，可用 $%.2f", QuotaToDollars(currentQuota)),
			NewQuota:               currentQuota,
			NewBalanceDollars:      QuotaToDollars(currentQuota),
			NewBalanceWholeDollars: QuotaToWholeDollars(currentQuota),
		}, nil
	}
	expectedQuota := currentQuota - quotaToDeduct

	message, err := client.manageQuota(ctx, userID, "subtract", quotaToDeduct)
	if err == nil {
		return quotaSuccess(fmt.Sprintf("成功扣减 $%s", formatDollars(dollars)), expectedQuota), nil
	}
	verify := client.verifyQuotaUpdated(ctx, userID, expectedQuota, false)
	if verify.Success || verify.Uncertain {
		return verify, nil
	}
	if message != "" {
		verify.Message = message
	}
	return verify, nil
}

func (client *Client) fetchUser(ctx context.Context, userID int64) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/api/user/%d", client.baseURL, userID), nil)
	if err != nil {
		return nil, err
	}
	client.setAuthHeaders(request)

	envelope, err := client.doJSON(request)
	if err != nil {
		return nil, err
	}
	if !envelope.Success || envelope.Data == nil {
		return nil, fmt.Errorf("%s", fallbackMessage(envelope.Message, "获取用户信息失败"))
	}
	return envelope.Data, nil
}

func (client *Client) manageQuota(ctx context.Context, userID int64, mode string, quota int64) (string, error) {
	payload := map[string]any{
		"id":     userID,
		"action": "add_quota",
		"mode":   mode,
		"value":  quota,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/api/user/manage", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	client.setAuthHeaders(request)
	request.Header.Set("Content-Type", "application/json")

	envelope, err := client.doJSON(request)
	if err != nil {
		return "", err
	}
	if !envelope.Success {
		return envelope.Message, fmt.Errorf("%s", fallbackMessage(envelope.Message, "额度更新失败"))
	}
	return envelope.Message, nil
}

func (client *Client) verifyQuotaUpdated(ctx context.Context, userID int64, expectedQuota int64, credit bool) QuotaResult {
	user, err := client.fetchUser(ctx, userID)
	if err != nil {
		return QuotaResult{Success: false, Message: "验证失败", Uncertain: true}
	}
	currentQuota := readInt64(user["quota"])
	ok := currentQuota >= expectedQuota
	message := "充值已确认成功"
	if !credit {
		ok = currentQuota <= expectedQuota
		message = "扣减已确认成功"
	}
	if ok {
		return quotaSuccess(message, currentQuota)
	}
	return QuotaResult{
		Success:                false,
		Message:                "额度更新确认失败",
		NewQuota:               currentQuota,
		NewBalanceDollars:      QuotaToDollars(currentQuota),
		NewBalanceWholeDollars: QuotaToWholeDollars(currentQuota),
	}
}

func (client *Client) doJSON(request *http.Request) (apiEnvelope, error) {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return apiEnvelope{}, err
	}
	defer response.Body.Close()

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return apiEnvelope{}, err
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return apiEnvelope{}, err
	}
	if response.StatusCode >= 500 {
		return envelope, fmt.Errorf("%s", fallbackMessage(envelope.Message, "new-api 服务错误"))
	}
	return envelope, nil
}

func (client *Client) setAuthHeaders(request *http.Request) {
	request.Header.Set("Authorization", client.adminAccessToken)
	request.Header.Set("New-Api-User", client.adminUserID)
}

func quotaSuccess(message string, quota int64) QuotaResult {
	return QuotaResult{
		Success:                true,
		Message:                message,
		NewQuota:               quota,
		NewBalanceDollars:      QuotaToDollars(quota),
		NewBalanceWholeDollars: QuotaToWholeDollars(quota),
	}
}

func readInt64(value any) int64 {
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0
		}
		return int64(math.Floor(typed))
	case json.Number:
		parsed, err := typed.Int64()
		if err == nil {
			return parsed
		}
	case string:
		parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err == nil {
			return parsed
		}
	case int64:
		return typed
	case int:
		return int64(typed)
	}
	return 0
}

func fallbackMessage(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func formatDollars(dollars float64) string {
	if dollars == math.Trunc(dollars) {
		return strconv.FormatInt(int64(dollars), 10)
	}
	return strconv.FormatFloat(dollars, 'f', 2, 64)
}
