package profile

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type achievementDefinition struct {
	ID         string
	Emoji      string
	Name       string
	Desc       string
	UnlockMode string
	Series     string
	Shine      bool
}

var achievementDefinitions = []achievementDefinition{
	{ID: "beginner", Emoji: "🎯", Name: "初心者", Desc: "注册账户即解锁", UnlockMode: "auto", Shine: true},
	{ID: "first_checkin", Emoji: "🌅", Name: "首次签到", Desc: "完成首次签到", UnlockMode: "auto"},
	{ID: "checkin_3", Emoji: "🔥", Name: "连签 3 天", Desc: "连续签到 3 天", UnlockMode: "auto"},
	{ID: "checkin_7", Emoji: "⚡", Name: "连签 7 天", Desc: "连续签到 7 天", UnlockMode: "auto"},
	{ID: "checkin_30", Emoji: "💎", Name: "连签 30 天", Desc: "连续签到 30 天", UnlockMode: "auto"},
	{ID: "first_pot", Emoji: "💰", Name: "第一桶金", Desc: "积分余额达到 1000", UnlockMode: "auto", Series: "财富系列"},
	{ID: "small_success", Emoji: "💵", Name: "小有成绩", Desc: "积分余额达到 5000", UnlockMode: "auto", Series: "财富系列"},
	{ID: "tycoon", Emoji: "🏦", Name: "大富翁", Desc: "积分余额达到 10000", UnlockMode: "auto", Series: "财富系列", Shine: true},
	{ID: "card_beginner", Emoji: "🎴", Name: "卡牌入门", Desc: "收集 10 张卡牌", UnlockMode: "auto"},
	{ID: "card_collector", Emoji: "🃏", Name: "图鉴收藏", Desc: "收集 50 张卡牌", UnlockMode: "auto"},
	{ID: "collection_master", Emoji: "👑", Name: "收集大师", Desc: "完成所有图鉴", UnlockMode: "auto", Shine: true},
	{ID: "lottery_player", Emoji: "🎰", Name: "抽奖玩家", Desc: "参与过幸运抽奖", UnlockMode: "auto"},
	{ID: "contributor", Emoji: "🤝", Name: "奉献者", Desc: "提出 10 条或以上有用反馈后，由管理员颁发", UnlockMode: "admin"},
	{ID: "peak_first", Emoji: "🏔️", Name: "巅峰第一", Desc: "上个月风云榜月榜第一，结算后获得，30 天内有效", UnlockMode: "periodic", Shine: true},
	{ID: "game_king", Emoji: "🎮", Name: "游戏王", Desc: "用户游戏胜率达到 75% 以上", UnlockMode: "auto"},
	{ID: "farm_owner", Emoji: "🌾", Name: "农场主", Desc: "农场 8 块土地全部解锁", UnlockMode: "auto"},
	{ID: "lucky_star", Emoji: "🍊", Name: "幸运之星", Desc: "累计在每日幸运抽奖中抽到 100 次橙子", UnlockMode: "auto"},
	{ID: "unlucky_star", Emoji: "❤️", Name: "倒霉之星", Desc: "累计在每日幸运抽奖中抽到 100 次爱心", UnlockMode: "auto"},
	{ID: "eco_ambassador", Emoji: "🌱", Name: "环保大使", Desc: "在环保行动中累计回收 10000 个普通垃圾，奖品不计入", UnlockMode: "auto", Series: "环保行动"},
	{ID: "gold_digger", Emoji: "⛏️", Name: "淘金者", Desc: "在环保行动中累计拾取 10 个奖品", UnlockMode: "auto", Series: "环保行动"},
	{ID: "xiaoc_fan", Emoji: "📸", Name: "XiaoC忠实粉丝", Desc: "在环保行动中累计拾取 5 张照片", UnlockMode: "auto", Series: "环保行动", Shine: true},
	{ID: "thief", Emoji: "🕵️", Name: "小偷", Desc: "在环保行动偷盗奖品后被警察抓住，限时强制佩戴", UnlockMode: "auto", Series: "环保行动"},
}

func (service *Service) GetOverview(ctx context.Context, userID int64, username string, nowMs int64) (OverviewData, error) {
	if service.db == nil {
		return OverviewData{}, ErrUnavailable
	}

	settings, err := service.GetSettings(ctx, userID, nowMs)
	if err != nil {
		return OverviewData{}, err
	}
	points, err := service.overviewPoints(ctx, userID)
	if err != nil {
		return OverviewData{}, err
	}
	cards, err := service.overviewCards(ctx, userID)
	if err != nil {
		return OverviewData{}, err
	}
	gameplay, gameStats, err := service.overviewGameplay(ctx, userID)
	if err != nil {
		return OverviewData{}, err
	}
	notifications, err := service.overviewNotifications(ctx, userID)
	if err != nil {
		return OverviewData{}, err
	}
	ecoStats, err := service.overviewEcoStats(ctx, userID)
	if err != nil {
		return OverviewData{}, err
	}
	stats := OverviewAchievementStats{
		GameWinRate:            gameStats.GameWinRate,
		GameWinPlays:           gameStats.GameWinPlays,
		EcoLifetimeCleared:     ecoStats.EcoLifetimeCleared,
		EcoLifetimePrizeClaims: ecoStats.EcoLifetimePrizeClaims,
		EcoLifetimePhotoClaims: ecoStats.EcoLifetimePhotoClaims,
	}

	overview := OverviewData{
		User: OverviewUser{
			ID:                userID,
			Username:          username,
			CustomDisplayName: settings.DisplayName,
			CustomAvatarURL:   settings.AvatarURL,
			CustomQQEmail:     settings.QQEmail,
		},
		Points:           points,
		Cards:            cards,
		Gameplay:         gameplay,
		Notifications:    notifications,
		AchievementStats: stats,
	}
	achievements, err := service.buildAchievementSummary(ctx, userID, overview, nowMs)
	if err != nil {
		return OverviewData{}, err
	}
	overview.Achievements = achievements
	return overview, nil
}

func (service *Service) overviewPoints(ctx context.Context, userID int64) (OverviewPoints, error) {
	var points OverviewPoints
	err := service.db.QueryRow(ctx, `SELECT COALESCE(balance, 0) FROM point_accounts WHERE user_id = $1`, userID).Scan(&points.Balance)
	if errorsIsNoRows(err) {
		err = nil
	}
	if err != nil {
		return points, err
	}
	rows, err := service.db.Query(ctx,
		`SELECT amount, source, description, created_at
		   FROM point_ledger
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC
		  LIMIT 10`,
		userID,
	)
	if err != nil {
		return points, err
	}
	defer rows.Close()
	for rows.Next() {
		var row OverviewPointLog
		var createdAt time.Time
		if err := rows.Scan(&row.Amount, &row.Source, &row.Description, &createdAt); err != nil {
			return points, err
		}
		row.CreatedAt = millis(createdAt)
		points.RecentLogs = append(points.RecentLogs, row)
	}
	if points.RecentLogs == nil {
		points.RecentLogs = []OverviewPointLog{}
	}
	return points, rows.Err()
}

func (service *Service) overviewCards(ctx context.Context, userID int64) (OverviewCards, error) {
	cards := OverviewCards{Albums: []OverviewAlbum{}}
	err := service.db.QueryRow(ctx, `SELECT COALESCE(card_draws, 0) FROM user_assets WHERE user_id = $1`, userID).Scan(&cards.DrawsAvailable)
	if errorsIsNoRows(err) {
		return cards, nil
	}
	return cards, err
}

type overviewGameStats struct {
	GameWinRate  float64
	GameWinPlays int64
}

func (service *Service) overviewGameplay(ctx context.Context, userID int64) (OverviewGameplay, overviewGameStats, error) {
	gameplay := OverviewGameplay{RecentRecords: []OverviewRecentRecord{}}
	rows, err := service.db.Query(ctx,
		`SELECT game_type, score, points_earned, payload, created_at
		   FROM game_records
		  WHERE user_id = $1
		  ORDER BY created_at DESC, id DESC
		  LIMIT 200`,
		userID,
	)
	if err != nil {
		return gameplay, overviewGameStats{}, err
	}
	defer rows.Close()

	var plays int64
	var wins int64
	for rows.Next() {
		var record OverviewRecentRecord
		var payload []byte
		var createdAt time.Time
		if err := rows.Scan(&record.GameType, &record.Score, &record.PointsEarned, &payload, &createdAt); err != nil {
			return gameplay, overviewGameStats{}, err
		}
		record.CreatedAt = millis(createdAt)
		if len(gameplay.RecentRecords) < 10 {
			gameplay.RecentRecords = append(gameplay.RecentRecords, record)
		}
		if record.GameType != "lottery" {
			plays++
			if overviewRecordWon(record.GameType, record.Score, payload) {
				wins++
			}
		}
	}
	if err := rows.Err(); err != nil {
		return gameplay, overviewGameStats{}, err
	}
	stats := overviewGameStats{GameWinPlays: plays}
	if plays > 0 {
		stats.GameWinRate = float64(wins) / float64(plays)
	}
	return gameplay, stats, nil
}

func (service *Service) overviewNotifications(ctx context.Context, userID int64) (OverviewNotifications, error) {
	notifications := OverviewNotifications{Recent: []OverviewNotification{}}
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at_ms IS NULL`,
		userID,
	).Scan(&notifications.UnreadCount); err != nil {
		return notifications, err
	}
	rows, err := service.db.Query(ctx,
		`SELECT id, title, content, type, created_at_ms, read_at_ms IS NOT NULL
		   FROM notifications
		  WHERE user_id = $1
		  ORDER BY created_at_ms DESC, id DESC
		  LIMIT 5`,
		userID,
	)
	if err != nil {
		return notifications, err
	}
	defer rows.Close()
	for rows.Next() {
		var row OverviewNotification
		if err := rows.Scan(&row.ID, &row.Title, &row.Content, &row.Type, &row.CreatedAt, &row.IsRead); err != nil {
			return notifications, err
		}
		notifications.Recent = append(notifications.Recent, row)
	}
	return notifications, rows.Err()
}

func (service *Service) overviewEcoStats(ctx context.Context, userID int64) (OverviewAchievementStats, error) {
	var stats OverviewAchievementStats
	err := service.db.QueryRow(ctx,
		`SELECT COALESCE(lifetime_cleared, 0) FROM eco_states WHERE user_id = $1`,
		userID,
	).Scan(&stats.EcoLifetimeCleared)
	if errorsIsNoRows(err) {
		err = nil
	}
	if err != nil {
		return stats, err
	}
	if err := service.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(lifetime_claim_count), 0) FROM eco_prize_inventory WHERE user_id = $1`,
		userID,
	).Scan(&stats.EcoLifetimePrizeClaims); err != nil {
		return stats, err
	}
	if err := service.db.QueryRow(ctx,
		`SELECT COALESCE(lifetime_claim_count, 0) FROM eco_prize_inventory WHERE user_id = $1 AND prize_key = 'photo'`,
		userID,
	).Scan(&stats.EcoLifetimePhotoClaims); errorsIsNoRows(err) {
		return stats, nil
	} else if err != nil {
		return stats, err
	}
	return stats, nil
}

func (service *Service) buildAchievementSummary(ctx context.Context, userID int64, overview OverviewData, nowMs int64) (AchievementSummary, error) {
	autoIDs := automaticAchievementIDs(overview)
	if err := service.syncAutomaticAchievementGrants(ctx, userID, autoIDs, nowMs); err != nil {
		return AchievementSummary{}, err
	}
	grants, err := service.listAchievementGrants(ctx, userID)
	if err != nil {
		return AchievementSummary{}, err
	}
	equipped, err := service.GetEquippedAchievement(ctx, userID, nowMs)
	if err != nil {
		return AchievementSummary{}, err
	}
	var equippedID *string
	if equipped != nil {
		value := equipped.ID
		equippedID = &value
	}

	active := map[string]AchievementGrantPublic{}
	for _, grant := range grants {
		if grant.ExpiresAt == nil || *grant.ExpiresAt > nowMs {
			active[grant.ID] = grant
		}
	}
	items := make([]AchievementItem, 0, len(achievementDefinitions))
	for _, definition := range achievementDefinitions {
		grant, hasGrant := active[definition.ID]
		unlocked := autoIDs[definition.ID] || hasGrant
		item := AchievementItem{
			ID:         definition.ID,
			Emoji:      definition.Emoji,
			Name:       definition.Name,
			Desc:       definition.Desc,
			Unlocked:   unlocked,
			Shine:      definition.Shine && unlocked,
			Series:     definition.Series,
			UnlockMode: definition.UnlockMode,
			Equipped:   unlocked && equippedID != nil && *equippedID == definition.ID,
		}
		if hasGrant {
			grantedAt := grant.GrantedAt
			item.GrantedAt = &grantedAt
			item.ExpiresAt = grant.ExpiresAt
		}
		items = append(items, item)
	}
	return AchievementSummary{Grants: grants, EquippedID: equippedID, Equipped: equipped, Items: items}, nil
}

func (service *Service) syncAutomaticAchievementGrants(ctx context.Context, userID int64, ids map[string]bool, nowMs int64) error {
	for id := range ids {
		if _, err := service.db.Exec(ctx,
			`INSERT INTO user_achievement_grants (user_id, achievement_id, source, granted_at_ms, metadata, updated_at)
			 VALUES ($1, $2, 'auto', $3, '{}'::jsonb, now())
			 ON CONFLICT (user_id, achievement_id) DO UPDATE SET
			   source = 'auto',
			   granted_at_ms = LEAST(user_achievement_grants.granted_at_ms, excluded.granted_at_ms),
			   expires_at_ms = NULL,
			   updated_at = now()
			 WHERE user_achievement_grants.expires_at_ms IS NOT NULL`,
			userID,
			id,
			nowMs,
		); err != nil {
			return err
		}
	}
	return nil
}

func (service *Service) listAchievementGrants(ctx context.Context, userID int64) ([]AchievementGrantPublic, error) {
	rows, err := service.db.Query(ctx,
		`SELECT achievement_id, source, granted_at_ms, expires_at_ms, reason
		   FROM user_achievement_grants
		  WHERE user_id = $1
		  ORDER BY granted_at_ms DESC, achievement_id`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	grants := []AchievementGrantPublic{}
	for rows.Next() {
		var grant AchievementGrantPublic
		var expiresAt sql.NullInt64
		var reason sql.NullString
		if err := rows.Scan(&grant.ID, &grant.Source, &grant.GrantedAt, &expiresAt, &reason); err != nil {
			return nil, err
		}
		if expiresAt.Valid {
			grant.ExpiresAt = &expiresAt.Int64
		}
		grant.Reason = nullStringPtr(reason)
		grants = append(grants, grant)
	}
	return grants, rows.Err()
}

func automaticAchievementIDs(overview OverviewData) map[string]bool {
	ids := map[string]bool{"beginner": true}
	if overview.Points.Balance >= 1000 {
		ids["first_pot"] = true
	}
	if overview.Points.Balance >= 5000 {
		ids["small_success"] = true
	}
	if overview.Points.Balance >= 10000 {
		ids["tycoon"] = true
	}
	if overview.Cards.Owned >= 10 {
		ids["card_beginner"] = true
	}
	if overview.Cards.Owned >= 50 {
		ids["card_collector"] = true
	}
	if overview.Cards.CompletionRate >= 100 {
		ids["collection_master"] = true
	}
	for _, record := range overview.Gameplay.RecentRecords {
		if record.GameType == "lottery" {
			ids["lottery_player"] = true
			break
		}
	}
	if overview.AchievementStats.GameWinPlays > 0 && overview.AchievementStats.GameWinRate >= 0.75 {
		ids["game_king"] = true
	}
	if overview.AchievementStats.FarmUnlockedLands >= 8 {
		ids["farm_owner"] = true
	}
	if overview.AchievementStats.LotteryOrangeCount >= 100 {
		ids["lucky_star"] = true
	}
	if overview.AchievementStats.LotteryHeartCount >= 100 {
		ids["unlucky_star"] = true
	}
	if overview.AchievementStats.EcoLifetimeCleared >= 10000 {
		ids["eco_ambassador"] = true
	}
	if overview.AchievementStats.EcoLifetimePrizeClaims >= 10 {
		ids["gold_digger"] = true
	}
	if overview.AchievementStats.EcoLifetimePhotoClaims >= 5 {
		ids["xiaoc_fan"] = true
	}
	return ids
}

func overviewRecordWon(gameType string, score int64, payload []byte) bool {
	var data map[string]any
	_ = json.Unmarshal(payload, &data)
	for _, key := range []string{"completed", "won", "escaped"} {
		if value, ok := data[key].(bool); ok && value {
			return true
		}
	}
	switch gameType {
	case "match3":
		return score >= 1200
	case "whack_mole":
		return score >= 300
	default:
		return false
	}
}

func errorsIsNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows)
}

func millis(value time.Time) int64 {
	return value.UnixMilli()
}
