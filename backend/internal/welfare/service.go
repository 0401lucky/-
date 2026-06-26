package welfare

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrRaffleNotFound = errors.New("raffle not found")

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) ListProjects(ctx context.Context) ([]Project, error) {
	rows, err := service.db.Query(ctx,
		`SELECT id, name, description, max_claims, claimed_count, codes_count,
		        status, created_at_ms, created_by, reward_type, direct_points,
		        new_user_only, pinned, pinned_at_ms, auto_pause_at_ms, auto_paused_at_ms
		 FROM projects
		 WHERE status <> 'paused'
		 ORDER BY pinned DESC, pinned_at_ms DESC NULLS LAST, created_at_ms DESC, id DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	projects := make([]Project, 0)
	for rows.Next() {
		var project Project
		var rewardType sql.NullString
		var directPoints sql.NullInt64
		var pinnedAt sql.NullInt64
		var autoPauseAt sql.NullInt64
		var autoPausedAt sql.NullInt64
		if err := rows.Scan(
			&project.ID,
			&project.Name,
			&project.Description,
			&project.MaxClaims,
			&project.ClaimedCount,
			&project.CodesCount,
			&project.Status,
			&project.CreatedAt,
			&project.CreatedBy,
			&rewardType,
			&directPoints,
			&project.NewUserOnly,
			&project.Pinned,
			&pinnedAt,
			&autoPauseAt,
			&autoPausedAt,
		); err != nil {
			return nil, err
		}
		if rewardType.Valid {
			project.RewardType = rewardType.String
		}
		if directPoints.Valid {
			project.DirectPoints = &directPoints.Int64
		}
		if pinnedAt.Valid {
			project.PinnedAt = &pinnedAt.Int64
		}
		if autoPauseAt.Valid {
			project.AutoPauseAt = &autoPauseAt.Int64
		}
		if autoPausedAt.Valid {
			project.AutoPausedAt = &autoPausedAt.Int64
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (service *Service) ListRaffles(ctx context.Context, filter RaffleListFilter) ([]RaffleListItem, error) {
	status := filter.Status
	if filter.ActiveOnly {
		status = "active"
	}

	rows, err := service.db.Query(ctx,
		`SELECT id, mode, title, description, COALESCE(cover_image, ''),
		        prizes, trigger_type, threshold, status, participants_count,
		        winners_count, drawn_at_ms, red_packet_total_points,
		        red_packet_total_slots, red_packet_remaining_points,
		        red_packet_remaining_slots, created_at_ms
		 FROM raffles
		 WHERE ($1 = '' OR status = $1)
		   AND status IN ('active', 'ended')
		 ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at_ms DESC, id DESC
		 LIMIT 50`,
		status,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	raffles := make([]RaffleListItem, 0)
	for rows.Next() {
		var raffle RaffleListItem
		var prizes []byte
		var drawnAt sql.NullInt64
		var redPacketTotalPoints sql.NullInt64
		var redPacketTotalSlots sql.NullInt64
		var redPacketRemainingPoints sql.NullInt64
		var redPacketRemainingSlots sql.NullInt64
		if err := rows.Scan(
			&raffle.ID,
			&raffle.Mode,
			&raffle.Title,
			&raffle.Description,
			&raffle.CoverImage,
			&prizes,
			&raffle.TriggerType,
			&raffle.Threshold,
			&raffle.Status,
			&raffle.ParticipantsCount,
			&raffle.WinnersCount,
			&drawnAt,
			&redPacketTotalPoints,
			&redPacketTotalSlots,
			&redPacketRemainingPoints,
			&redPacketRemainingSlots,
			&raffle.CreatedAt,
		); err != nil {
			return nil, err
		}
		raffle.Prizes = normalizeRawJSON(prizes)
		raffle.DrawnAt = nullableInt64(drawnAt)
		raffle.RedPacketTotalPoints = nullableInt64(redPacketTotalPoints)
		raffle.RedPacketTotalSlots = nullableInt64(redPacketTotalSlots)
		raffle.RedPacketRemainingPoints = nullableInt64(redPacketRemainingPoints)
		raffle.RedPacketRemainingSlots = nullableInt64(redPacketRemainingSlots)
		raffles = append(raffles, raffle)
	}
	return raffles, rows.Err()
}

func (service *Service) ListAdminRaffles(ctx context.Context, status string) ([]AdminRaffle, error) {
	status = strings.TrimSpace(status)
	rows, err := service.db.Query(ctx,
		`SELECT id, mode, title, description, COALESCE(cover_image, ''),
		        prizes, trigger_type, threshold, status, participants_count,
		        winners_count, winners, drawn_at_ms, red_packet_total_points,
		        red_packet_total_slots, red_packet_remaining_points,
		        red_packet_remaining_slots, red_packet_packets, created_by,
		        created_at_ms, updated_at_ms
		 FROM raffles
		 WHERE ($1 = '' OR status = $1)
		 ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at_ms DESC, id DESC
		 LIMIT 100`,
		status,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	raffles := make([]AdminRaffle, 0)
	for rows.Next() {
		raffle, err := scanAdminRaffle(rows)
		if err != nil {
			return nil, err
		}
		raffles = append(raffles, raffle)
	}
	return raffles, rows.Err()
}

func (service *Service) GetAdminRaffleDetail(ctx context.Context, id string) (AdminRaffle, []RaffleEntry, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return AdminRaffle{}, nil, ErrRaffleNotFound
	}

	row := service.db.QueryRow(ctx,
		`SELECT id, mode, title, description, COALESCE(cover_image, ''),
		        prizes, trigger_type, threshold, status, participants_count,
		        winners_count, winners, drawn_at_ms, red_packet_total_points,
		        red_packet_total_slots, red_packet_remaining_points,
		        red_packet_remaining_slots, red_packet_packets, created_by,
		        created_at_ms, updated_at_ms
		 FROM raffles
		 WHERE id = $1`,
		id,
	)
	raffle, err := scanAdminRaffle(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return AdminRaffle{}, nil, ErrRaffleNotFound
	}
	if err != nil {
		return AdminRaffle{}, nil, err
	}

	entries, err := service.listRaffleEntries(ctx, id, 100)
	if err != nil {
		return AdminRaffle{}, nil, err
	}
	return raffle, entries, nil
}

func (service *Service) GetRaffleDetail(ctx context.Context, id string, userID *int64) (RaffleDetailResult, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return RaffleDetailResult{}, ErrRaffleNotFound
	}

	detail, fullWinners, err := service.getPublicRaffleDetail(ctx, id)
	if err != nil {
		return RaffleDetailResult{}, err
	}
	entries, err := service.listRaffleEntries(ctx, id, 50)
	if err != nil {
		return RaffleDetailResult{}, err
	}

	var userStatus *UserRaffleStatus
	if userID != nil && *userID > 0 {
		status, err := service.getUserRaffleStatus(ctx, id, *userID, fullWinners)
		if err != nil {
			return RaffleDetailResult{}, err
		}
		userStatus = &status
	}

	return RaffleDetailResult{
		Raffle:     detail,
		Entries:    entries,
		UserStatus: userStatus,
	}, nil
}

func (service *Service) GetRaffleMode(ctx context.Context, raffleID string) (string, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" {
		return "", ErrRaffleNotFound
	}

	var mode string
	err := service.db.QueryRow(ctx,
		`SELECT mode FROM raffles WHERE id = $1`,
		raffleID,
	).Scan(&mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrRaffleNotFound
	}
	if err != nil {
		return "", err
	}
	if mode == "red_packet" {
		return mode, nil
	}
	return "draw", nil
}

func (service *Service) JoinRaffle(ctx context.Context, raffleID string, user auth.User) (JoinRaffleResult, error) {
	raffleID = strings.TrimSpace(raffleID)
	if raffleID == "" || user.ID <= 0 {
		return JoinRaffleResult{Success: false, Message: "参数错误"}, nil
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return JoinRaffleResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var mode string
	var status string
	var triggerType string
	var threshold int64
	var currentParticipantsCount int64
	err = tx.QueryRow(ctx,
		`SELECT mode, status, trigger_type, threshold, participants_count
		 FROM raffles
		 WHERE id = $1
		 FOR UPDATE`,
		raffleID,
	).Scan(&mode, &status, &triggerType, &threshold, &currentParticipantsCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return JoinRaffleResult{}, ErrRaffleNotFound
	}
	if err != nil {
		return JoinRaffleResult{}, err
	}

	if mode == "red_packet" {
		return JoinRaffleResult{Success: false, Message: "请使用抢红包入口参与活动"}, tx.Commit(ctx)
	}
	switch status {
	case "active":
	case "draft":
		return JoinRaffleResult{Success: false, Message: "活动尚未开始"}, tx.Commit(ctx)
	case "ended":
		return JoinRaffleResult{Success: false, Message: "活动已结束"}, tx.Commit(ctx)
	case "cancelled":
		return JoinRaffleResult{Success: false, Message: "活动已取消"}, tx.Commit(ctx)
	default:
		return JoinRaffleResult{Success: false, Message: "活动状态异常"}, tx.Commit(ctx)
	}

	existing, err := service.getRaffleEntryForUserTx(ctx, tx, raffleID, user.ID)
	if err == nil {
		return JoinRaffleResult{
			Success: false,
			Message: "您已经参与过了",
			Entry:   &existing,
		}, tx.Commit(ctx)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return JoinRaffleResult{}, err
	}

	entryNumber, err := nextRaffleEntryNumber(ctx, tx, raffleID, currentParticipantsCount)
	if err != nil {
		return JoinRaffleResult{}, err
	}

	now := time.Now()
	entry := RaffleEntry{
		ID:          newRaffleEntryID(now),
		RaffleID:    raffleID,
		UserID:      user.ID,
		Username:    fallbackString(user.Username, fmt.Sprintf("user-%d", user.ID)),
		EntryNumber: entryNumber,
		CreatedAt:   millis(now),
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO raffle_entries (id, raffle_id, user_id, username, entry_number, created_at_ms)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		entry.ID,
		entry.RaffleID,
		entry.UserID,
		entry.Username,
		entry.EntryNumber,
		entry.CreatedAt,
	); err != nil {
		return JoinRaffleResult{}, err
	}

	var participantsCount int64
	if err := tx.QueryRow(ctx,
		`UPDATE raffles
		 SET participants_count = GREATEST(
		       participants_count + 1,
		       (SELECT COUNT(*) FROM raffle_entries WHERE raffle_id = $1)
		     ),
		     updated_at_ms = $2,
		     updated_at = now()
		 WHERE id = $1
		 RETURNING participants_count`,
		raffleID,
		entry.CreatedAt,
	).Scan(&participantsCount); err != nil {
		return JoinRaffleResult{}, err
	}

	result := JoinRaffleResult{
		Success:    true,
		Message:    "参与成功",
		Entry:      &entry,
		ShouldDraw: triggerType == "threshold" && participantsCount >= threshold,
	}
	if err := tx.Commit(ctx); err != nil {
		return JoinRaffleResult{}, err
	}
	return result, nil
}

func (service *Service) getPublicRaffleDetail(ctx context.Context, id string) (RaffleDetail, json.RawMessage, error) {
	row := service.db.QueryRow(ctx,
		`SELECT id, mode, title, description, COALESCE(cover_image, ''),
		        prizes, trigger_type, threshold, status, participants_count,
		        winners_count, winners, drawn_at_ms, red_packet_total_points,
		        red_packet_total_slots, red_packet_remaining_points,
		        red_packet_remaining_slots, created_at_ms
		 FROM raffles
		 WHERE id = $1 AND status <> 'draft'`,
		id,
	)

	var detail RaffleDetail
	var prizes []byte
	var winners []byte
	var drawnAt sql.NullInt64
	var redPacketTotalPoints sql.NullInt64
	var redPacketTotalSlots sql.NullInt64
	var redPacketRemainingPoints sql.NullInt64
	var redPacketRemainingSlots sql.NullInt64
	err := row.Scan(
		&detail.ID,
		&detail.Mode,
		&detail.Title,
		&detail.Description,
		&detail.CoverImage,
		&prizes,
		&detail.TriggerType,
		&detail.Threshold,
		&detail.Status,
		&detail.ParticipantsCount,
		&detail.WinnersCount,
		&winners,
		&drawnAt,
		&redPacketTotalPoints,
		&redPacketTotalSlots,
		&redPacketRemainingPoints,
		&redPacketRemainingSlots,
		&detail.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return RaffleDetail{}, nil, ErrRaffleNotFound
	}
	if err != nil {
		return RaffleDetail{}, nil, err
	}

	fullWinners := normalizeRawJSON(winners)
	detail.Prizes = normalizeRawJSON(prizes)
	detail.DrawnAt = nullableInt64(drawnAt)
	detail.RedPacketTotalPoints = nullableInt64(redPacketTotalPoints)
	detail.RedPacketTotalSlots = nullableInt64(redPacketTotalSlots)
	detail.RedPacketRemainingPoints = nullableInt64(redPacketRemainingPoints)
	detail.RedPacketRemainingSlots = nullableInt64(redPacketRemainingSlots)
	if detail.Status == "ended" {
		detail.Winners = fullWinners
	}
	return detail, fullWinners, nil
}

func (service *Service) listRaffleEntries(ctx context.Context, raffleID string, limit int) ([]RaffleEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := service.db.Query(ctx,
		`SELECT id, raffle_id, user_id, username, entry_number, created_at_ms
		 FROM raffle_entries
		 WHERE raffle_id = $1
		 ORDER BY created_at_ms DESC, entry_number DESC
		 LIMIT $2`,
		raffleID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]RaffleEntry, 0)
	for rows.Next() {
		var entry RaffleEntry
		if err := rows.Scan(
			&entry.ID,
			&entry.RaffleID,
			&entry.UserID,
			&entry.Username,
			&entry.EntryNumber,
			&entry.CreatedAt,
		); err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (service *Service) getUserRaffleStatus(ctx context.Context, raffleID string, userID int64, winners json.RawMessage) (UserRaffleStatus, error) {
	entry, err := service.getRaffleEntryForUser(ctx, raffleID, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return UserRaffleStatus{HasJoined: false, IsWinner: false}, nil
	}
	if err != nil {
		return UserRaffleStatus{}, err
	}

	prize, isWinner := findRaffleWinnerForUser(winners, userID)
	return UserRaffleStatus{
		HasJoined: true,
		Entry:     &entry,
		IsWinner:  isWinner,
		Prize:     prize,
	}, nil
}

func (service *Service) getRaffleEntryForUser(ctx context.Context, raffleID string, userID int64) (RaffleEntry, error) {
	return service.getRaffleEntryForUserTx(ctx, service.db, raffleID, userID)
}

func (service *Service) getRaffleEntryForUserTx(ctx context.Context, querier pgxQuerier, raffleID string, userID int64) (RaffleEntry, error) {
	var entry RaffleEntry
	err := querier.QueryRow(ctx,
		`SELECT id, raffle_id, user_id, username, entry_number, created_at_ms
		 FROM raffle_entries
		 WHERE raffle_id = $1 AND user_id = $2`,
		raffleID,
		userID,
	).Scan(
		&entry.ID,
		&entry.RaffleID,
		&entry.UserID,
		&entry.Username,
		&entry.EntryNumber,
		&entry.CreatedAt,
	)
	return entry, err
}

func scanAdminRaffle(row pgxScanner) (AdminRaffle, error) {
	var raffle AdminRaffle
	var prizes []byte
	var winners []byte
	var packets []byte
	var drawnAt sql.NullInt64
	var redPacketTotalPoints sql.NullInt64
	var redPacketTotalSlots sql.NullInt64
	var redPacketRemainingPoints sql.NullInt64
	var redPacketRemainingSlots sql.NullInt64
	err := row.Scan(
		&raffle.ID,
		&raffle.Mode,
		&raffle.Title,
		&raffle.Description,
		&raffle.CoverImage,
		&prizes,
		&raffle.TriggerType,
		&raffle.Threshold,
		&raffle.Status,
		&raffle.ParticipantsCount,
		&raffle.WinnersCount,
		&winners,
		&drawnAt,
		&redPacketTotalPoints,
		&redPacketTotalSlots,
		&redPacketRemainingPoints,
		&redPacketRemainingSlots,
		&packets,
		&raffle.CreatedBy,
		&raffle.CreatedAt,
		&raffle.UpdatedAt,
	)
	if err != nil {
		return AdminRaffle{}, err
	}
	raffle.Prizes = normalizeRawJSON(prizes)
	raffle.Winners = normalizeRawJSON(winners)
	raffle.RedPacketPackets = normalizeRawJSON(packets)
	raffle.DrawnAt = nullableInt64(drawnAt)
	raffle.RedPacketTotalPoints = nullableInt64(redPacketTotalPoints)
	raffle.RedPacketTotalSlots = nullableInt64(redPacketTotalSlots)
	raffle.RedPacketRemainingPoints = nullableInt64(redPacketRemainingPoints)
	raffle.RedPacketRemainingSlots = nullableInt64(redPacketRemainingSlots)
	return raffle, nil
}

type pgxQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type pgxScanner interface {
	Scan(dest ...any) error
}

func findRaffleWinnerForUser(winners json.RawMessage, userID int64) (json.RawMessage, bool) {
	if len(winners) == 0 || !json.Valid(winners) {
		return nil, false
	}
	var items []json.RawMessage
	if err := json.Unmarshal(winners, &items); err != nil {
		return nil, false
	}
	for _, item := range items {
		var probe struct {
			UserID int64 `json:"userId"`
		}
		if err := json.Unmarshal(item, &probe); err == nil && probe.UserID == userID {
			return item, true
		}
	}
	return nil, false
}

func normalizeRawJSON(raw []byte) json.RawMessage {
	if len(raw) == 0 || !json.Valid(raw) {
		return json.RawMessage("[]")
	}
	return json.RawMessage(raw)
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nextRaffleEntryNumber(ctx context.Context, tx pgx.Tx, raffleID string, currentParticipantsCount int64) (int64, error) {
	var next int64
	err := tx.QueryRow(ctx,
		`SELECT GREATEST(COALESCE(MAX(entry_number), 0), $2::bigint) + 1
		 FROM raffle_entries
		 WHERE raffle_id = $1`,
		raffleID,
		currentParticipantsCount,
	).Scan(&next)
	return next, err
}

func newRaffleEntryID(now time.Time) string {
	var buffer [8]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return fmt.Sprintf("entry_%d", now.UnixNano())
	}
	return fmt.Sprintf("entry_%d_%s", millis(now), hex.EncodeToString(buffer[:]))
}

func fallbackString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func millis(value time.Time) int64 {
	return value.UnixNano() / int64(time.Millisecond)
}
