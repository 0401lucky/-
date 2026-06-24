package economy

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestRunWithWalletOperationLockAcquiresAndReleases(t *testing.T) {
	client := newFakeRedisLockClient()
	key := walletOperationLockKey(1001)
	called := false

	err := runWithWalletOperationLock(context.Background(), client, 1001, WalletOperationWithdraw, walletLockOptions{
		ttl:        time.Minute,
		retryDelay: 0,
		maxRetries: 0,
	}, func() error {
		called = true
		if client.value(key) == "" {
			t.Fatalf("lock should exist while handler is running")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("lock returned error: %v", err)
	}
	if !called {
		t.Fatalf("handler should be called")
	}
	if client.value(key) != "" {
		t.Fatalf("lock should be released after handler")
	}
}

func TestRunWithWalletOperationLockReturnsBusy(t *testing.T) {
	client := newFakeRedisLockClient()
	client.values[walletOperationLockKey(1002)] = "existing"

	err := runWithWalletOperationLock(context.Background(), client, 1002, WalletOperationTopup, walletLockOptions{
		ttl:        time.Minute,
		retryDelay: 0,
		maxRetries: 0,
	}, func() error {
		t.Fatalf("handler should not be called")
		return nil
	})
	if !errors.Is(err, ErrWalletOperationBusy) {
		t.Fatalf("expected busy error, got %v", err)
	}
}

func TestReleaseWalletOperationLockDoesNotDeleteDifferentToken(t *testing.T) {
	client := newFakeRedisLockClient()
	key := walletOperationLockKey(1003)

	err := runWithWalletOperationLock(context.Background(), client, 1003, WalletOperationWithdraw, walletLockOptions{
		ttl:        time.Minute,
		retryDelay: 0,
		maxRetries: 0,
	}, func() error {
		client.set(key, "other-token")
		return nil
	})
	if err != nil {
		t.Fatalf("lock returned error: %v", err)
	}
	if client.value(key) != "other-token" {
		t.Fatalf("lock with different token should remain, got %q", client.value(key))
	}
}

type fakeRedisLockClient struct {
	mu     sync.Mutex
	values map[string]string
}

func newFakeRedisLockClient() *fakeRedisLockClient {
	return &fakeRedisLockClient{values: map[string]string{}}
}

func (client *fakeRedisLockClient) SetNX(ctx context.Context, key string, value any, expiration time.Duration) *redis.BoolCmd {
	client.mu.Lock()
	defer client.mu.Unlock()

	if _, exists := client.values[key]; exists {
		return redis.NewBoolResult(false, nil)
	}
	client.values[key] = value.(string)
	return redis.NewBoolResult(true, nil)
}

func (client *fakeRedisLockClient) Get(ctx context.Context, key string) *redis.StringCmd {
	client.mu.Lock()
	defer client.mu.Unlock()

	value, ok := client.values[key]
	if !ok {
		return redis.NewStringResult("", redis.Nil)
	}
	return redis.NewStringResult(value, nil)
}

func (client *fakeRedisLockClient) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	client.mu.Lock()
	defer client.mu.Unlock()

	var removed int64
	for _, key := range keys {
		if _, ok := client.values[key]; ok {
			delete(client.values, key)
			removed++
		}
	}
	return redis.NewIntResult(removed, nil)
}

func (client *fakeRedisLockClient) value(key string) string {
	client.mu.Lock()
	defer client.mu.Unlock()
	return client.values[key]
}

func (client *fakeRedisLockClient) set(key string, value string) {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.values[key] = value
}
