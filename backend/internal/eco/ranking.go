package eco

import (
	"context"
	"database/sql"
	"strings"
)

type TrashRankingPeriod string

const (
	TrashRankingDaily   TrashRankingPeriod = "daily"
	TrashRankingWeekly  TrashRankingPeriod = "weekly"
	TrashRankingMonthly TrashRankingPeriod = "monthly"
)

type TrashLeaderboardResult struct {
	Period            TrashRankingPeriod      `json:"period"`
	PeriodKey         string                  `json:"periodKey"`
	GeneratedAt       int64                   `json:"generatedAt"`
	TotalParticipants int64                   `json:"totalParticipants"`
	Leaderboard       []TrashLeaderboardEntry `json:"leaderboard"`
}

type TrashLeaderboardEntry struct {
	Rank                int64              `json:"rank"`
	UserID              int64              `json:"userId"`
	Username            string             `json:"username"`
	DisplayName         *string            `json:"displayName"`
	AvatarURL           *string            `json:"avatarUrl"`
	EquippedAchievement *PublicAchievement `json:"equippedAchievement"`
	TrashCleared        int64              `json:"trashCleared"`
}

type PublicAchievement struct {
	ID        string `json:"id"`
	Emoji     string `json:"emoji"`
	Name      string `json:"name"`
	Desc      string `json:"desc"`
	ExpiresAt *int64 `json:"expiresAt,omitempty"`
}

var publicAchievements = map[string]PublicAchievement{
	"beginner":          {ID: "beginner", Emoji: "🎯", Name: "初心者", Desc: "注册账户即解锁"},
	"first_checkin":     {ID: "first_checkin", Emoji: "🌅", Name: "首次签到", Desc: "完成首次签到"},
	"checkin_3":         {ID: "checkin_3", Emoji: "🔥", Name: "连签 3 天", Desc: "连续签到 3 天"},
	"checkin_7":         {ID: "checkin_7", Emoji: "⚡", Name: "连签 7 天", Desc: "连续签到 7 天"},
	"checkin_30":        {ID: "checkin_30", Emoji: "💎", Name: "连签 30 天", Desc: "连续签到 30 天"},
	"first_pot":         {ID: "first_pot", Emoji: "💰", Name: "第一桶金", Desc: "积分余额达到 1000"},
	"small_success":     {ID: "small_success", Emoji: "💵", Name: "小有成绩", Desc: "积分余额达到 5000"},
	"tycoon":            {ID: "tycoon", Emoji: "🏦", Name: "大富翁", Desc: "积分余额达到 10000"},
	"card_beginner":     {ID: "card_beginner", Emoji: "🎴", Name: "卡牌入门", Desc: "收集 10 张卡牌"},
	"card_collector":    {ID: "card_collector", Emoji: "🃏", Name: "图鉴收藏", Desc: "收集 50 张卡牌"},
	"collection_master": {ID: "collection_master", Emoji: "👑", Name: "收集大师", Desc: "完成所有图鉴"},
	"lottery_player":    {ID: "lottery_player", Emoji: "🎰", Name: "抽奖玩家", Desc: "参与过幸运抽奖"},
	"contributor":       {ID: "contributor", Emoji: "🤝", Name: "奉献者", Desc: "提出 10 条或以上有用反馈后，由管理员颁发"},
	"peak_first":        {ID: "peak_first", Emoji: "🏔️", Name: "巅峰第一", Desc: "上个月风云榜月榜第一，结算后获得，30 天内有效"},
	"game_king":         {ID: "game_king", Emoji: "🎮", Name: "游戏王", Desc: "用户游戏胜率达到 75% 以上"},
	"farm_owner":        {ID: "farm_owner", Emoji: "🌾", Name: "农场主", Desc: "农场 8 块土地全部解锁"},
	"lucky_star":        {ID: "lucky_star", Emoji: "🍊", Name: "幸运之星", Desc: "累计在每日幸运抽奖中抽到 100 次橙子"},
	"unlucky_star":      {ID: "unlucky_star", Emoji: "❤️", Name: "倒霉之星", Desc: "累计在每日幸运抽奖中抽到 100 次爱心"},
	"eco_ambassador":    {ID: "eco_ambassador", Emoji: "🌱", Name: "环保大使", Desc: "在环保行动中累计回收 10000 个普通垃圾，奖品不计入"},
	"gold_digger":       {ID: "gold_digger", Emoji: "⛏️", Name: "淘金者", Desc: "在环保行动中累计拾取 10 个奖品"},
	"xiaoc_fan":         {ID: "xiaoc_fan", Emoji: "📸", Name: "XiaoC忠实粉丝", Desc: "在环保行动中累计拾取 5 张照片"},
	"thief":             {ID: "thief", Emoji: "🕵️", Name: "小偷", Desc: "在环保行动偷盗奖品后被警察抓住，限时强制佩戴"},
}

func (service *Service) GetTrashLeaderboard(ctx context.Context, period string, limit int64, nowMs int64) (TrashLeaderboardResult, error) {
	if nowMs <= 0 {
		nowMs = nowMillis()
	}
	safePeriod := normalizeTrashRankingPeriod(period)
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	periodKey := trashRankingPeriodKey(safePeriod, nowMs)

	var totalParticipants int64
	if err := service.db.QueryRow(ctx,
		`SELECT COUNT(*)
		   FROM eco_trash_rankings
		  WHERE period = $1
		    AND period_key = $2
		    AND trash_cleared > 0`,
		safePeriod,
		periodKey,
	).Scan(&totalParticipants); err != nil {
		return TrashLeaderboardResult{}, err
	}

	rows, err := service.db.Query(ctx,
		`SELECT r.user_id, r.trash_cleared, u.username, u.display_name,
		        equipped.achievement_id, equipped.expires_at_ms
		   FROM eco_trash_rankings r
		   JOIN users u ON u.id = r.user_id
		   LEFT JOIN LATERAL (
		     SELECT candidate.achievement_id, grant_row.expires_at_ms
		       FROM (
		         SELECT f.achievement_id, 0 AS priority
		           FROM user_forced_achievements f
		          WHERE f.user_id = r.user_id
		            AND f.until_ms > $4
		         UNION ALL
		         SELECT e.achievement_id, 1 AS priority
		           FROM user_equipped_achievements e
		          WHERE e.user_id = r.user_id
		       ) candidate
		       JOIN user_achievement_grants grant_row
		         ON grant_row.user_id = r.user_id
		        AND grant_row.achievement_id = candidate.achievement_id
		        AND (grant_row.expires_at_ms IS NULL OR grant_row.expires_at_ms > $4)
		      ORDER BY candidate.priority
		      LIMIT 1
		   ) equipped ON true
		  WHERE r.period = $1
		    AND r.period_key = $2
		    AND r.trash_cleared > 0
		  ORDER BY r.trash_cleared DESC, r.user_id ASC
		  LIMIT $3`,
		safePeriod,
		periodKey,
		limit,
		nowMs,
	)
	if err != nil {
		return TrashLeaderboardResult{}, err
	}
	defer rows.Close()

	leaderboard := []TrashLeaderboardEntry{}
	rank := int64(1)
	for rows.Next() {
		var entry TrashLeaderboardEntry
		var username string
		var displayName string
		var achievementID sql.NullString
		var achievementExpiresAt sql.NullInt64
		if err := rows.Scan(
			&entry.UserID,
			&entry.TrashCleared,
			&username,
			&displayName,
			&achievementID,
			&achievementExpiresAt,
		); err != nil {
			return TrashLeaderboardResult{}, err
		}
		entry.Rank = rank
		entry.Username = fallbackUsername(entry.UserID, username)
		if strings.TrimSpace(displayName) != "" && displayName != username {
			entry.DisplayName = ptrString(displayName)
		}
		if achievementID.Valid {
			achievement := publicAchievementByID(achievementID.String, achievementExpiresAt)
			entry.EquippedAchievement = achievement
		}
		leaderboard = append(leaderboard, entry)
		rank++
	}
	if err := rows.Err(); err != nil {
		return TrashLeaderboardResult{}, err
	}

	return TrashLeaderboardResult{
		Period:            safePeriod,
		PeriodKey:         periodKey,
		GeneratedAt:       nowMs,
		TotalParticipants: totalParticipants,
		Leaderboard:       leaderboard,
	}, nil
}

func normalizeTrashRankingPeriod(period string) TrashRankingPeriod {
	switch TrashRankingPeriod(strings.TrimSpace(period)) {
	case TrashRankingWeekly:
		return TrashRankingWeekly
	case TrashRankingMonthly:
		return TrashRankingMonthly
	default:
		return TrashRankingDaily
	}
}

func trashRankingPeriodKey(period TrashRankingPeriod, nowMs int64) string {
	switch period {
	case TrashRankingWeekly:
		return chinaWeekKey(nowMs)
	case TrashRankingMonthly:
		return chinaMonthKey(nowMs)
	default:
		return chinaDateKey(nowMs)
	}
}

func fallbackUsername(userID int64, username string) string {
	username = strings.TrimSpace(username)
	if username != "" {
		return username
	}
	return "#" + intString(userID)
}

func publicAchievementByID(id string, expiresAt sql.NullInt64) *PublicAchievement {
	achievement, ok := publicAchievements[id]
	if !ok {
		return nil
	}
	if expiresAt.Valid {
		achievement.ExpiresAt = ptrInt64(expiresAt.Int64)
	}
	return &achievement
}
