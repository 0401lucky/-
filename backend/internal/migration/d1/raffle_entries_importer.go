package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type RaffleEntriesImportPlan struct {
	Entries  []RaffleEntryImportRecord
	Warnings []string
}

type RaffleEntriesImportResult struct {
	EntriesUpserted int
	Warnings        []string
}

type RaffleEntryImportRecord struct {
	ID          string
	RaffleID    string
	UserID      int64
	Username    string
	EntryNumber int64
	CreatedAt   int64
}

type rawRaffleEntry struct {
	ID          string          `json:"id"`
	RaffleID    string          `json:"raffleId"`
	UserID      json.RawMessage `json:"userId"`
	Username    string          `json:"username"`
	EntryNumber json.RawMessage `json:"entryNumber"`
	CreatedAt   json.RawMessage `json:"createdAt"`
}

func PlanRaffleEntriesImport(reader io.Reader) (RaffleEntriesImportPlan, error) {
	plan := RaffleEntriesImportPlan{}
	entries := map[string]RaffleEntryImportRecord{}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statement, ok := parseInsertStatement(line)
		if !ok || statement.Table != "kv_lists" {
			continue
		}
		key, ok := kvKey(statement)
		if !ok || !matchKeyPattern(key, "raffle:entries:*") {
			continue
		}
		value, ok := valueFor(statement, []string{"id", "key", "value"}, "value", 2)
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}
		listID, _ := valueFor(statement, []string{"id", "key", "value"}, "id", 0)
		entry, warnings, ok := parseRaffleEntry(key, listID, value)
		plan.Warnings = append(plan.Warnings, warnings...)
		if ok {
			entries[entry.ID] = entry
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, entry := range entries {
		plan.Entries = append(plan.Entries, entry)
	}
	return plan, nil
}

func ApplyRaffleEntriesImport(ctx context.Context, db *pgxpool.Pool, plan RaffleEntriesImportPlan) (RaffleEntriesImportResult, error) {
	result := RaffleEntriesImportResult{Warnings: append([]string{}, plan.Warnings...)}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, entry := range plan.Entries {
		tag, err := tx.Exec(ctx,
			`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
			 SELECT $1::text, $2::text, $3::bigint, $4::text, $5::bigint, $6::bigint
			 WHERE EXISTS (SELECT 1 FROM raffles WHERE id = $2)
			 ON CONFLICT (raffle_id, user_id) DO UPDATE SET
			   id = excluded.id,
			   username = excluded.username,
			   entry_number = excluded.entry_number,
			   created_at_ms = excluded.created_at_ms`,
			entry.ID,
			entry.RaffleID,
			entry.UserID,
			entry.Username,
			entry.EntryNumber,
			entry.CreatedAt,
		)
		if err != nil {
			return result, fmt.Errorf("upsert raffle entry %s failed: %w", entry.ID, err)
		}
		if tag.RowsAffected() == 0 {
			result.Warnings = append(result.Warnings, fmt.Sprintf("raffle:entries:%s 目标库无对应活动，已跳过 entry %s", entry.RaffleID, entry.ID))
			continue
		}
		result.EntriesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseRaffleEntry(key string, listID string, rawValue string) (RaffleEntryImportRecord, []string, bool) {
	raffleID := strings.TrimPrefix(key, "raffle:entries:")
	if raffleID == "" {
		return RaffleEntryImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少活动 ID", key)}, false
	}

	var raw rawRaffleEntry
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return RaffleEntryImportRecord{}, []string{fmt.Sprintf("跳过 %s：参与记录 JSON 解析失败：%v", key, err)}, false
	}
	if raw.RaffleID != "" {
		raffleID = strings.TrimSpace(raw.RaffleID)
	}
	if raffleID == "" {
		return RaffleEntryImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少活动 ID", key)}, false
	}

	userID := int64FromRaw(raw.UserID, 0)
	if userID <= 0 {
		return RaffleEntryImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效 userId", key)}, false
	}
	entryNumber := int64FromRaw(raw.EntryNumber, 0)
	if entryNumber <= 0 {
		return RaffleEntryImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效 entryNumber", key)}, false
	}
	createdAt := int64FromRaw(raw.CreatedAt, time.Now().UnixMilli())
	entryID := fallbackString(raw.ID, strings.TrimSpace(listID))
	if entryID == "" {
		entryID = fmt.Sprintf("legacy-raffle-entry-%s-%d-%d", raffleID, userID, entryNumber)
	}

	return RaffleEntryImportRecord{
		ID:          entryID,
		RaffleID:    raffleID,
		UserID:      userID,
		Username:    fallbackString(raw.Username, fmt.Sprintf("user-%d", userID)),
		EntryNumber: entryNumber,
		CreatedAt:   createdAt,
	}, nil, true
}
