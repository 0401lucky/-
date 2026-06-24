package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"redemption/backend/internal/config"
	"redemption/backend/internal/platform/postgres"
	redisclient "redemption/backend/internal/platform/redis"
	"redemption/backend/internal/worker"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("加载配置失败", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("连接 PostgreSQL 失败", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	redisClient, err := redisclient.Open(cfg.RedisURL)
	if err != nil {
		logger.Error("连接 Redis 失败", "error", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	runner := worker.New(worker.Dependencies{
		Config: cfg,
		Logger: logger,
		DB:     pool,
		Redis:  redisClient,
	})

	if err := runner.Run(ctx); err != nil {
		logger.Error("Go Worker 异常退出", "error", err)
		os.Exit(1)
	}
}
