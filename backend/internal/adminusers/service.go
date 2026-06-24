package adminusers

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"redemption/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidInput           = errors.New("invalid input")
	ErrUserNotFound           = errors.New("user not found")
	ErrUnsupportedAchievement = errors.New("unsupported achievement")
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (service *Service) ListUsers(ctx context.Context, page int64, limit int64, search string) (ListUsersResult, error) {
	page = normalizePositive(page, 1, 100000)
	limit = normalizePositive(limit, 50, 100)
	search = strings.TrimSpace(search)
	pattern := "%" + strings.ToLower(search) + "%"
	offset := (page - 1) * limit

	var total int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)
		   FROM users u
		  WHERE ($1 = '' OR lower(u.username) LIKE $2 OR u.id::text LIKE $2)`,
		search,
		pattern,
	).Scan(&total); err != nil {
		return ListUsersResult{}, err
	}

	rows, err := service.db.Query(ctx,
		`WITH claim_counts AS (
		     SELECT user_id, COUNT(*)::bigint AS count
		       FROM exchange_logs
		      GROUP BY user_id
		   ),
		   lottery_counts AS (
		     SELECT user_id, COUNT(*)::bigint AS count
		       FROM raffle_entries
		      GROUP BY user_id
		   )
		 SELECT u.id,
		        u.username,
		        floor(extract(epoch from u.first_seen_at) * 1000)::bigint AS first_seen_ms,
		        COALESCE(c.count, 0)::bigint AS claims_count,
		        COALESCE(l.count, 0)::bigint AS lottery_count
		   FROM users u
		   LEFT JOIN claim_counts c ON c.user_id = u.id
		   LEFT JOIN lottery_counts l ON l.user_id = u.id
		  WHERE ($1 = '' OR lower(u.username) LIKE $2 OR u.id::text LIKE $2)
		  ORDER BY u.first_seen_at DESC, u.id DESC
		  LIMIT $3 OFFSET $4`,
		search,
		pattern,
		limit,
		offset,
	)
	if err != nil {
		return ListUsersResult{}, err
	}
	defer rows.Close()

	users := make([]UserWithStats, 0)
	for rows.Next() {
		var user UserWithStats
		if err := rows.Scan(&user.ID, &user.Username, &user.FirstSeen, &user.ClaimsCount, &user.LotteryCount); err != nil {
			return ListUsersResult{}, err
		}
		user.IsNewUser = user.ClaimsCount == 0
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return ListUsersResult{}, err
	}

	result := ListUsersResult{
		Users: users,
		Pagination: Pagination{
			Page:       page,
			Limit:      limit,
			Total:      total,
			TotalPages: totalPages(total, limit),
			HasMore:    offset+int64(len(users)) < total,
		},
	}
	if page == 1 {
		stats, err := service.userStats(ctx, search, pattern)
		if err != nil {
			return ListUsersResult{}, err
		}
		result.Stats = &stats
	}
	return result, nil
}

func (service *Service) GetUserDetail(ctx context.Context, userID int64) (UserDetail, error) {
	if userID <= 0 {
		return UserDetail{}, ErrInvalidInput
	}
	exists, err := service.userExists(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	if !exists {
		return UserDetail{}, ErrUserNotFound
	}

	claims, err := service.listClaimRecords(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	lotteryRecords, err := service.listLotteryRecords(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	achievements, err := service.ListAchievements(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	return UserDetail{
		Claims:         claims,
		LotteryRecords: lotteryRecords,
		Achievements:   achievements,
	}, nil
}

func (service *Service) ListAchievements(ctx context.Context, userID int64) ([]AchievementItem, error) {
	grants, err := service.activeGrantMap(ctx, userID)
	if err != nil {
		return nil, err
	}
	equippedID, err := service.equippedAchievementID(ctx, userID)
	if err != nil {
		return nil, err
	}

	items := make([]AchievementItem, 0, len(achievementDefinitions))
	for _, definition := range achievementDefinitions {
		grant, unlocked := grants[definition.ID]
		item := AchievementItem{
			ID:         definition.ID,
			Emoji:      definition.Emoji,
			Name:       definition.Name,
			Desc:       definition.Desc,
			UnlockMode: definition.UnlockMode,
			Unlocked:   unlocked,
			Shine:      definition.Shine && unlocked,
			Series:     definition.Series,
			Equipped:   unlocked && equippedID == definition.ID,
		}
		if unlocked {
			item.GrantedAt = nullableMillis(grant.GrantedAt)
			item.ExpiresAt = nullableMillis(grant.ExpiresAt)
		}
		items = append(items, item)
	}
	return items, nil
}

func (service *Service) SetAchievement(ctx context.Context, userID int64, achievementID string, action string, admin auth.User, reason string) ([]AchievementItem, error) {
	if userID <= 0 {
		return nil, ErrInvalidInput
	}
	if achievementID != "contributor" || !validAchievementID(achievementID) {
		return nil, ErrUnsupportedAchievement
	}
	exists, err := service.userExists(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrUserNotFound
	}

	switch action {
	case "grant", "":
		if strings.TrimSpace(reason) == "" {
			reason = "管理员确认该用户提出 10 条或以上有用反馈"
		}
		adminName := strings.TrimSpace(admin.Username)
		if adminName == "" {
			adminName = "admin"
		}
		now := time.Now().UnixMilli()
		if _, err := service.db.Exec(ctx,
			`INSERT INTO user_achievement_grants (
			   user_id, achievement_id, source, granted_at_ms, expires_at_ms,
			   reason, granted_by_user_id, granted_by_username, metadata,
			   created_at, updated_at
			 )
			 VALUES ($1, $2, 'admin', $3, NULL, $4, NULL, $5, '{}'::jsonb, now(), now())
			 ON CONFLICT (user_id, achievement_id) DO UPDATE SET
			   source = excluded.source,
			   reason = excluded.reason,
			   granted_by_username = excluded.granted_by_username,
			   expires_at_ms = NULL,
			   updated_at = now()`,
			userID,
			achievementID,
			now,
			reason,
			adminName,
		); err != nil {
			return nil, err
		}
	case "revoke":
		if _, err := service.db.Exec(ctx,
			`DELETE FROM user_achievement_grants
			  WHERE user_id = $1 AND achievement_id = $2`,
			userID,
			achievementID,
		); err != nil {
			return nil, err
		}
		if _, err := service.db.Exec(ctx,
			`DELETE FROM user_equipped_achievements
			  WHERE user_id = $1 AND achievement_id = $2`,
			userID,
			achievementID,
		); err != nil {
			return nil, err
		}
	default:
		return nil, ErrInvalidInput
	}

	return service.ListAchievements(ctx, userID)
}

func (service *Service) userStats(ctx context.Context, search string, pattern string) (StatsSummary, error) {
	var stats StatsSummary
	err := service.db.QueryRow(ctx,
		`WITH filtered AS (
		     SELECT u.id
		       FROM users u
		      WHERE ($1 = '' OR lower(u.username) LIKE $2 OR u.id::text LIKE $2)
		   ),
		   claimed AS (
		     SELECT DISTINCT user_id
		       FROM exchange_logs
		   )
		 SELECT COUNT(f.id)::bigint,
		        COUNT(f.id) FILTER (WHERE c.user_id IS NULL)::bigint,
		        COUNT(f.id) FILTER (WHERE c.user_id IS NOT NULL)::bigint
		   FROM filtered f
		   LEFT JOIN claimed c ON c.user_id = f.id`,
		search,
		pattern,
	).Scan(&stats.Total, &stats.NewUserCount, &stats.ClaimedUserCount)
	return stats, err
}

func (service *Service) listClaimRecords(ctx context.Context, userID int64) ([]ClaimRecord, error) {
	rows, err := service.db.Query(ctx,
		`SELECT e.id, e.item_id, e.item_name, e.user_id, u.username,
		        floor(extract(epoch from e.created_at) * 1000)::bigint AS claimed_at_ms
		   FROM exchange_logs e
		   JOIN users u ON u.id = e.user_id
		  WHERE e.user_id = $1
		  ORDER BY e.created_at DESC, e.id DESC
		  LIMIT 100`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	claims := make([]ClaimRecord, 0)
	for rows.Next() {
		var claim ClaimRecord
		if err := rows.Scan(&claim.ID, &claim.ProjectID, &claim.ProjectName, &claim.UserID, &claim.Username, &claim.ClaimedAt); err != nil {
			return nil, err
		}
		claims = append(claims, claim)
	}
	return claims, rows.Err()
}

func (service *Service) listLotteryRecords(ctx context.Context, userID int64) ([]LotteryRecord, error) {
	rows, err := service.db.Query(ctx,
		`SELECT e.id, e.raffle_id, e.username, r.title, e.created_at_ms
		   FROM raffle_entries e
		   JOIN raffles r ON r.id = e.raffle_id
		  WHERE e.user_id = $1
		  ORDER BY e.created_at_ms DESC, e.entry_number DESC
		  LIMIT 100`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]LotteryRecord, 0)
	for rows.Next() {
		var record LotteryRecord
		if err := rows.Scan(&record.ID, &record.OderID, &record.Username, &record.TierName, &record.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

type grantRow struct {
	GrantedAt sql.NullInt64
	ExpiresAt sql.NullInt64
}

func (service *Service) activeGrantMap(ctx context.Context, userID int64) (map[string]grantRow, error) {
	rows, err := service.db.Query(ctx,
		`SELECT achievement_id, granted_at_ms, expires_at_ms
		   FROM user_achievement_grants
		  WHERE user_id = $1
		    AND (expires_at_ms IS NULL OR expires_at_ms > $2)`,
		userID,
		time.Now().UnixMilli(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	grants := map[string]grantRow{}
	for rows.Next() {
		var id string
		var grant grantRow
		if err := rows.Scan(&id, &grant.GrantedAt, &grant.ExpiresAt); err != nil {
			return nil, err
		}
		grants[id] = grant
	}
	return grants, rows.Err()
}

func (service *Service) equippedAchievementID(ctx context.Context, userID int64) (string, error) {
	var forcedID string
	var untilMs int64
	err := service.db.QueryRow(ctx,
		`SELECT achievement_id, until_ms
		   FROM user_forced_achievements
		  WHERE user_id = $1`,
		userID,
	).Scan(&forcedID, &untilMs)
	if err == nil {
		if untilMs > time.Now().UnixMilli() {
			return forcedID, nil
		}
		_, _ = service.db.Exec(ctx, `DELETE FROM user_forced_achievements WHERE user_id = $1`, userID)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	var equippedID string
	err = service.db.QueryRow(ctx,
		`SELECT achievement_id
		   FROM user_equipped_achievements
		  WHERE user_id = $1`,
		userID,
	).Scan(&equippedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return equippedID, err
}

func (service *Service) userExists(ctx context.Context, userID int64) (bool, error) {
	var exists bool
	err := service.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists)
	return exists, err
}

func normalizePositive(value int64, fallback int64, maxValue int64) int64 {
	if value <= 0 {
		return fallback
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func totalPages(total int64, limit int64) int64 {
	if total <= 0 || limit <= 0 {
		return 0
	}
	return (total + limit - 1) / limit
}
