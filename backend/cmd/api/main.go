package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"redemption/backend/internal/config"
	"redemption/backend/internal/httpserver"
	"redemption/backend/internal/platform/postgres"
	redisclient "redemption/backend/internal/platform/redis"
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

	server := httpserver.New(httpserver.Dependencies{
		Config: cfg,
		Logger: logger,
		DB:     pool,
		Redis:  redisClient,
	})

	httpServer := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           server,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("Go API 服务已启动", "port", cfg.Port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("Go API 服务异常退出", "error", err)
			stop()
		}
	}()

	<-ctx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("Go API 服务关闭失败", "error", err)
		os.Exit(1)
	}

	logger.Info("Go API 服务已关闭")
}
