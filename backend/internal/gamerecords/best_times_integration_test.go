//go:build integration

package gamerecords

import (
	"context"
	"os"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestBestTimes(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	// A transaction-local table keeps fixtures isolated from any existing data.
	_, err = tx.Exec(ctx, `CREATE TEMP TABLE game_records (
		user_id bigint, game_type text, difficulty text, payload jsonb
	) ON COMMIT DROP`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO game_records VALUES
		(1, 'sudoku', 'easy', '{"won":true,"duration":65001}'),
		(1, 'sudoku', 'easy', '{"won":false,"duration":1000}'),
		(1, 'sudoku', 'easy', '{"won":true,"duration":0}'),
		(1, 'sudoku', 'easy', '{"won":true}'),
		(1, 'sudoku', 'hard', '{"won":true,"duration":125000}'),
		(1, 'sudoku', 'normal', '{"won":false,"duration":3000}'),
		(2, 'sudoku', 'easy', '{"won":true,"duration":1000}'),
		(1, 'minesweeper', 'easy', '{"won":true,"duration":8000}');
		INSERT INTO game_records SELECT 1, 'sudoku', 'easy',
		'{"won":true,"duration":90000}'::jsonb FROM generate_series(1, 60)`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		user int64
		game string
		want map[string]int64
	}{
		{1, "sudoku", map[string]int64{"easy": 65001, "hard": 125000}},
		{1, "minesweeper", map[string]int64{"easy": 8000}},
		{3, "sudoku", map[string]int64{}},
	} {
		got, err := BestTimes(ctx, tx, tc.user, tc.game)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("user=%d game=%s got=%v want=%v", tc.user, tc.game, got, tc.want)
		}
	}
}
