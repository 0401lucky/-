package postgres

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Runner struct {
	db  *pgxpool.Pool
	dir string
}

type MigrationResult struct {
	Applied []string
	Skipped []string
}

func NewRunner(db *pgxpool.Pool, dir string) Runner {
	return Runner{db: db, dir: dir}
}

func (runner Runner) Apply(ctx context.Context, dryRun bool) (MigrationResult, error) {
	files, err := filepath.Glob(filepath.Join(runner.dir, "*.sql"))
	if err != nil {
		return MigrationResult{}, err
	}
	sort.Strings(files)

	result := MigrationResult{}
	if len(files) == 0 {
		return result, fmt.Errorf("migrations dir has no sql files: %s", runner.dir)
	}

	if dryRun {
		for _, file := range files {
			result.Applied = append(result.Applied, filepath.Base(file))
		}
		return result, nil
	}

	tx, err := runner.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return MigrationResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS schema_migrations (
		   version TEXT PRIMARY KEY,
		   applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		 )`,
	); err != nil {
		return MigrationResult{}, err
	}

	for _, file := range files {
		version := filepath.Base(file)
		applied, err := isApplied(ctx, tx, version)
		if err != nil {
			return MigrationResult{}, err
		}
		if applied {
			result.Skipped = append(result.Skipped, version)
			continue
		}

		raw, err := os.ReadFile(file)
		if err != nil {
			return MigrationResult{}, err
		}
		upSQL := extractUpSQL(string(raw))
		for _, statement := range splitStatements(upSQL) {
			if _, err := tx.Exec(ctx, statement); err != nil {
				return MigrationResult{}, fmt.Errorf("%s failed: %w", version, err)
			}
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())`,
			version,
		); err != nil {
			return MigrationResult{}, err
		}
		result.Applied = append(result.Applied, version)
	}

	if err := tx.Commit(ctx); err != nil {
		return MigrationResult{}, err
	}
	return result, nil
}

func isApplied(ctx context.Context, tx pgx.Tx, version string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`,
		version,
	).Scan(&exists)
	return exists, err
}

func extractUpSQL(content string) string {
	upMarker := "-- +goose Up"
	downMarker := "-- +goose Down"

	if index := strings.Index(content, upMarker); index >= 0 {
		content = content[index+len(upMarker):]
	}
	if index := strings.Index(content, downMarker); index >= 0 {
		content = content[:index]
	}
	return content
}

func splitStatements(sqlText string) []string {
	rawStatements := strings.Split(sqlText, ";")
	statements := make([]string, 0, len(rawStatements))
	for _, raw := range rawStatements {
		statement := strings.TrimSpace(raw)
		if statement == "" {
			continue
		}
		statements = append(statements, statement)
	}
	return statements
}
