package adminusers

import "database/sql"

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
	{ID: "eco_ambassador", Emoji: "🌱", Name: "环保大使", Desc: "在环保行动中累计回收 10000 个普通垃圾，奖品不计入", UnlockMode: "auto", Series: "环保行动", Shine: true},
	{ID: "gold_digger", Emoji: "⛏️", Name: "淘金者", Desc: "在环保行动中累计拾取 10 个奖品", UnlockMode: "auto", Series: "环保行动"},
	{ID: "xiaoc_fan", Emoji: "📸", Name: "XiaoC忠实粉丝", Desc: "在环保行动中累计拾取 5 张照片", UnlockMode: "auto", Series: "环保行动", Shine: true},
	{ID: "thief", Emoji: "🕵️", Name: "小偷", Desc: "在环保行动偷盗奖品后被警察抓住，限时强制佩戴", UnlockMode: "auto", Series: "环保行动"},
}

func validAchievementID(id string) bool {
	for _, definition := range achievementDefinitions {
		if definition.ID == id {
			return true
		}
	}
	return false
}

func nullableMillis(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}
