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

var ErrAdminAuthFailed = errors.New("new-api admin authentication failed")

type Client struct {
	baseURL          string
	adminAccessToken string
	adminUserID      string
	adminUsername    string
	adminPassword    string
	httpClient       *http.Client
}

type Options struct {
	BaseURL          string
	AdminAccessToken string
	AdminUserID      string
	AdminUsername    string
	AdminPassword    string
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
	adminAccessToken := normalizeAdminAccessToken(options.AdminAccessToken)
	adminUserID := strings.TrimSpace(options.AdminUserID)
	adminUsername := strings.TrimSpace(options.AdminUsername)
	adminPassword := strings.TrimSpace(options.AdminPassword)
	hasAccessTokenAuth := adminAccessToken != "" && adminUserID != ""
	hasPasswordAuth := adminUsername != "" && adminPassword != ""
	if !hasAccessTokenAuth && !hasPasswordAuth {
		return nil, errors.New("NEW_API_ADMIN_ACCESS_TOKEN/NEW_API_ADMIN_USER_ID or NEW_API_ADMIN_USERNAME/NEW_API_ADMIN_PASSWORD is required")
	}
	if adminUserID != "" {
		if _, err := strconv.ParseInt(adminUserID, 10, 64); err != nil {
			return nil, errors.New("NEW_API_ADMIN_USER_ID must be a numeric new-api user ID")
		}
	}
	if adminAccessToken != "" && adminUserID == "" && !hasPasswordAuth {
		return nil, errors.New("NEW_API_ADMIN_USER_ID is required when NEW_API_ADMIN_ACCESS_TOKEN is set")
	}
	if adminUserID != "" && adminAccessToken == "" && !hasPasswordAuth {
		return nil, errors.New("NEW_API_ADMIN_ACCESS_TOKEN is required when NEW_API_ADMIN_USER_ID is set")
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 8 * time.Second}
	}
	return &Client{
		baseURL:          baseURL,
		adminAccessToken: adminAccessToken,
		adminUserID:      adminUserID,
		adminUsername:    adminUsername,
		adminPassword:    adminPassword,
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

	envelope, err := client.doJSONWithAdminAuthRetry(request)
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

	envelope, err := client.doJSONWithAdminAuthRetry(request)
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
	if isAdminAuthFailure(response.StatusCode, envelope) {
		return envelope, fmt.Errorf("%w: %s", ErrAdminAuthFailed, fallbackMessage(envelope.Message, "new-api 管理端鉴权失败"))
	}
	if response.StatusCode >= 500 {
		return envelope, fmt.Errorf("%s", fallbackMessage(envelope.Message, "new-api 服务错误"))
	}
	return envelope, nil
}

func (client *Client) doJSONWithAdminAuthRetry(request *http.Request) (apiEnvelope, error) {
	var envelope apiEnvelope
	var err error

	if client.adminAccessToken != "" {
		envelope, err = client.doJSON(request)
		if !errors.Is(err, ErrAdminAuthFailed) {
			return envelope, err
		}

		retry := client.cloneRequestForRetry(request)
		client.setLegacyAuthHeaders(retry)

		retryEnvelope, retryErr := client.doJSON(retry)
		if retryErr == nil || !errors.Is(retryErr, ErrAdminAuthFailed) {
			return retryEnvelope, retryErr
		}
	} else {
		envelope = apiEnvelope{}
		err = ErrAdminAuthFailed
	}

	if client.adminUsername == "" || client.adminPassword == "" {
		return envelope, err
	}

	sessionRequest, sessionErr := client.requestWithAdminSession(request)
	if sessionErr != nil {
		return envelope, sessionErr
	}
	sessionEnvelope, sessionRequestErr := client.doJSON(sessionRequest)
	if sessionRequestErr == nil || !errors.Is(sessionRequestErr, ErrAdminAuthFailed) {
		return sessionEnvelope, sessionRequestErr
	}
	return envelope, err
}

func (client *Client) cloneRequestForRetry(request *http.Request) *http.Request {
	retry := request.Clone(request.Context())
	if request.GetBody != nil {
		if body, err := request.GetBody(); err == nil {
			retry.Body = body
		}
	}
	retry.Header = request.Header.Clone()
	return retry
}

func (client *Client) requestWithAdminSession(request *http.Request) (*http.Request, error) {
	result, err := Login(request.Context(), client.baseURL, client.adminUsername, client.adminPassword, client.httpClient)
	if err != nil {
		return nil, fmt.Errorf("%w: 管理员账号登录 new-api 失败: %v", ErrAdminAuthFailed, err)
	}
	if !result.Success || result.User == nil || result.Cookies == "" {
		return nil, fmt.Errorf("%w: %s", ErrAdminAuthFailed, fallbackMessage(result.Message, "管理员账号登录 new-api 失败"))
	}
	loginAdminUserID := strconv.FormatInt(result.User.ID, 10)
	if client.adminUserID != "" && client.adminUserID != loginAdminUserID {
		return nil, fmt.Errorf("%w: NEW_API_ADMIN_USER_ID 与管理员账号登录用户不匹配", ErrAdminAuthFailed)
	}

	retry := client.cloneRequestForRetry(request)
	retry.Header.Del("Authorization")
	retry.Header.Set("Cookie", result.Cookies)
	retry.Header.Set("New-Api-User", loginAdminUserID)
	return retry, nil
}

func (client *Client) setAuthHeaders(request *http.Request) {
	if client.adminAccessToken != "" {
		request.Header.Set("Authorization", "Bearer "+client.adminAccessToken)
	}
	if client.adminUserID != "" {
		request.Header.Set("New-Api-User", client.adminUserID)
	}
}

func (client *Client) setLegacyAuthHeaders(request *http.Request) {
	if client.adminAccessToken != "" {
		request.Header.Set("Authorization", client.adminAccessToken)
	}
	if client.adminUserID != "" {
		request.Header.Set("New-Api-User", client.adminUserID)
	}
}

func normalizeAdminAccessToken(value string) string {
	token := strings.TrimSpace(value)
	token = strings.Trim(token, `"'`)
	if token == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(token), "authorization:") {
		token = strings.TrimSpace(token[len("authorization:"):])
	}
	if strings.HasPrefix(strings.ToLower(token), "bearer ") {
		token = strings.TrimSpace(token[len("bearer "):])
	}
	return strings.Trim(token, `"'`)
}

func isAdminAuthFailure(statusCode int, envelope apiEnvelope) bool {
	message := strings.ToLower(strings.TrimSpace(envelope.Message))
	if statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden {
		return true
	}
	if envelope.Success {
		return false
	}
	return strings.Contains(message, "access token") ||
		strings.Contains(message, "new-api-user") ||
		strings.Contains(message, "unauthorized") ||
		strings.Contains(message, "未提供 new-api-user") ||
		strings.Contains(message, "new-api-user 格式错误") ||
		strings.Contains(message, "new-api-user 与登录用户不匹配") ||
		strings.Contains(message, "access token 无效") ||
		strings.Contains(message, "无权进行此操作")
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
