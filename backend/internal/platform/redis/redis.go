package redis

import (
	"github.com/redis/go-redis/v9"
)

func Open(redisURL string) (*redis.Client, error) {
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(options), nil
}
