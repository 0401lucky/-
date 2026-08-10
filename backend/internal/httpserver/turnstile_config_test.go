package httpserver

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/platform/newapi"

	"github.com/redis/go-redis/v9"
)

func TestTurnstileConfigEndpointReturnsPublicFieldsAndCachesStatus(t *testing.T) {
	var requests atomic.Int64
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		if request.Method != http.MethodGet || request.URL.Path != "/api/status" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":true,"turnstile_site_key":"0x-public","turnstile_secret_key":"must-not-leak","system_name":"upstream"}}`))
	}))
	defer newAPIServer.Close()

	handler := New(Dependencies{
		Config: config.Config{NewAPIURL: newAPIServer.URL},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})

	for range 2 {
		response := performJSONRequest(handler, http.MethodGet, "/api/auth/turnstile-config", "", false)
		if response.Code != http.StatusOK {
			t.Fatalf("expected config 200, got status=%d body=%s", response.Code, response.Body.String())
		}
		body := response.Body.String()
		if !strings.Contains(body, `"enabled":true`) || !strings.Contains(body, `"siteKey":"0x-public"`) {
			t.Fatalf("unexpected config response: %s", body)
		}
		if strings.Contains(body, "must-not-leak") || strings.Contains(body, "system_name") {
			t.Fatalf("upstream fields leaked in config response: %s", body)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected cached status request count 1, got %d", got)
	}
}

func TestTurnstileConfigClientCoalescesConcurrentRefresh(t *testing.T) {
	var requests atomic.Int64
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		select {
		case entered <- struct{}{}:
		default:
		}
		<-release
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":true,"turnstile_site_key":"0x-public"}}`))
	}))
	defer newAPIServer.Close()

	client := newTurnstileConfigClient(newAPIServer.URL)
	const callers = 16
	start := make(chan struct{})
	errors := make(chan error, callers)
	var waitGroup sync.WaitGroup
	waitGroup.Add(callers)
	for range callers {
		go func() {
			defer waitGroup.Done()
			<-start
			config, err := client.get(context.Background())
			if err == nil && (!config.Enabled || config.SiteKey != "0x-public") {
				err = http.ErrAbortHandler
			}
			errors <- err
		}()
	}
	close(start)
	<-entered
	time.Sleep(20 * time.Millisecond)
	close(release)
	waitGroup.Wait()
	close(errors)

	for err := range errors {
		if err != nil {
			t.Fatalf("concurrent config request failed: %v", err)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected one coalesced upstream request, got %d", got)
	}
}

func TestTurnstileConfigClientCachesFailureAndUsesStaleConfig(t *testing.T) {
	var requests atomic.Int64
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		http.Error(writer, "unavailable", http.StatusServiceUnavailable)
	}))
	defer newAPIServer.Close()

	client := newTurnstileConfigClient(newAPIServer.URL)
	client.cached = turnstileConfig{Enabled: true, SiteKey: "0x-stale"}
	client.cachedAt = time.Now().Add(-turnstileConfigCacheTTL - time.Second)

	for range 2 {
		config, err := client.get(context.Background())
		if err != nil {
			t.Fatalf("expected stale config fallback, got error: %v", err)
		}
		if !config.Enabled || config.SiteKey != "0x-stale" {
			t.Fatalf("unexpected stale config: %#v", config)
		}
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("expected failed refresh to be negatively cached, got %d requests", got)
	}
}

func TestTurnstileConfigClientInvalidationForcesRefresh(t *testing.T) {
	var requests atomic.Int64
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestNumber := requests.Add(1)
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":true,"turnstile_site_key":"0x-public-` +
			strconv.FormatInt(requestNumber, 10) + `"}}`))
	}))
	defer newAPIServer.Close()

	client := newTurnstileConfigClient(newAPIServer.URL)
	first, err := client.get(context.Background())
	if err != nil {
		t.Fatalf("first config request failed: %v", err)
	}
	client.invalidate()
	second, err := client.get(context.Background())
	if err != nil {
		t.Fatalf("second config request failed: %v", err)
	}
	if first.SiteKey == second.SiteKey || requests.Load() != 2 {
		t.Fatalf("expected invalidation to force refresh, first=%q second=%q requests=%d", first.SiteKey, second.SiteKey, requests.Load())
	}
}

func TestShouldInvalidateTurnstileConfigOnlyWhenUpstreamNewlyRequiresVerification(t *testing.T) {
	tests := []struct {
		name    string
		config  turnstileConfig
		failure newapi.LoginFailureKind
		want    bool
	}{
		{
			name:    "缓存关闭但上游要求验证",
			config:  turnstileConfig{Enabled: false},
			failure: newapi.LoginFailureVerificationRequired,
			want:    true,
		},
		{
			name:    "已启用时缺 token 不清缓存",
			config:  turnstileConfig{Enabled: true, SiteKey: "0x-public"},
			failure: newapi.LoginFailureVerificationRequired,
			want:    false,
		},
		{
			name:    "无效 token 不清缓存",
			config:  turnstileConfig{Enabled: true, SiteKey: "0x-public"},
			failure: newapi.LoginFailureVerificationFailed,
			want:    false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldInvalidateTurnstileConfig(test.config, test.failure); got != test.want {
				t.Fatalf("unexpected invalidation decision: got %t want %t", got, test.want)
			}
		})
	}
}

func TestTurnstileConfigEndpointRejectsInvalidUpstreamConfig(t *testing.T) {
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":true,"turnstile_site_key":""}}`))
	}))
	defer newAPIServer.Close()

	handler := New(Dependencies{
		Config: config.Config{NewAPIURL: newAPIServer.URL},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	response := performJSONRequest(handler, http.MethodGet, "/api/auth/turnstile-config", "", false)
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), "人机验证配置暂时不可用") {
		t.Fatalf("expected config unavailable, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestTurnstileConfigEndpointSupportsDisabledVerification(t *testing.T) {
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":false,"turnstile_site_key":""}}`))
	}))
	defer newAPIServer.Close()

	handler := New(Dependencies{
		Config: config.Config{NewAPIURL: newAPIServer.URL},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
	response := performJSONRequest(handler, http.MethodGet, "/api/auth/turnstile-config", "", false)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"enabled":false`) || !strings.Contains(response.Body.String(), `"siteKey":""`) {
		t.Fatalf("expected disabled config, got status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestLoginRequiresTurnstileBeforeCallingUpstream(t *testing.T) {
	var loginRequests atomic.Int64
	newAPIServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/status":
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"success":true,"data":{"turnstile_check":true,"turnstile_site_key":"0x-public"}}`))
		case "/api/user/login":
			loginRequests.Add(1)
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"success":false,"message":"不应调用"}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer newAPIServer.Close()

	redisClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:0"})
	t.Cleanup(func() { _ = redisClient.Close() })
	handler := New(Dependencies{
		Config: config.Config{NewAPIURL: newAPIServer.URL},
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Redis:  redisClient,
	})
	response := performJSONRequest(handler, http.MethodPost, "/api/auth/login", `{"username":"alice","password":"secret","turnstileToken":""}`, false)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"TURNSTILE_REQUIRED"`) {
		t.Fatalf("expected missing Turnstile 400, got status=%d body=%s", response.Code, response.Body.String())
	}
	if got := loginRequests.Load(); got != 0 {
		t.Fatalf("new-api login must not be called without Turnstile token, got %d requests", got)
	}
}
