package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	pgmigration "redemption/backend/internal/migration/postgres"
	"redemption/backend/internal/platform/postgres"
)

func main() {
	dir := flag.String("dir", defaultMigrationsDir(), "PostgreSQL migrations 目录")
	dryRun := flag.Bool("dry-run", false, "只列出将要执行的 migration")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	ctx := context.Background()

	if *dryRun {
		result, err := pgmigration.NewRunner(nil, *dir).Apply(ctx, true)
		if err != nil {
			logger.Error("检查 migration 失败", "error", err)
			os.Exit(1)
		}
		printResult(result)
		return
	}

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		logger.Error("DATABASE_URL is required")
		os.Exit(1)
	}

	db, err := postgres.Open(ctx, databaseURL)
	if err != nil {
		logger.Error("连接 PostgreSQL 失败", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	result, err := pgmigration.NewRunner(db, *dir).Apply(ctx, *dryRun)
	if err != nil {
		logger.Error("执行 migration 失败", "error", err)
		os.Exit(1)
	}

	printResult(result)
}

func printResult(result pgmigration.MigrationResult) {
	fmt.Println("PostgreSQL migration 结果")
	for _, version := range result.Applied {
		fmt.Printf("- applied: %s\n", version)
	}
	for _, version := range result.Skipped {
		fmt.Printf("- skipped: %s\n", version)
	}
}

func defaultMigrationsDir() string {
	if value := os.Getenv("MIGRATIONS_DIR"); value != "" {
		return value
	}
	if _, err := os.Stat("/app/migrations"); err == nil {
		return "/app/migrations"
	}
	return filepath.Join(".", "migrations")
}
