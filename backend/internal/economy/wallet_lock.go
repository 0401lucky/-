package economy

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	walletOperationLockTTL        = 60 * time.Second
	walletOperationLockRetryDelay = 120 * time.Millisecond
	walletOperationLockMaxRetries = 12
)

var (
	ErrWalletLockUnavailable = errors.New("wallet lock redis is not configured")
	ErrWalletOperationBusy   = errors.New("wallet operation busy")
)

type RedisLockClient interface {
	SetNX(ctx context.Context, key string, value any, expiration time.Duration) *redis.BoolCmd
	Get(ctx context.Context, key string) *redis.StringCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
}

type walletLockOptions struct {
	ttl        time.Duration
	retryDelay time.Duration
	maxRetries int
}

func (service *Service) RunWithWalletOperationLock(ctx context.Context, userID int64, operation string, handler func() error) error {
	return runWithWalletOperationLock(ctx, service.redis, userID, operation, walletLockOptions{
		ttl:        walletOperationLockTTL,
		retryDelay: walletOperationLockRetryDelay,
		maxRetries: walletOperationLockMaxRetries,
	}, handler)
}

func runWithWalletOperationLock(
	ctx context.Context,
	client RedisLockClient,
	userID int64,
	operation string,
	options walletLockOptions,
	handler func() error,
) error {
	if client == nil {
		return ErrWalletLockUnavailable
	}
	if options.ttl <= 0 {
		options.ttl = walletOperationLockTTL
	}
	if options.retryDelay < 0 {
		options.retryDelay = 0
	}
	if options.maxRetries < 0 {
		options.maxRetries = 0
	}

	key := walletOperationLockKey(userID)
	token := randomID()
	for attempt := 0; attempt <= options.maxRetries; attempt++ {
		locked, err := client.SetNX(ctx, key, token, options.ttl).Result()
		if err != nil {
			return err
		}
		if locked {
			defer releaseWalletOperationLock(context.Background(), client, key, token)
			return handler()
		}
		if attempt == options.maxRetries {
			return fmt.Errorf("%w: %s", ErrWalletOperationBusy, operation)
		}
		if options.retryDelay > 0 {
			timer := time.NewTimer(options.retryDelay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
	}
	return ErrWalletOperationBusy
}

func releaseWalletOperationLock(ctx context.Context, client RedisLockClient, key string, token string) {
	current, err := client.Get(ctx, key).Result()
	if err != nil || current != token {
		return
	}
	_ = client.Del(ctx, key).Err()
}

func walletOperationLockKey(userID int64) string {
	return fmt.Sprintf("lock:user:wallet:%d", userID)
}
