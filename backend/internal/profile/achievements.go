package profile

import "database/sql"

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

func PublicAchievementByID(id string, expiresAt sql.NullInt64) *PublicAchievement {
	achievement, ok := publicAchievements[id]
	if !ok {
		return nil
	}
	if expiresAt.Valid {
		achievement.ExpiresAt = &expiresAt.Int64
	}
	return &achievement
}

func IsAchievementID(id string) bool {
	_, ok := publicAchievements[id]
	return ok
}
