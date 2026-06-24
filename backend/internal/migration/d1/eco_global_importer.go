package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type EcoGlobalImportPlan struct {
	Users                   []UserImportRecord
	GlobalPrizeStock        []EcoGlobalPrizeStockImportRecord
	PublicPrizes            []EcoPublicPrizeImportRecord
	Thefts                  []EcoTheftImportRecord
	PrizeClaimStats         []EcoPrizeClaimStatImportRecord
	TrashRankings           []EcoTrashRankingImportRecord
	ReplaceGlobalPrizeStock bool
	ReplacePublicPrizes     bool
	ReplaceThefts           bool
	Warnings                []string
}

type EcoGlobalImportResult struct {
	UsersUpserted            int
	GlobalPrizeStockUpserted int
	PublicPrizesUpserted     int
	TheftsUpserted           int
	PrizeClaimStatsUpserted  int
	TrashRankingsUpserted    int
	Warnings                 []string
}

type EcoGlobalPrizeStockImportRecord struct {
	PrizeKey     string
	ClaimedCount int64
}

type EcoPublicPrizeImportRecord struct {
	ID                    string
	PrizeKey              string
	OwnerUserID           int64
	OwnerName             string
	OwnerAvatarURL        *string
	OwnerLotID            string
	PublicAtMs            int64
	MerchantAvailableAtMs int64
	Status                string
	ThiefUserID           *int64
	ThiefName             *string
	TheftMessage          *string
	StolenAtMs            *int64
	RawEntry              json.RawMessage
}

type EcoTheftImportRecord struct {
	ID                       string
	PrizeKey                 string
	OriginalUserID           int64
	ThiefUserID              int64
	PublicEntryID            string
	OriginalLotID            string
	ThiefLotID               string
	StolenAtMs               int64
	NextCheckAtMs            int64
	BlackMarketAvailableAtMs int64
	Message                  string
	ResolvedAtMs             *int64
	Outcome                  *string
	RawRecord                json.RawMessage
}

type EcoPrizeClaimStatImportRecord struct {
	StatDate   string
	PrizeKey   string
	ClaimCount int64
}

type EcoTrashRankingImportRecord struct {
	Period       string
	PeriodKey    string
	UserID       int64
	TrashCleared int64
}

type rawEcoPublicPrizeEntry struct {
	ID                  string          `json:"id"`
	Key                 string          `json:"key"`
	OwnerUserID         json.RawMessage `json:"ownerUserId"`
	OwnerName           string          `json:"ownerName"`
	OwnerAvatarURL      *string         `json:"ownerAvatarUrl"`
	OwnerLotID          string          `json:"ownerLotId"`
	PublicAt            json.RawMessage `json:"publicAt"`
	MerchantAvailableAt json.RawMessage `json:"merchantAvailableAt"`
	Status              string          `json:"status"`
	ThiefUserID         json.RawMessage `json:"thiefUserId"`
	ThiefName           *string         `json:"thiefName"`
	TheftMessage        *string         `json:"theftMessage"`
	StolenAt            json.RawMessage `json:"stolenAt"`
}

type rawEcoTheftRecord struct {
	ID                     string          `json:"id"`
	Key                    string          `json:"key"`
	OriginalUserID         json.RawMessage `json:"originalUserId"`
	ThiefUserID            json.RawMessage `json:"thiefUserId"`
	PublicEntryID          string          `json:"publicEntryId"`
	OriginalLotID          string          `json:"originalLotId"`
	ThiefLotID             string          `json:"thiefLotId"`
	StolenAt               json.RawMessage `json:"stolenAt"`
	NextCheckAt            json.RawMessage `json:"nextCheckAt"`
	BlackMarketAvailableAt json.RawMessage `json:"blackMarketAvailableAt"`
	Message                string          `json:"message"`
	ResolvedAt             json.RawMessage `json:"resolvedAt"`
	Outcome                *string         `json:"outcome"`
}

func PlanEcoGlobalImport(reader io.Reader) (EcoGlobalImportPlan, error) {
	plan := EcoGlobalImportPlan{}
	users := map[int64]UserImportRecord{}
	stock := map[string]EcoGlobalPrizeStockImportRecord{}
	publicPrizes := map[string]EcoPublicPrizeImportRecord{}
	thefts := map[string]EcoTheftImportRecord{}
	claimStats := map[string]EcoPrizeClaimStatImportRecord{}
	rankings := map[string]EcoTrashRankingImportRecord{}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statement, ok := parseInsertStatement(line)
		if !ok {
			continue
		}

		switch statement.Table {
		case "kv_hashes":
			key, ok := kvKey(statement)
			if !ok {
				continue
			}
			field, _ := valueFor(statement, []string{"key", "field", "value"}, "field", 1)
			value, ok := valueFor(statement, []string{"key", "field", "value"}, "value", 2)
			if !ok {
				continue
			}
			switch {
			case key == "eco:global-prize-stock":
				plan.ReplaceGlobalPrizeStock = true
				record, warnings, ok := parseEcoGlobalPrizeStock(field, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					stock[record.PrizeKey] = record
				}
			case matchKeyPattern(key, "eco:prize-claims:*"):
				record, warnings, ok := parseEcoPrizeClaimStat(key, field, value)
				plan.Warnings = append(plan.Warnings, warnings...)
				if ok {
					claimStats[ecoPrizeClaimStatKey(record.StatDate, record.PrizeKey)] = record
				}
			}
		case "kv_data":
			key, ok := kvKey(statement)
			if !ok {
				continue
			}
			value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
			if !ok || strings.TrimSpace(value) == "" {
				continue
			}
			switch key {
			case "eco:public-prizes":
				plan.ReplacePublicPrizes = true
				records, warnings := parseEcoPublicPrizes(value)
				plan.Warnings = append(plan.Warnings, warnings...)
				for _, record := range records {
					publicPrizes[record.ID] = record
					ensurePlanUser(users, record.OwnerUserID, millisToTime(record.PublicAtMs))
					if record.ThiefUserID != nil {
						ensurePlanUser(users, *record.ThiefUserID, millisToTime(record.PublicAtMs))
					}
				}
			case "eco:thefts":
				plan.ReplaceThefts = true
				records, warnings := parseEcoThefts(value)
				plan.Warnings = append(plan.Warnings, warnings...)
				for _, record := range records {
					thefts[record.ID] = record
					ensurePlanUser(users, record.OriginalUserID, millisToTime(record.StolenAtMs))
					ensurePlanUser(users, record.ThiefUserID, millisToTime(record.StolenAtMs))
				}
			}
		case "kv_zsets":
			key, ok := kvKey(statement)
			if !ok || !matchKeyPattern(key, "eco:trash-rank:*") {
				continue
			}
			member, _ := valueFor(statement, []string{"key", "member", "score"}, "member", 1)
			score, ok := valueFor(statement, []string{"key", "member", "score"}, "score", 2)
			if !ok {
				continue
			}
			record, warnings, ok := parseEcoTrashRanking(key, member, score)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				rankings[ecoTrashRankingKey(record.Period, record.PeriodKey, record.UserID)] = record
				ensurePlanUser(users, record.UserID, millisToTime(nowMillis()))
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, user := range users {
		plan.Users = append(plan.Users, user)
	}
	for _, record := range stock {
		plan.GlobalPrizeStock = append(plan.GlobalPrizeStock, record)
	}
	for _, record := range publicPrizes {
		plan.PublicPrizes = append(plan.PublicPrizes, record)
	}
	for _, record := range thefts {
		plan.Thefts = append(plan.Thefts, record)
	}
	for _, record := range claimStats {
		plan.PrizeClaimStats = append(plan.PrizeClaimStats, record)
	}
	for _, record := range rankings {
		plan.TrashRankings = append(plan.TrashRankings, record)
	}
	return plan, nil
}

func ApplyEcoGlobalImport(ctx context.Context, db *pgxpool.Pool, plan EcoGlobalImportPlan) (EcoGlobalImportResult, error) {
	result := EcoGlobalImportResult{Warnings: append([]string{}, plan.Warnings...)}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, user := range plan.Users {
		if _, err := tx.Exec(ctx,
			`INSERT INTO users (id, username, display_name, first_seen_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT (id) DO NOTHING`,
			user.ID,
			user.Username,
			user.DisplayName,
			user.FirstSeenAt,
			user.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert placeholder user %d failed: %w", user.ID, err)
		}
		result.UsersUpserted++
	}

	if err := deleteEcoGlobalSnapshotRows(ctx, tx, plan); err != nil {
		return result, err
	}

	for _, record := range plan.GlobalPrizeStock {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_global_prize_stock (prize_key, claimed_count)
			 VALUES ($1, $2)
			 ON CONFLICT (prize_key) DO UPDATE SET
			   claimed_count = excluded.claimed_count,
			   updated_at = now()`,
			record.PrizeKey,
			record.ClaimedCount,
		); err != nil {
			return result, fmt.Errorf("upsert eco global prize stock %s failed: %w", record.PrizeKey, err)
		}
		result.GlobalPrizeStockUpserted++
	}

	for _, record := range plan.PublicPrizes {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_public_prizes (
			   id, prize_key, owner_user_id, owner_name, owner_avatar_url, owner_lot_id,
			   public_at_ms, merchant_available_at_ms, status, thief_user_id, thief_name,
			   theft_message, stolen_at_ms, raw_entry
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   prize_key = excluded.prize_key,
			   owner_user_id = excluded.owner_user_id,
			   owner_name = excluded.owner_name,
			   owner_avatar_url = excluded.owner_avatar_url,
			   owner_lot_id = excluded.owner_lot_id,
			   public_at_ms = excluded.public_at_ms,
			   merchant_available_at_ms = excluded.merchant_available_at_ms,
			   status = excluded.status,
			   thief_user_id = excluded.thief_user_id,
			   thief_name = excluded.thief_name,
			   theft_message = excluded.theft_message,
			   stolen_at_ms = excluded.stolen_at_ms,
			   raw_entry = excluded.raw_entry,
			   updated_at = now()`,
			record.ID,
			record.PrizeKey,
			record.OwnerUserID,
			record.OwnerName,
			nullableStringPtr(record.OwnerAvatarURL),
			record.OwnerLotID,
			record.PublicAtMs,
			record.MerchantAvailableAtMs,
			record.Status,
			nullableInt64Ptr(record.ThiefUserID),
			nullableStringPtr(record.ThiefName),
			nullableStringPtr(record.TheftMessage),
			nullableInt64Ptr(record.StolenAtMs),
			string(record.RawEntry),
		); err != nil {
			return result, fmt.Errorf("upsert eco public prize %s failed: %w", record.ID, err)
		}
		result.PublicPrizesUpserted++
	}

	for _, record := range plan.Thefts {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_thefts (
			   id, prize_key, original_user_id, thief_user_id, public_entry_id,
			   original_lot_id, thief_lot_id, stolen_at_ms, next_check_at_ms,
			   black_market_available_at_ms, message, resolved_at_ms, outcome, raw_record
			 ) VALUES (
			   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb
			 )
			 ON CONFLICT (id) DO UPDATE SET
			   prize_key = excluded.prize_key,
			   original_user_id = excluded.original_user_id,
			   thief_user_id = excluded.thief_user_id,
			   public_entry_id = excluded.public_entry_id,
			   original_lot_id = excluded.original_lot_id,
			   thief_lot_id = excluded.thief_lot_id,
			   stolen_at_ms = excluded.stolen_at_ms,
			   next_check_at_ms = excluded.next_check_at_ms,
			   black_market_available_at_ms = excluded.black_market_available_at_ms,
			   message = excluded.message,
			   resolved_at_ms = excluded.resolved_at_ms,
			   outcome = excluded.outcome,
			   raw_record = excluded.raw_record,
			   updated_at = now()`,
			record.ID,
			record.PrizeKey,
			record.OriginalUserID,
			record.ThiefUserID,
			record.PublicEntryID,
			record.OriginalLotID,
			record.ThiefLotID,
			record.StolenAtMs,
			record.NextCheckAtMs,
			record.BlackMarketAvailableAtMs,
			record.Message,
			nullableInt64Ptr(record.ResolvedAtMs),
			nullableStringPtr(record.Outcome),
			string(record.RawRecord),
		); err != nil {
			return result, fmt.Errorf("upsert eco theft %s failed: %w", record.ID, err)
		}
		result.TheftsUpserted++
	}

	for _, record := range plan.PrizeClaimStats {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_prize_claim_stats (stat_date, prize_key, claim_count)
			 VALUES ($1::date, $2, $3)
			 ON CONFLICT (stat_date, prize_key) DO UPDATE SET
			   claim_count = excluded.claim_count,
			   updated_at = now()`,
			record.StatDate,
			record.PrizeKey,
			record.ClaimCount,
		); err != nil {
			return result, fmt.Errorf("upsert eco prize claim stat %s/%s failed: %w", record.StatDate, record.PrizeKey, err)
		}
		result.PrizeClaimStatsUpserted++
	}

	for _, record := range plan.TrashRankings {
		if _, err := tx.Exec(ctx,
			`INSERT INTO eco_trash_rankings (period, period_key, user_id, trash_cleared)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (period, period_key, user_id) DO UPDATE SET
			   trash_cleared = excluded.trash_cleared,
			   updated_at = now()`,
			record.Period,
			record.PeriodKey,
			record.UserID,
			record.TrashCleared,
		); err != nil {
			return result, fmt.Errorf("upsert eco trash ranking %s/%s/%d failed: %w", record.Period, record.PeriodKey, record.UserID, err)
		}
		result.TrashRankingsUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func deleteEcoGlobalSnapshotRows(ctx context.Context, tx pgx.Tx, plan EcoGlobalImportPlan) error {
	if plan.ReplaceGlobalPrizeStock {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_global_prize_stock`); err != nil {
			return fmt.Errorf("delete eco global prize stock failed: %w", err)
		}
	}
	if plan.ReplacePublicPrizes {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_public_prizes`); err != nil {
			return fmt.Errorf("delete eco public prizes failed: %w", err)
		}
	}
	if plan.ReplaceThefts {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_thefts`); err != nil {
			return fmt.Errorf("delete eco thefts failed: %w", err)
		}
	}
	statDates := map[string]struct{}{}
	for _, record := range plan.PrizeClaimStats {
		statDates[record.StatDate] = struct{}{}
	}
	for statDate := range statDates {
		if _, err := tx.Exec(ctx, `DELETE FROM eco_prize_claim_stats WHERE stat_date = $1::date`, statDate); err != nil {
			return fmt.Errorf("delete eco prize claim stats %s failed: %w", statDate, err)
		}
	}
	rankingKeys := map[string]EcoTrashRankingImportRecord{}
	for _, record := range plan.TrashRankings {
		rankingKeys[record.Period+":"+record.PeriodKey] = record
	}
	for _, record := range rankingKeys {
		if _, err := tx.Exec(ctx,
			`DELETE FROM eco_trash_rankings WHERE period = $1 AND period_key = $2`,
			record.Period,
			record.PeriodKey,
		); err != nil {
			return fmt.Errorf("delete eco trash rankings %s/%s failed: %w", record.Period, record.PeriodKey, err)
		}
	}
	return nil
}

func parseEcoGlobalPrizeStock(field string, rawValue string) (EcoGlobalPrizeStockImportRecord, []string, bool) {
	prizeKey := strings.TrimSpace(field)
	if !isEcoPrizeKey(prizeKey) {
		return EcoGlobalPrizeStockImportRecord{}, []string{fmt.Sprintf("跳过 eco:global-prize-stock:%s：无效奖品 key", field)}, false
	}
	count, warnings, ok := parseNonNegativeIntString(rawValue, fmt.Sprintf("eco:global-prize-stock:%s", prizeKey))
	if !ok {
		return EcoGlobalPrizeStockImportRecord{}, warnings, false
	}
	return EcoGlobalPrizeStockImportRecord{PrizeKey: prizeKey, ClaimedCount: count}, nil, true
}

func parseEcoPrizeClaimStat(key string, field string, rawValue string) (EcoPrizeClaimStatImportRecord, []string, bool) {
	statDate := strings.TrimPrefix(key, "eco:prize-claims:")
	if !isValidDateString(statDate) {
		return EcoPrizeClaimStatImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效日期", key)}, false
	}
	prizeKey := strings.TrimSpace(field)
	if prizeKey != "total" && !isEcoPrizeKey(prizeKey) {
		return EcoPrizeClaimStatImportRecord{}, []string{fmt.Sprintf("跳过 %s:%s：无效奖品 key", key, field)}, false
	}
	count, warnings, ok := parseNonNegativeIntString(rawValue, fmt.Sprintf("%s:%s", key, prizeKey))
	if !ok {
		return EcoPrizeClaimStatImportRecord{}, warnings, false
	}
	return EcoPrizeClaimStatImportRecord{StatDate: statDate, PrizeKey: prizeKey, ClaimCount: count}, nil, true
}

func parseEcoPublicPrizes(rawValue string) ([]EcoPublicPrizeImportRecord, []string) {
	rawEntries, err := decodeJSONArrayRaw(rawValue)
	if err != nil {
		return nil, []string{fmt.Sprintf("跳过 eco:public-prizes：JSON 解析失败：%v", err)}
	}
	records := make([]EcoPublicPrizeImportRecord, 0, len(rawEntries))
	warnings := []string{}
	for _, rawEntry := range rawEntries {
		var raw rawEcoPublicPrizeEntry
		if err := decodeJSONObject(string(rawEntry), &raw); err != nil {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:public-prizes 条目：JSON 解析失败：%v", err))
			continue
		}
		record, recordWarnings, ok := normalizeEcoPublicPrize(raw, rawEntry)
		warnings = append(warnings, recordWarnings...)
		if ok {
			records = append(records, record)
		}
	}
	return records, warnings
}

func normalizeEcoPublicPrize(raw rawEcoPublicPrizeEntry, rawEntry json.RawMessage) (EcoPublicPrizeImportRecord, []string, bool) {
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		return EcoPublicPrizeImportRecord{}, []string{"跳过 eco:public-prizes：缺少 id"}, false
	}
	prizeKey := strings.TrimSpace(raw.Key)
	if !isEcoPrizeKey(prizeKey) {
		return EcoPublicPrizeImportRecord{}, []string{fmt.Sprintf("跳过 eco:public-prizes:%s：无效奖品 key %q", id, prizeKey)}, false
	}
	ownerUserID := positiveInt64Or(raw.OwnerUserID, 0)
	if ownerUserID <= 0 {
		return EcoPublicPrizeImportRecord{}, []string{fmt.Sprintf("跳过 eco:public-prizes:%s：无效 ownerUserId", id)}, false
	}
	ownerLotID := strings.TrimSpace(raw.OwnerLotID)
	if ownerLotID == "" {
		return EcoPublicPrizeImportRecord{}, []string{fmt.Sprintf("跳过 eco:public-prizes:%s：缺少 ownerLotId", id)}, false
	}
	publicAtMs := positiveInt64Or(raw.PublicAt, 0)
	if publicAtMs <= 0 {
		return EcoPublicPrizeImportRecord{}, []string{fmt.Sprintf("跳过 eco:public-prizes:%s：publicAt 无效", id)}, false
	}
	merchantAvailableAtMs := positiveInt64Or(raw.MerchantAvailableAt, publicAtMs)
	status := strings.TrimSpace(raw.Status)
	if status != "listed" && status != "stolen" {
		status = "listed"
	}
	return EcoPublicPrizeImportRecord{
		ID:                    id,
		PrizeKey:              prizeKey,
		OwnerUserID:           ownerUserID,
		OwnerName:             fallbackString(raw.OwnerName, fmt.Sprintf("#%d", ownerUserID)),
		OwnerAvatarURL:        cleanOptionalString(raw.OwnerAvatarURL),
		OwnerLotID:            ownerLotID,
		PublicAtMs:            publicAtMs,
		MerchantAvailableAtMs: merchantAvailableAtMs,
		Status:                status,
		ThiefUserID:           positiveInt64FromRaw(raw.ThiefUserID),
		ThiefName:             cleanOptionalString(raw.ThiefName),
		TheftMessage:          cleanOptionalString(raw.TheftMessage),
		StolenAtMs:            positiveInt64FromRaw(raw.StolenAt),
		RawEntry:              rawEntry,
	}, nil, true
}

func parseEcoThefts(rawValue string) ([]EcoTheftImportRecord, []string) {
	rawRecords, err := decodeJSONArrayRaw(rawValue)
	if err != nil {
		return nil, []string{fmt.Sprintf("跳过 eco:thefts：JSON 解析失败：%v", err)}
	}
	records := make([]EcoTheftImportRecord, 0, len(rawRecords))
	warnings := []string{}
	for _, rawRecord := range rawRecords {
		var raw rawEcoTheftRecord
		if err := decodeJSONObject(string(rawRecord), &raw); err != nil {
			warnings = append(warnings, fmt.Sprintf("跳过 eco:thefts 条目：JSON 解析失败：%v", err))
			continue
		}
		record, recordWarnings, ok := normalizeEcoTheft(raw, rawRecord)
		warnings = append(warnings, recordWarnings...)
		if ok {
			records = append(records, record)
		}
	}
	return records, warnings
}

func normalizeEcoTheft(raw rawEcoTheftRecord, rawRecord json.RawMessage) (EcoTheftImportRecord, []string, bool) {
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		return EcoTheftImportRecord{}, []string{"跳过 eco:thefts：缺少 id"}, false
	}
	prizeKey := strings.TrimSpace(raw.Key)
	if !isEcoPrizeKey(prizeKey) {
		return EcoTheftImportRecord{}, []string{fmt.Sprintf("跳过 eco:thefts:%s：无效奖品 key %q", id, prizeKey)}, false
	}
	originalUserID := positiveInt64Or(raw.OriginalUserID, 0)
	thiefUserID := positiveInt64Or(raw.ThiefUserID, 0)
	if originalUserID <= 0 || thiefUserID <= 0 {
		return EcoTheftImportRecord{}, []string{fmt.Sprintf("跳过 eco:thefts:%s：无效用户 ID", id)}, false
	}
	publicEntryID := strings.TrimSpace(raw.PublicEntryID)
	originalLotID := strings.TrimSpace(raw.OriginalLotID)
	thiefLotID := strings.TrimSpace(raw.ThiefLotID)
	if publicEntryID == "" || originalLotID == "" || thiefLotID == "" {
		return EcoTheftImportRecord{}, []string{fmt.Sprintf("跳过 eco:thefts:%s：缺少关联 ID", id)}, false
	}
	stolenAtMs := positiveInt64Or(raw.StolenAt, 0)
	nextCheckAtMs := positiveInt64Or(raw.NextCheckAt, 0)
	blackMarketAvailableAtMs := positiveInt64Or(raw.BlackMarketAvailableAt, 0)
	if stolenAtMs <= 0 || nextCheckAtMs <= 0 || blackMarketAvailableAtMs <= 0 {
		return EcoTheftImportRecord{}, []string{fmt.Sprintf("跳过 eco:thefts:%s：时间字段无效", id)}, false
	}
	outcome := cleanOptionalString(raw.Outcome)
	if outcome != nil && *outcome != "caught" && *outcome != "escaped" {
		outcome = nil
	}
	return EcoTheftImportRecord{
		ID:                       id,
		PrizeKey:                 prizeKey,
		OriginalUserID:           originalUserID,
		ThiefUserID:              thiefUserID,
		PublicEntryID:            publicEntryID,
		OriginalLotID:            originalLotID,
		ThiefLotID:               thiefLotID,
		StolenAtMs:               stolenAtMs,
		NextCheckAtMs:            nextCheckAtMs,
		BlackMarketAvailableAtMs: blackMarketAvailableAtMs,
		Message:                  raw.Message,
		ResolvedAtMs:             positiveInt64FromRaw(raw.ResolvedAt),
		Outcome:                  outcome,
		RawRecord:                rawRecord,
	}, nil, true
}

func parseEcoTrashRanking(key string, member string, rawScore string) (EcoTrashRankingImportRecord, []string, bool) {
	parts := strings.SplitN(key, ":", 4)
	if len(parts) != 4 || parts[0] != "eco" || parts[1] != "trash-rank" {
		return EcoTrashRankingImportRecord{}, []string{fmt.Sprintf("跳过 %s：key 格式无效", key)}, false
	}
	period := strings.TrimSpace(parts[2])
	if period != "daily" && period != "weekly" && period != "monthly" {
		return EcoTrashRankingImportRecord{}, []string{fmt.Sprintf("跳过 %s：无效周期", key)}, false
	}
	periodKey := strings.TrimSpace(parts[3])
	if periodKey == "" {
		return EcoTrashRankingImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少周期 key", key)}, false
	}
	userID := ecoRankingUserID(member)
	if userID <= 0 {
		return EcoTrashRankingImportRecord{}, []string{fmt.Sprintf("跳过 %s:%s：无效用户 ID", key, member)}, false
	}
	score, warnings, ok := parseNonNegativeScore(rawScore, fmt.Sprintf("%s:%s", key, member))
	if !ok || score <= 0 {
		return EcoTrashRankingImportRecord{}, warnings, false
	}
	return EcoTrashRankingImportRecord{
		Period:       period,
		PeriodKey:    periodKey,
		UserID:       userID,
		TrashCleared: score,
	}, nil, true
}

func decodeJSONArrayRaw(rawValue string) ([]json.RawMessage, error) {
	var values []json.RawMessage
	decoder := json.NewDecoder(strings.NewReader(rawValue))
	decoder.UseNumber()
	if err := decoder.Decode(&values); err != nil {
		return nil, err
	}
	return values, nil
}

func parseNonNegativeIntString(rawValue string, source string) (int64, []string, bool) {
	value, err := strconv.ParseInt(strings.TrimSpace(rawValue), 10, 64)
	if err != nil {
		return 0, []string{fmt.Sprintf("跳过 %s：数值解析失败：%v", source, err)}, false
	}
	if value < 0 {
		return 0, []string{fmt.Sprintf("跳过 %s：数值不能为负数", source)}, false
	}
	return value, nil, true
}

func parseNonNegativeScore(rawValue string, source string) (int64, []string, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(rawValue), 64)
	if err != nil {
		return 0, []string{fmt.Sprintf("跳过 %s：分数解析失败：%v", source, err)}, false
	}
	if value < 0 {
		return 0, []string{fmt.Sprintf("跳过 %s：分数不能为负数", source)}, false
	}
	return int64(math.Floor(value)), nil, true
}

func ecoRankingUserID(member string) int64 {
	raw := strings.TrimPrefix(strings.TrimSpace(member), "u:")
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0
	}
	return value
}

func ecoPrizeClaimStatKey(statDate string, prizeKey string) string {
	return statDate + ":" + prizeKey
}

func ecoTrashRankingKey(period string, periodKey string, userID int64) string {
	return fmt.Sprintf("%s:%s:%d", period, periodKey, userID)
}
