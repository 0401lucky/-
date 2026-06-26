package d1

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PublicListImportPlan struct {
	Projects []ProjectImportRecord
	Raffles  []RaffleImportRecord
	Warnings []string
}

type PublicListImportResult struct {
	ProjectsUpserted int
	RafflesUpserted  int
	Warnings         []string
}

type ProjectImportRecord struct {
	ID           string
	Name         string
	Description  string
	MaxClaims    int64
	ClaimedCount int64
	CodesCount   int64
	Status       string
	CreatedAt    int64
	CreatedBy    string
	RewardType   *string
	DirectPoints *int64
	NewUserOnly  bool
	Pinned       bool
	PinnedAt     *int64
}

type RaffleImportRecord struct {
	ID                       string
	Mode                     string
	Title                    string
	Description              string
	CoverImage               *string
	Prizes                   json.RawMessage
	TriggerType              string
	Threshold                int64
	Status                   string
	ParticipantsCount        int64
	WinnersCount             int64
	Winners                  json.RawMessage
	DrawnAt                  *int64
	ScheduledDrawAt          *int64
	RedPacketTotalPoints     *int64
	RedPacketTotalSlots      *int64
	RedPacketRemainingPoints *int64
	RedPacketRemainingSlots  *int64
	RedPacketPackets         json.RawMessage
	CreatedBy                int64
	CreatedAt                int64
	UpdatedAt                int64
}

type rawProject struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	MaxClaims     json.RawMessage `json:"maxClaims"`
	ClaimedCount  json.RawMessage `json:"claimedCount"`
	CodesCount    json.RawMessage `json:"codesCount"`
	Status        string          `json:"status"`
	CreatedAt     json.RawMessage `json:"createdAt"`
	CreatedBy     json.RawMessage `json:"createdBy"`
	RewardType    string          `json:"rewardType"`
	DirectPoints  json.RawMessage `json:"directPoints"`
	DirectDollars json.RawMessage `json:"directDollars"`
	NewUserOnly   json.RawMessage `json:"newUserOnly"`
	Pinned        json.RawMessage `json:"pinned"`
	PinnedAt      json.RawMessage `json:"pinnedAt"`
}

type rawRaffle struct {
	ID                       string          `json:"id"`
	Mode                     string          `json:"mode"`
	Title                    string          `json:"title"`
	Description              string          `json:"description"`
	CoverImage               string          `json:"coverImage"`
	Prizes                   json.RawMessage `json:"prizes"`
	TriggerType              string          `json:"triggerType"`
	Threshold                json.RawMessage `json:"threshold"`
	Status                   string          `json:"status"`
	ParticipantsCount        json.RawMessage `json:"participantsCount"`
	WinnersCount             json.RawMessage `json:"winnersCount"`
	Winners                  json.RawMessage `json:"winners"`
	DrawnAt                  json.RawMessage `json:"drawnAt"`
	ScheduledDrawAt          json.RawMessage `json:"scheduledDrawAt"`
	RedPacketTotalPoints     json.RawMessage `json:"redPacketTotalPoints"`
	RedPacketTotalSlots      json.RawMessage `json:"redPacketTotalSlots"`
	RedPacketRemainingPoints json.RawMessage `json:"redPacketRemainingPoints"`
	RedPacketRemainingSlots  json.RawMessage `json:"redPacketRemainingSlots"`
	RedPacketPackets         json.RawMessage `json:"redPacketPackets"`
	CreatedBy                json.RawMessage `json:"createdBy"`
	CreatedAt                json.RawMessage `json:"createdAt"`
	UpdatedAt                json.RawMessage `json:"updatedAt"`
}

func PlanPublicListImport(reader io.Reader) (PublicListImportPlan, error) {
	plan := PublicListImportPlan{}
	projectByID := map[string]ProjectImportRecord{}
	raffleByID := map[string]RaffleImportRecord{}

	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "--") {
			continue
		}
		statement, ok := parseInsertStatement(line)
		if !ok || statement.Table != "kv_data" {
			continue
		}

		key, ok := kvKey(statement)
		if !ok {
			continue
		}
		value, ok := valueFor(statement, []string{"key", "value", "expires_at"}, "value", 1)
		if !ok || strings.TrimSpace(value) == "" {
			continue
		}

		switch {
		case matchKeyPattern(key, "projects:*"):
			project, warnings, ok := parseProjectImportRecord(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				projectByID[project.ID] = project
			}
		case isRaffleDetailKey(key):
			raffle, warnings, ok := parseRaffleImportRecord(key, value)
			plan.Warnings = append(plan.Warnings, warnings...)
			if ok {
				raffleByID[raffle.ID] = raffle
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return plan, err
	}

	for _, project := range projectByID {
		plan.Projects = append(plan.Projects, project)
	}
	for _, raffle := range raffleByID {
		plan.Raffles = append(plan.Raffles, raffle)
	}
	return plan, nil
}

func ApplyPublicListImport(ctx context.Context, db *pgxpool.Pool, plan PublicListImportPlan) (PublicListImportResult, error) {
	result := PublicListImportResult{Warnings: plan.Warnings}
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, project := range plan.Projects {
		if _, err := tx.Exec(ctx,
			`INSERT INTO projects (
			   id, name, description, max_claims, claimed_count, codes_count, status,
			   created_at_ms, created_by, reward_type, direct_points, new_user_only,
			   pinned, pinned_at_ms, updated_at
			 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
			 ON CONFLICT (id) DO UPDATE SET
			   name = excluded.name,
			   description = excluded.description,
			   max_claims = excluded.max_claims,
			   claimed_count = excluded.claimed_count,
			   codes_count = excluded.codes_count,
			   status = excluded.status,
			   created_at_ms = excluded.created_at_ms,
			   created_by = excluded.created_by,
			   reward_type = excluded.reward_type,
			   direct_points = excluded.direct_points,
			   new_user_only = excluded.new_user_only,
			   pinned = excluded.pinned,
			   pinned_at_ms = excluded.pinned_at_ms,
			   updated_at = now()`,
			project.ID,
			project.Name,
			project.Description,
			project.MaxClaims,
			project.ClaimedCount,
			project.CodesCount,
			project.Status,
			project.CreatedAt,
			project.CreatedBy,
			nullableStringPtr(project.RewardType),
			nullableInt64Ptr(project.DirectPoints),
			project.NewUserOnly,
			project.Pinned,
			nullableInt64Ptr(project.PinnedAt),
		); err != nil {
			return result, fmt.Errorf("upsert project %s failed: %w", project.ID, err)
		}
		result.ProjectsUpserted++
	}

	for _, raffle := range plan.Raffles {
		if _, err := tx.Exec(ctx,
			`INSERT INTO raffles (
			   id, mode, title, description, cover_image, prizes, trigger_type, threshold,
			   status, participants_count, winners_count, winners, drawn_at_ms, scheduled_draw_at_ms,
			   red_packet_total_points, red_packet_total_slots, red_packet_remaining_points,
			   red_packet_remaining_slots, red_packet_packets, created_by, created_at_ms, updated_at_ms, updated_at
			 ) VALUES ($1, $2, $3, $4, $5, CAST($6 AS jsonb), $7, $8, $9, $10, $11, CAST($12 AS jsonb), $13, $14, $15, $16, $17, $18, CAST($19 AS jsonb), $20, $21, $22, now())
			 ON CONFLICT (id) DO UPDATE SET
			   mode = excluded.mode,
			   title = excluded.title,
			   description = excluded.description,
			   cover_image = excluded.cover_image,
			   prizes = excluded.prizes,
			   trigger_type = excluded.trigger_type,
			   threshold = excluded.threshold,
			   status = excluded.status,
			   participants_count = excluded.participants_count,
			   winners_count = excluded.winners_count,
			   winners = excluded.winners,
			   drawn_at_ms = excluded.drawn_at_ms,
			   scheduled_draw_at_ms = excluded.scheduled_draw_at_ms,
			   red_packet_total_points = excluded.red_packet_total_points,
			   red_packet_total_slots = excluded.red_packet_total_slots,
			   red_packet_remaining_points = excluded.red_packet_remaining_points,
			   red_packet_remaining_slots = excluded.red_packet_remaining_slots,
			   red_packet_packets = excluded.red_packet_packets,
			   created_by = excluded.created_by,
			   created_at_ms = excluded.created_at_ms,
			   updated_at_ms = excluded.updated_at_ms,
			   updated_at = now()`,
			raffle.ID,
			raffle.Mode,
			raffle.Title,
			raffle.Description,
			nullableStringPtr(raffle.CoverImage),
			string(raffle.Prizes),
			raffle.TriggerType,
			raffle.Threshold,
			raffle.Status,
			raffle.ParticipantsCount,
			raffle.WinnersCount,
			string(raffle.Winners),
			nullableInt64Ptr(raffle.DrawnAt),
			nullableInt64Ptr(raffle.ScheduledDrawAt),
			nullableInt64Ptr(raffle.RedPacketTotalPoints),
			nullableInt64Ptr(raffle.RedPacketTotalSlots),
			nullableInt64Ptr(raffle.RedPacketRemainingPoints),
			nullableInt64Ptr(raffle.RedPacketRemainingSlots),
			string(raffle.RedPacketPackets),
			raffle.CreatedBy,
			raffle.CreatedAt,
			raffle.UpdatedAt,
		); err != nil {
			return result, fmt.Errorf("upsert raffle %s failed: %w", raffle.ID, err)
		}
		result.RafflesUpserted++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, err
	}
	return result, nil
}

func parseProjectImportRecord(key string, rawValue string) (ProjectImportRecord, []string, bool) {
	warnings := []string{}
	var raw rawProject
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return ProjectImportRecord{}, []string{fmt.Sprintf("跳过 %s：项目 JSON 解析失败：%v", key, err)}, false
	}

	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = strings.TrimPrefix(key, "projects:")
	}
	if id == "" {
		return ProjectImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少项目 ID", key)}, false
	}

	status := strings.TrimSpace(raw.Status)
	if !isValidProjectStatus(status) {
		return ProjectImportRecord{}, []string{fmt.Sprintf("跳过 projects:%s：无效项目状态 %q", id, status)}, false
	}

	rewardType := strings.TrimSpace(raw.RewardType)
	var rewardTypePtr *string
	if rewardType != "" {
		if !isValidProjectRewardType(rewardType) {
			warnings = append(warnings, fmt.Sprintf("projects:%s 忽略无效 rewardType %q", id, rewardType))
		} else {
			rewardTypePtr = &rewardType
		}
	}

	directPoints := positiveInt64FromRaw(raw.DirectPoints)
	if directPoints == nil {
		directPoints = roundedPositiveInt64FromRaw(raw.DirectDollars)
	}

	createdAt := int64FromRaw(raw.CreatedAt, nowMillis())
	return ProjectImportRecord{
		ID:           id,
		Name:         fallbackString(raw.Name, id),
		Description:  raw.Description,
		MaxClaims:    int64FromRaw(raw.MaxClaims, 0),
		ClaimedCount: int64FromRaw(raw.ClaimedCount, 0),
		CodesCount:   int64FromRaw(raw.CodesCount, 0),
		Status:       status,
		CreatedAt:    createdAt,
		CreatedBy:    stringFromRaw(raw.CreatedBy, ""),
		RewardType:   rewardTypePtr,
		DirectPoints: directPoints,
		NewUserOnly:  boolFromRaw(raw.NewUserOnly, false),
		Pinned:       boolFromRaw(raw.Pinned, false),
		PinnedAt:     positiveInt64FromRaw(raw.PinnedAt),
	}, warnings, true
}

func parseRaffleImportRecord(key string, rawValue string) (RaffleImportRecord, []string, bool) {
	var raw rawRaffle
	if err := decodeJSONObject(rawValue, &raw); err != nil {
		return RaffleImportRecord{}, []string{fmt.Sprintf("跳过 %s：抽奖 JSON 解析失败：%v", key, err)}, false
	}

	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = strings.TrimPrefix(key, "raffle:")
	}
	if id == "" {
		return RaffleImportRecord{}, []string{fmt.Sprintf("跳过 %s：缺少抽奖 ID", key)}, false
	}

	mode := fallbackString(strings.TrimSpace(raw.Mode), "draw")
	if !isValidRaffleMode(mode) {
		return RaffleImportRecord{}, []string{fmt.Sprintf("跳过 raffle:%s：无效活动模式 %q", id, mode)}, false
	}
	triggerType := fallbackString(strings.TrimSpace(raw.TriggerType), "threshold")
	if !isValidRaffleTriggerType(triggerType) {
		return RaffleImportRecord{}, []string{fmt.Sprintf("跳过 raffle:%s：无效开奖类型 %q", id, triggerType)}, false
	}
	status := strings.TrimSpace(raw.Status)
	if !isValidRaffleStatus(status) {
		return RaffleImportRecord{}, []string{fmt.Sprintf("跳过 raffle:%s：无效活动状态 %q", id, status)}, false
	}

	createdAt := int64FromRaw(raw.CreatedAt, nowMillis())
	updatedAt := int64FromRaw(raw.UpdatedAt, createdAt)
	return RaffleImportRecord{
		ID:                       id,
		Mode:                     mode,
		Title:                    fallbackString(raw.Title, id),
		Description:              raw.Description,
		CoverImage:               optionalString(raw.CoverImage),
		Prizes:                   normalizedJSONArray(raw.Prizes),
		TriggerType:              triggerType,
		Threshold:                int64FromRaw(raw.Threshold, 1),
		Status:                   status,
		ParticipantsCount:        int64FromRaw(raw.ParticipantsCount, 0),
		WinnersCount:             int64FromRaw(raw.WinnersCount, 0),
		Winners:                  normalizedJSONArray(raw.Winners),
		DrawnAt:                  positiveInt64FromRaw(raw.DrawnAt),
		ScheduledDrawAt:          positiveInt64FromRaw(raw.ScheduledDrawAt),
		RedPacketTotalPoints:     nonNegativeInt64FromRaw(raw.RedPacketTotalPoints),
		RedPacketTotalSlots:      nonNegativeInt64FromRaw(raw.RedPacketTotalSlots),
		RedPacketRemainingPoints: nonNegativeInt64FromRaw(raw.RedPacketRemainingPoints),
		RedPacketRemainingSlots:  nonNegativeInt64FromRaw(raw.RedPacketRemainingSlots),
		RedPacketPackets:         normalizedJSONArray(raw.RedPacketPackets),
		CreatedBy:                int64FromRaw(raw.CreatedBy, 0),
		CreatedAt:                createdAt,
		UpdatedAt:                updatedAt,
	}, nil, true
}

func decodeJSONObject(rawValue string, target any) error {
	decoder := json.NewDecoder(strings.NewReader(rawValue))
	decoder.UseNumber()
	return decoder.Decode(target)
}

func int64FromRaw(raw json.RawMessage, fallback int64) int64 {
	value, ok := numberFromRaw(raw)
	if !ok {
		return fallback
	}
	return value
}

func positiveInt64FromRaw(raw json.RawMessage) *int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value <= 0 {
		return nil
	}
	return &value
}

func nonNegativeInt64FromRaw(raw json.RawMessage) *int64 {
	value, ok := numberFromRaw(raw)
	if !ok || value < 0 {
		return nil
	}
	return &value
}

func roundedPositiveInt64FromRaw(raw json.RawMessage) *int64 {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}

	var asNumber json.Number
	if err := decodeJSONObject(string(raw), &asNumber); err == nil {
		if value, err := asNumber.Float64(); err == nil {
			rounded := int64(math.Round(value))
			if rounded > 0 {
				return &rounded
			}
		}
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		if value, err := json.Number(asString).Float64(); err == nil {
			rounded := int64(math.Round(value))
			if rounded > 0 {
				return &rounded
			}
		}
	}
	return nil
}

func numberFromRaw(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false
	}

	var asNumber json.Number
	if err := decodeJSONObject(string(raw), &asNumber); err == nil {
		value, err := asNumber.Int64()
		return value, err == nil
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		value, err := json.Number(asString).Int64()
		return value, err == nil
	}
	return 0, false
}

func stringFromRaw(raw json.RawMessage, fallback string) string {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return asString
	}
	var asNumber json.Number
	if err := decodeJSONObject(string(raw), &asNumber); err == nil {
		return asNumber.String()
	}
	return fallback
}

func boolFromRaw(raw json.RawMessage, fallback bool) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	return fallback
}

func normalizedJSONArray(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage("[]")
	}
	var array []any
	if err := json.Unmarshal(raw, &array); err != nil {
		return json.RawMessage("[]")
	}
	return raw
}

func optionalString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nullableStringPtr(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return *value
}

func nullableInt64Ptr(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func fallbackString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func isValidProjectStatus(status string) bool {
	return status == "active" || status == "paused" || status == "exhausted"
}

func isValidProjectRewardType(rewardType string) bool {
	return rewardType == "code" || rewardType == "direct"
}

func isValidRaffleMode(mode string) bool {
	return mode == "draw" || mode == "red_packet"
}

func isValidRaffleTriggerType(triggerType string) bool {
	return triggerType == "threshold" || triggerType == "manual" || triggerType == "scheduled"
}

func isValidRaffleStatus(status string) bool {
	return status == "draft" || status == "active" || status == "ended" || status == "cancelled"
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
