package postgres

import "testing"

func TestExtractUpSQL(t *testing.T) {
	content := "-- +goose Up\nCREATE TABLE a(id int);\n-- +goose Down\nDROP TABLE a;"
	got := extractUpSQL(content)
	if got != "\nCREATE TABLE a(id int);\n" {
		t.Fatalf("unexpected up sql: %q", got)
	}
}

func TestSplitStatements(t *testing.T) {
	statements := splitStatements("CREATE TABLE a(id int);\n\nCREATE INDEX b ON a(id);")
	if len(statements) != 2 {
		t.Fatalf("expected 2 statements, got %d", len(statements))
	}
}
