package adminusers

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strings"
	"time"

	"redemption/backend/internal/auth"
	"redemption/backend/internal/cards"

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

func (service *Service) ListUsers(ctx context.Context, page int64, limit int64, search string, status string) (ListUsersResult, error) {
	page = normalizePositive(page, 1, 100000)
	limit = normalizePositive(limit, 20, 100)
	search = strings.TrimSpace(search)
	status = normalizeStatus(status)
	pattern := "%" + strings.ToLower(search) + "%"
	offset := (page - 1) * limit
	dayStart := chinaDayStart(time.Now())

	var total int64
	if err := service.db.QueryRow(ctx,
		`WITH claim_counts AS (
		     SELECT user_id, COUNT(*)::bigint AS count
		       FROM exchange_logs
		      WHERE type = 'project_direct'
		      GROUP BY user_id
		   ),
		   filtered AS (
		     SELECT u.id, COALESCE(c.count, 0)::bigint AS claims_count
		       FROM users u
		       LEFT JOIN claim_counts c ON c.user_id = u.id
		      WHERE ($1 = '' OR lower(u.username) LIKE $2 OR u.id::text LIKE $2)
		   )
		 SELECT COUNT(*)::bigint
		   FROM filtered
		  WHERE ($3 = 'all')
		     OR ($3 = 'new' AND claims_count = 0)
		     OR ($3 = 'claimed' AND claims_count > 0)`,
		search,
		pattern,
		status,
	).Scan(&total); err != nil {
		return ListUsersResult{}, err
	}

	rows, err := service.db.Query(ctx,
		`WITH claim_counts AS (
		     SELECT user_id, COUNT(*)::bigint AS count
		       FROM exchange_logs
		      WHERE type = 'project_direct'
		      GROUP BY user_id
		   ),
		   lottery_counts AS (
		     SELECT user_id, COUNT(*)::bigint AS count
		       FROM raffle_entries
		      GROUP BY user_id
		   ),
		   today_games AS (
		     SELECT user_id,
		            COUNT(*)::bigint AS games_played,
		            COALESCE(SUM(points_earned), 0)::bigint AS points_earned,
		            floor(extract(epoch from MAX(created_at)) * 1000)::bigint AS latest_game_at_ms
		       FROM game_records
		      WHERE created_at >= $4
		      GROUP BY user_id
		   ),
		   latest_points AS (
		     SELECT DISTINCT ON (user_id)
		            user_id,
		            amount,
		            floor(extract(epoch from created_at) * 1000)::bigint AS created_at_ms
		       FROM point_ledger
		      ORDER BY user_id, created_at DESC, id DESC
		   ),
		   last_claims AS (
		     SELECT user_id,
		            floor(extract(epoch from MAX(created_at)) * 1000)::bigint AS claimed_at_ms
		       FROM exchange_logs
		      WHERE type = 'project_direct'
		      GROUP BY user_id
		   ),
		   last_lotteries AS (
		     SELECT user_id, MAX(created_at_ms)::bigint AS lottery_at_ms
		       FROM raffle_entries
		      GROUP BY user_id
		   )
		 SELECT u.id,
		        u.username,
		        floor(extract(epoch from u.first_seen_at) * 1000)::bigint AS first_seen_ms,
		        COALESCE(c.count, 0)::bigint AS claims_count,
		        COALESCE(l.count, 0)::bigint AS lottery_count,
		        COALESCE(pa.balance, 0)::bigint AS points_balance,
		        COALESCE(g.games_played, 0)::bigint AS today_games_played,
		        COALESCE(g.points_earned, 0)::bigint AS today_points_earned,
		        lp.amount AS latest_point_change,
		        lp.created_at_ms AS latest_point_change_at,
		        lc.claimed_at_ms AS last_claim_at,
		        ll.lottery_at_ms AS last_lottery_at,
		        GREATEST(
		          floor(extract(epoch from u.first_seen_at) * 1000)::bigint,
		          COALESCE(lp.created_at_ms, 0),
		          COALESCE(lc.claimed_at_ms, 0),
		          COALESCE(ll.lottery_at_ms, 0),
		          COALESCE(g.latest_game_at_ms, 0)
		        )::bigint AS last_activity_at
		   FROM users u
		   LEFT JOIN claim_counts c ON c.user_id = u.id
		   LEFT JOIN lottery_counts l ON l.user_id = u.id
		   LEFT JOIN point_accounts pa ON pa.user_id = u.id
		   LEFT JOIN today_games g ON g.user_id = u.id
		   LEFT JOIN latest_points lp ON lp.user_id = u.id
		   LEFT JOIN last_claims lc ON lc.user_id = u.id
		   LEFT JOIN last_lotteries ll ON ll.user_id = u.id
		  WHERE ($1 = '' OR lower(u.username) LIKE $2 OR u.id::text LIKE $2)
		    AND (
		      $3 = 'all'
		      OR ($3 = 'new' AND COALESCE(c.count, 0) = 0)
		      OR ($3 = 'claimed' AND COALESCE(c.count, 0) > 0)
		    )
		  ORDER BY u.first_seen_at DESC, u.id DESC
		  LIMIT $5 OFFSET $6`,
		search,
		pattern,
		status,
		dayStart,
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
		var latestPointChange sql.NullInt64
		var latestPointChangeAt sql.NullInt64
		var lastClaimAt sql.NullInt64
		var lastLotteryAt sql.NullInt64
		if err := rows.Scan(
			&user.ID,
			&user.Username,
			&user.FirstSeen,
			&user.ClaimsCount,
			&user.LotteryCount,
			&user.PointsBalance,
			&user.TodayGamesPlayed,
			&user.TodayPointsEarned,
			&latestPointChange,
			&latestPointChangeAt,
			&lastClaimAt,
			&lastLotteryAt,
			&user.LastActivityAt,
		); err != nil {
			return ListUsersResult{}, err
		}
		user.IsNewUser = user.ClaimsCount == 0
		user.LatestPointChange = nullableInt64(latestPointChange)
		user.LatestPointChangeAt = nullableInt64(latestPointChangeAt)
		user.LastClaimAt = nullableInt64(lastClaimAt)
		user.LastLotteryAt = nullableInt64(lastLotteryAt)
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
	user, err := service.getDetailUser(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	overview, err := service.getProfileOverview(ctx, user)
	if err != nil {
		return UserDetail{}, err
	}
	claims, err := service.listClaimRecords(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	lotteryRecords, err := service.listLotteryRecords(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	exchangeLogs, err := service.listExchangeLogs(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	achievements, err := service.ListAchievements(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	return UserDetail{
		User:           user,
		Overview:       overview,
		Claims:         claims,
		LotteryRecords: lotteryRecords,
		ExchangeLogs:   exchangeLogs,
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
		      WHERE type = 'project_direct'
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

func (service *Service) getDetailUser(ctx context.Context, userID int64) (UserDetailUser, error) {
	row := service.db.QueryRow(ctx,
		`WITH project_claims AS (
		     SELECT e.user_id,
		            COUNT(*)::bigint AS claims_count,
		            (array_agg(e.item_id ORDER BY e.created_at DESC, e.id DESC))[1] AS latest_project_id,
		            floor(extract(epoch from MAX(e.created_at)) * 1000)::bigint AS latest_claimed_at_ms
		       FROM exchange_logs e
		      WHERE e.type = 'project_direct'
		      GROUP BY e.user_id
		   )
		 SELECT u.id,
		        u.username,
		        floor(extract(epoch from u.first_seen_at) * 1000)::bigint AS first_seen_ms,
		        NULLIF(COALESCE(up.display_name, u.display_name), '') AS display_name,
		        NULLIF(up.avatar_url, '') AS avatar_url,
		        NULLIF(up.qq_email, '') AS qq_email,
		        COALESCE(pc.claims_count, 0)::bigint AS claims_count,
		        pc.latest_project_id,
		        pc.latest_claimed_at_ms
		   FROM users u
		   LEFT JOIN user_profiles up ON up.user_id = u.id
		   LEFT JOIN project_claims pc ON pc.user_id = u.id
		  WHERE u.id = $1`,
		userID,
	)

	var user UserDetailUser
	var displayName sql.NullString
	var avatarURL sql.NullString
	var qqEmail sql.NullString
	var claimsCount int64
	var projectID sql.NullString
	var claimedAt sql.NullInt64
	if err := row.Scan(
		&user.ID,
		&user.Username,
		&user.FirstSeen,
		&displayName,
		&avatarURL,
		&qqEmail,
		&claimsCount,
		&projectID,
		&claimedAt,
	); errors.Is(err, pgx.ErrNoRows) {
		return UserDetailUser{}, ErrUserNotFound
	} else if err != nil {
		return UserDetailUser{}, err
	}

	user.DisplayName = nullableString(displayName)
	user.AvatarURL = nullableString(avatarURL)
	user.QQEmail = nullableString(qqEmail)
	user.IsNewUser = claimsCount == 0
	user.NewUserStatus = "eligible"
	if !user.IsNewUser {
		user.NewUserStatus = "claimed"
		user.NewUserProjectID = nullableString(projectID)
		user.NewUserClaimedAt = nullableInt64(claimedAt)
	}
	return user, nil
}

func (service *Service) getProfileOverview(ctx context.Context, user UserDetailUser) (ProfileOverview, error) {
	points, err := service.getPointsOverview(ctx, user.ID)
	if err != nil {
		return ProfileOverview{}, err
	}
	cardsOverview, err := service.getCardsOverview(ctx, user.ID)
	if err != nil {
		return ProfileOverview{}, err
	}
	gameplay, err := service.getGameplayOverview(ctx, user.ID)
	if err != nil {
		return ProfileOverview{}, err
	}
	notifications, err := service.getNotificationsOverview(ctx, user.ID)
	if err != nil {
		return ProfileOverview{}, err
	}
	return ProfileOverview{
		User: ProfileUserOverview{
			ID:                user.ID,
			Username:          user.Username,
			CustomDisplayName: user.DisplayName,
			CustomAvatarURL:   user.AvatarURL,
			CustomQQEmail:     user.QQEmail,
		},
		Points:        points,
		Cards:         cardsOverview,
		Gameplay:      gameplay,
		Notifications: notifications,
	}, nil
}

func (service *Service) getPointsOverview(ctx context.Context, userID int64) (ProfilePointsOverview, error) {
	var overview ProfilePointsOverview
	if err := service.db.QueryRow(ctx, `SELECT COALESCE((SELECT balance FROM point_accounts WHERE user_id = $1), 0)::bigint`, userID).Scan(&overview.Balance); err != nil {
		return ProfilePointsOverview{}, err
	}
	rows, err := service.db.Query(ctx,
		`SELECT amount, source, description, floor(extract(epoch from created_at) * 1000)::bigint
		   FROM point_ledger
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC
		  LIMIT 10`,
		userID,
	)
	if err != nil {
		return ProfilePointsOverview{}, err
	}
	defer rows.Close()

	overview.RecentLogs = []ProfilePointLogItem{}
	for rows.Next() {
		var item ProfilePointLogItem
		if err := rows.Scan(&item.Amount, &item.Source, &item.Description, &item.CreatedAt); err != nil {
			return ProfilePointsOverview{}, err
		}
		overview.RecentLogs = append(overview.RecentLogs, item)
	}
	return overview, rows.Err()
}

func (service *Service) getCardsOverview(ctx context.Context, userID int64) (ProfileCardsOverview, error) {
	total := int64(len(cards.AllCards()))
	if total <= 0 {
		total = 1
	}
	overview := ProfileCardsOverview{Total: total}
	err := service.db.QueryRow(ctx,
		`SELECT COALESCE(jsonb_array_length(inventory), 0)::bigint,
		        fragments,
		        draws_available
		   FROM card_user_states
		  WHERE user_id = $1`,
		userID,
	).Scan(&overview.Owned, &overview.Fragments, &overview.DrawsAvailable)
	if errors.Is(err, pgx.ErrNoRows) {
		return overview, nil
	}
	if err != nil {
		return ProfileCardsOverview{}, err
	}
	overview.CompletionRate = int64(math.Round(float64(overview.Owned) * 100 / float64(total)))
	return overview, nil
}

func (service *Service) getGameplayOverview(ctx context.Context, userID int64) (ProfileGameplayOverview, error) {
	totalCheckins, streak, err := service.getCheckinSummary(ctx, userID)
	if err != nil {
		return ProfileGameplayOverview{}, err
	}
	records, err := service.listRecentGameRecords(ctx, userID)
	if err != nil {
		return ProfileGameplayOverview{}, err
	}
	return ProfileGameplayOverview{
		CheckinStreak:    streak,
		TotalCheckinDays: totalCheckins,
		RecentRecords:    records,
	}, nil
}

func (service *Service) getCheckinSummary(ctx context.Context, userID int64) (int64, int64, error) {
	rows, err := service.db.Query(ctx,
		`SELECT checkin_date::text
		   FROM checkin_records
		  WHERE user_id = $1
		  ORDER BY checkin_date DESC
		  LIMIT 366`,
		userID,
	)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	dates := map[string]struct{}{}
	var total int64
	for rows.Next() {
		var date string
		if err := rows.Scan(&date); err != nil {
			return 0, 0, err
		}
		dates[date] = struct{}{}
		total++
	}
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	chinaToday := time.Now().UTC().Add(8 * time.Hour)
	expected := time.Date(chinaToday.Year(), chinaToday.Month(), chinaToday.Day(), 0, 0, 0, 0, time.UTC)
	var streak int64
	for {
		if _, ok := dates[expected.Format("2006-01-02")]; !ok {
			break
		}
		streak++
		expected = expected.AddDate(0, 0, -1)
	}
	return total, streak, nil
}

func (service *Service) listRecentGameRecords(ctx context.Context, userID int64) ([]ProfileGameRecord, error) {
	rows, err := service.db.Query(ctx,
		`SELECT game_type,
		        score,
		        points_earned,
		        floor(extract(epoch from created_at) * 1000)::bigint
		   FROM game_records
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC
		  LIMIT 10`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []ProfileGameRecord{}
	for rows.Next() {
		var record ProfileGameRecord
		if err := rows.Scan(&record.GameType, &record.Score, &record.PointsEarned, &record.CreatedAt); err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (service *Service) getNotificationsOverview(ctx context.Context, userID int64) (ProfileNotificationsOverview, error) {
	var overview ProfileNotificationsOverview
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)::bigint
		   FROM notifications
		  WHERE user_id = $1 AND read_at_ms IS NULL`,
		userID,
	).Scan(&overview.UnreadCount); err != nil {
		return ProfileNotificationsOverview{}, err
	}
	rows, err := service.db.Query(ctx,
		`SELECT id, title, content, type, created_at_ms, read_at_ms IS NOT NULL
		   FROM notifications
		  WHERE user_id = $1
		  ORDER BY created_at_ms DESC, id DESC
		  LIMIT 10`,
		userID,
	)
	if err != nil {
		return ProfileNotificationsOverview{}, err
	}
	defer rows.Close()

	overview.Recent = []ProfileNoticeItem{}
	for rows.Next() {
		var item ProfileNoticeItem
		if err := rows.Scan(&item.ID, &item.Title, &item.Content, &item.Type, &item.CreatedAt, &item.IsRead); err != nil {
			return ProfileNotificationsOverview{}, err
		}
		overview.Recent = append(overview.Recent, item)
	}
	return overview, rows.Err()
}

func (service *Service) listClaimRecords(ctx context.Context, userID int64) ([]ClaimRecord, error) {
	rows, err := service.db.Query(ctx,
		`SELECT e.id, e.item_id, COALESCE(p.name, e.item_name), e.user_id, u.username,
		        e.value,
		        floor(extract(epoch from e.created_at) * 1000)::bigint AS claimed_at_ms
		   FROM exchange_logs e
		   JOIN users u ON u.id = e.user_id
		   LEFT JOIN projects p ON p.id = e.item_id
		  WHERE e.user_id = $1
		    AND e.type = 'project_direct'
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
		var creditedPoints int64
		if err := rows.Scan(&claim.ID, &claim.ProjectID, &claim.ProjectName, &claim.UserID, &claim.Username, &creditedPoints, &claim.ClaimedAt); err != nil {
			return nil, err
		}
		claim.DirectCredit = true
		claim.CreditedPoints = &creditedPoints
		claim.CreditStatus = "success"
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

func (service *Service) listExchangeLogs(ctx context.Context, userID int64) ([]ExchangeLog, error) {
	rows, err := service.db.Query(ctx,
		`SELECT id,
		        user_id,
		        item_id,
		        item_name,
		        points_cost,
		        value,
		        type,
		        floor(extract(epoch from created_at) * 1000)::bigint
		   FROM exchange_logs
		  WHERE user_id = $1
		    AND type <> 'project_direct'
		  ORDER BY created_at DESC, id DESC
		  LIMIT 100`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	logs := []ExchangeLog{}
	for rows.Next() {
		var log ExchangeLog
		if err := rows.Scan(&log.ID, &log.UserID, &log.ItemID, &log.ItemName, &log.PointsCost, &log.Value, &log.Type, &log.CreatedAt); err != nil {
			return nil, err
		}
		logs = append(logs, log)
	}
	return logs, rows.Err()
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

func normalizeStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "new", "claimed":
		return strings.TrimSpace(status)
	default:
		return "all"
	}
}

func chinaDayStart(reference time.Time) time.Time {
	china := reference.UTC().Add(8 * time.Hour)
	return time.Date(china.Year(), china.Month(), china.Day(), 0, 0, 0, 0, time.UTC).Add(-8 * time.Hour)
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := strings.TrimSpace(value.String)
	if text == "" {
		return nil
	}
	return &text
}

func totalPages(total int64, limit int64) int64 {
	if total <= 0 || limit <= 0 {
		return 0
	}
	return (total + limit - 1) / limit
}
