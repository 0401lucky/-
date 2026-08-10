package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	turnstileConfigCacheTTL         = 45 * time.Second
	turnstileConfigFailureTTL       = 5 * time.Second
	turnstileConfigStaleTTL         = 5 * time.Minute
	turnstileConfigErrorLogInterval = 30 * time.Second
	turnstileConfigTimeout          = 3 * time.Second
	turnstileConfigBodyLimit        = 1024 * 1024
)

type turnstileConfig struct {
	Enabled bool
	SiteKey string
}

type turnstileConfigClient struct {
	baseURL    string
	httpClient *http.Client

	mu       sync.Mutex
	cached   turnstileConfig
	cachedAt time.Time
	lastErr  error
	failedAt time.Time

	refreshing  bool
	refreshDone chan struct{}
	lastLogAt   time.Time
}

func newTurnstileConfigClient(baseURL string) *turnstileConfigClient {
	return &turnstileConfigClient{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{Timeout: turnstileConfigTimeout},
	}
}

func (client *turnstileConfigClient) get(ctx context.Context) (turnstileConfig, error) {
	if client == nil || client.baseURL == "" {
		return turnstileConfig{}, errors.New("NEW_API_URL is not set")
	}

	for {
		now := time.Now()
		client.mu.Lock()
		if !client.cachedAt.IsZero() && now.Sub(client.cachedAt) < turnstileConfigCacheTTL {
			cached := client.cached
			client.mu.Unlock()
			return cached, nil
		}
		if !client.failedAt.IsZero() && now.Sub(client.failedAt) < turnstileConfigFailureTTL {
			cached := client.cached
			cachedAt := client.cachedAt
			lastErr := client.lastErr
			client.mu.Unlock()
			if !cachedAt.IsZero() && now.Sub(cachedAt) < turnstileConfigStaleTTL {
				return cached, nil
			}
			if lastErr == nil {
				lastErr = errors.New("new-api Turnstile config is temporarily unavailable")
			}
			return turnstileConfig{}, lastErr
		}
		if client.refreshing {
			done := client.refreshDone
			client.mu.Unlock()
			select {
			case <-ctx.Done():
				return turnstileConfig{}, ctx.Err()
			case <-done:
				continue
			}
		}

		client.refreshing = true
		client.refreshDone = make(chan struct{})
		stale := client.cached
		staleAt := client.cachedAt
		client.mu.Unlock()

		config, err := client.fetch(ctx)

		client.mu.Lock()
		if err == nil {
			client.cached = config
			client.cachedAt = time.Now()
			client.lastErr = nil
			client.failedAt = time.Time{}
			client.lastLogAt = time.Time{}
		} else {
			client.lastErr = err
			client.failedAt = time.Now()
		}
		client.refreshing = false
		close(client.refreshDone)
		client.refreshDone = nil
		client.mu.Unlock()

		if err != nil && !staleAt.IsZero() && now.Sub(staleAt) < turnstileConfigStaleTTL {
			return stale, nil
		}
		return config, err
	}
}

func (client *turnstileConfigClient) fetch(ctx context.Context) (turnstileConfig, error) {
	requestCtx, cancel := context.WithTimeout(ctx, turnstileConfigTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, client.baseURL+"/api/status", nil)
	if err != nil {
		return turnstileConfig{}, err
	}
	response, err := client.httpClient.Do(request)
	if err != nil {
		return turnstileConfig{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return turnstileConfig{}, fmt.Errorf("new-api status returned HTTP %d", response.StatusCode)
	}

	var envelope struct {
		Success bool `json:"success"`
		Data    struct {
			TurnstileCheck   bool   `json:"turnstile_check"`
			TurnstileSiteKey string `json:"turnstile_site_key"`
		} `json:"data"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, turnstileConfigBodyLimit))
	if err := decoder.Decode(&envelope); err != nil {
		return turnstileConfig{}, err
	}
	if !envelope.Success {
		return turnstileConfig{}, errors.New("new-api status response was unsuccessful")
	}
	config := turnstileConfig{
		Enabled: envelope.Data.TurnstileCheck,
		SiteKey: strings.TrimSpace(envelope.Data.TurnstileSiteKey),
	}
	if config.Enabled && config.SiteKey == "" {
		return turnstileConfig{}, errors.New("new-api Turnstile is enabled without a site key")
	}
	return config, nil
}

func (client *turnstileConfigClient) invalidate() {
	if client == nil {
		return
	}
	client.mu.Lock()
	client.cached = turnstileConfig{}
	client.cachedAt = time.Time{}
	client.lastErr = nil
	client.failedAt = time.Time{}
	client.mu.Unlock()
}

func (client *turnstileConfigClient) shouldLogError() bool {
	if client == nil {
		return true
	}
	now := time.Now()
	client.mu.Lock()
	defer client.mu.Unlock()
	if !client.lastLogAt.IsZero() && now.Sub(client.lastLogAt) < turnstileConfigErrorLogInterval {
		return false
	}
	client.lastLogAt = now
	return true
}
