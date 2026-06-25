package farm

type shopItemDef struct {
	Key                string
	Name               string
	Cost               int64
	DailyLimit         int64
	DurationMinutes    int64
	SpeedReduceMinutes int64
}

type ShopItem struct {
	Key                string `json:"key"`
	Name               string `json:"name"`
	Emoji              string `json:"emoji"`
	Category           string `json:"category"`
	Cost               int64  `json:"cost"`
	Description        string `json:"description"`
	DailyLimit         *int64 `json:"dailyLimit,omitempty"`
	DurationMinutes    *int64 `json:"durationMinutes,omitempty"`
	SpeedReduceMinutes *int64 `json:"speedReduceMinutes,omitempty"`
}

type shopItemMeta struct {
	Emoji       string
	Category    string
	Description string
}

var shopItemOrder = []string{
	"fert_normal",
	"fert_medium",
	"fert_premium",
	"scarecrow",
	"birdnet",
	"bell",
	"firework",
	"cloud_bottle",
	"speed_normal",
	"speed_premium",
	"weather_tv",
	"pet_food_normal",
	"pet_food_premium",
	"pet_water_basic",
	"pet_milk",
	"pet_coconut",
	"pet_care_basic",
	"pet_vitamin",
	"pet_supplement",
	"pet_rest_basic",
	"pet_nest",
	"pet_blanket",
	"pet_wash",
	"pet_play_basic",
	"pet_yarn_ball",
	"pet_frisbee",
	"pet_toy",
	"pet_skill_water",
	"pet_skill_guard",
	"pet_skill_chase_crow",
	"pet_skill_steal",
	"pet_skill_harvest",
	"pet_skill_plant",
	"last_supper",
}

var shopItemMetas = map[string]shopItemMeta{
	"fert_normal":          {Emoji: "🌱", Category: "fertilizer", Description: "成长时间 -10%，金星概率 +5%"},
	"fert_medium":          {Emoji: "🌿", Category: "fertilizer", Description: "成长时间 -20%，银星 +10%，金星 +10%"},
	"fert_premium":         {Emoji: "🌳", Category: "fertilizer", Description: "成长时间 -35%，银星 +15%，金星 +20%"},
	"scarecrow":            {Emoji: "👻", Category: "protection", Description: "12 小时内，全场乌鸦出现概率降为 40%"},
	"birdnet":              {Emoji: "🕸️", Category: "protection", Description: "指定 1 块土地 6 小时免疫乌鸦"},
	"bell":                 {Emoji: "🔔", Category: "protection", Description: "6 小时内偷菜成功率 -50%"},
	"firework":             {Emoji: "🎆", Category: "protection", Description: "立即驱散当前出现的乌鸦事件"},
	"cloud_bottle":         {Emoji: "🌧️", Category: "speed", Description: "立即给所有未成熟作物浇水"},
	"speed_normal":         {Emoji: "⏩", Category: "speed", Description: "指定作物剩余成长 -10 分钟"},
	"speed_premium":        {Emoji: "🚀", Category: "speed", Description: "指定作物剩余成长 -30 分钟"},
	"weather_tv":           {Emoji: "📺", Category: "special", Description: "永久解锁电视机按钮，可查看明日天气预报"},
	"pet_food_normal":      {Emoji: "🍖", Category: "pet", Description: "饱食明显提升，情绪略微变好，成长 +5"},
	"pet_food_premium":     {Emoji: "🥩", Category: "pet", Description: "饱食大幅提升，情绪和健康变好，成长 +12"},
	"pet_water_basic":      {Emoji: "💧", Category: "pet", Description: "免费的基础喂水，口渴值 +35"},
	"pet_milk":             {Emoji: "🥛", Category: "pet", Description: "口渴值 +45，并补充少量饱食和情绪"},
	"pet_coconut":          {Emoji: "🥥", Category: "pet", Description: "口渴值 +65，并增加健康和情绪"},
	"pet_care_basic":       {Emoji: "🩺", Category: "pet", Description: "免费基础保养，健康 +12，情绪 +3"},
	"pet_vitamin":          {Emoji: "💊", Category: "pet", Description: "健康 +25，情绪 +5"},
	"pet_supplement":       {Emoji: "🧪", Category: "pet", Description: "健康 +45，情绪 +8，并补充饱食 +10"},
	"pet_rest_basic":       {Emoji: "😴", Category: "pet", Description: "免费休息，体力 +20，情绪 +2"},
	"pet_nest":             {Emoji: "🛏️", Category: "pet", Description: "体力 +35，情绪 +5，健康 +3"},
	"pet_blanket":          {Emoji: "🧣", Category: "pet", Description: "体力 +55，情绪 +8，健康 +5"},
	"pet_wash":             {Emoji: "🛁", Category: "pet", Description: "体力 +35，情绪和健康变好，成长 +4"},
	"pet_play_basic":       {Emoji: "🤲", Category: "pet", Description: "免费陪玩，情绪 +12、健康 +4，但消耗饱食 -5、体力 -5、口渴值 -6"},
	"pet_yarn_ball":        {Emoji: "🧶", Category: "pet", Description: "情绪 +20、健康 +7，消耗饱食 -8、体力 -8、口渴值 -10"},
	"pet_frisbee":          {Emoji: "🥏", Category: "pet", Description: "情绪 +30、健康 +12，消耗饱食 -12、体力 -12、口渴值 -14"},
	"pet_toy":              {Emoji: "🎾", Category: "pet", Description: "情绪大幅变好，健康 +4，但会降低少量口渴值、消耗体力"},
	"pet_skill_water":      {Emoji: "📘", Category: "pet", Description: "成年宠物学习后，可派遣自动浇水 3 小时；同一只宠物同技能只能学习一次"},
	"pet_skill_guard":      {Emoji: "📗", Category: "pet", Description: "成年宠物学习后，可守护庄园降低乌鸦和偷菜风险；同一只宠物同技能只能学习一次"},
	"pet_skill_chase_crow": {Emoji: "📙", Category: "pet", Description: "成年宠物学习后，可主动赶走乌鸦 4 小时；同一只宠物同技能只能学习一次"},
	"pet_skill_steal":      {Emoji: "📕", Category: "pet", Description: "成年宠物学习后，可前往好友庄园偷菜；同一只宠物同技能只能学习一次"},
	"pet_skill_harvest":    {Emoji: "📒", Category: "pet", Description: "成年宠物学习后，成熟作物会自动收获；同一只宠物同技能只能学习一次"},
	"pet_skill_plant":      {Emoji: "📔", Category: "pet", Description: "成年宠物学习后，会自动挑选当前季节高收益种子播种空地；同一只宠物同技能只能学习一次"},
	"last_supper":          {Emoji: "🍽️", Category: "pet", Description: "当前宠物离开庄园，之后可重新领养宠物"},
}

var shopItemDefs = map[string]shopItemDef{
	"fert_normal":          {Key: "fert_normal", Name: "普通肥料", Cost: 20},
	"fert_medium":          {Key: "fert_medium", Name: "中级肥料", Cost: 45},
	"fert_premium":         {Key: "fert_premium", Name: "高级肥料", Cost: 80},
	"scarecrow":            {Key: "scarecrow", Name: "稻草人", Cost: 100, DurationMinutes: 12 * 60},
	"birdnet":              {Key: "birdnet", Name: "防鸟网", Cost: 50, DurationMinutes: 6 * 60},
	"bell":                 {Key: "bell", Name: "看守铃铛", Cost: 80, DurationMinutes: 6 * 60},
	"firework":             {Key: "firework", Name: "驱鸟烟花", Cost: 30},
	"cloud_bottle":         {Key: "cloud_bottle", Name: "云朵瓶", Cost: 40},
	"speed_normal":         {Key: "speed_normal", Name: "加速券", Cost: 30, SpeedReduceMinutes: 10},
	"speed_premium":        {Key: "speed_premium", Name: "高级加速", Cost: 70, SpeedReduceMinutes: 30},
	"weather_tv":           {Key: "weather_tv", Name: "天气电视机", Cost: 120},
	"pet_food_normal":      {Key: "pet_food_normal", Name: "普通宠粮", Cost: 15, DailyLimit: 3},
	"pet_food_premium":     {Key: "pet_food_premium", Name: "高级宠粮", Cost: 40, DailyLimit: 1},
	"pet_water_basic":      {Key: "pet_water_basic", Name: "清水", Cost: 0},
	"pet_milk":             {Key: "pet_milk", Name: "牛奶", Cost: 12},
	"pet_coconut":          {Key: "pet_coconut", Name: "椰子水", Cost: 25},
	"pet_care_basic":       {Key: "pet_care_basic", Name: "基础体检", Cost: 0},
	"pet_vitamin":          {Key: "pet_vitamin", Name: "维生素", Cost: 30},
	"pet_supplement":       {Key: "pet_supplement", Name: "营养剂", Cost: 60},
	"pet_rest_basic":       {Key: "pet_rest_basic", Name: "随地休息", Cost: 0},
	"pet_nest":             {Key: "pet_nest", Name: "舒适小窝", Cost: 25},
	"pet_blanket":          {Key: "pet_blanket", Name: "柔软毛毯", Cost: 50},
	"pet_wash":             {Key: "pet_wash", Name: "洗澡券", Cost: 20, DailyLimit: 1},
	"pet_play_basic":       {Key: "pet_play_basic", Name: "徒手陪玩", Cost: 0},
	"pet_yarn_ball":        {Key: "pet_yarn_ball", Name: "毛线球", Cost: 15},
	"pet_frisbee":          {Key: "pet_frisbee", Name: "飞盘", Cost: 35},
	"pet_toy":              {Key: "pet_toy", Name: "玩具球", Cost: 30, DailyLimit: 1},
	"pet_skill_water":      {Key: "pet_skill_water", Name: "自动浇水技能书", Cost: 120},
	"pet_skill_guard":      {Key: "pet_skill_guard", Name: "守护庄园技能书", Cost: 140},
	"pet_skill_chase_crow": {Key: "pet_skill_chase_crow", Name: "赶乌鸦技能书", Cost: 130},
	"pet_skill_steal":      {Key: "pet_skill_steal", Name: "偷菜技能书", Cost: 160},
	"pet_skill_harvest":    {Key: "pet_skill_harvest", Name: "收菜技能书", Cost: 180},
	"pet_skill_plant":      {Key: "pet_skill_plant", Name: "种菜技能书", Cost: 180},
	"last_supper":          {Key: "last_supper", Name: "最后的晚餐", Cost: 1000},
}

var oneTimeShopItems = map[string]bool{
	"weather_tv": true,
}

var petSkillBookItems = map[string]bool{
	"pet_skill_water":      true,
	"pet_skill_guard":      true,
	"pet_skill_chase_crow": true,
	"pet_skill_steal":      true,
	"pet_skill_harvest":    true,
	"pet_skill_plant":      true,
}

var petSkillBookToSkill = map[string]string{
	"pet_skill_water":      "water",
	"pet_skill_guard":      "guard",
	"pet_skill_chase_crow": "chase_crow",
	"pet_skill_steal":      "steal",
	"pet_skill_harvest":    "harvest",
	"pet_skill_plant":      "plant",
}

var petSkillLabels = map[string]string{
	"water":      "自动浇水",
	"guard":      "守护庄园",
	"chase_crow": "赶乌鸦",
	"steal":      "偷菜",
	"harvest":    "收菜",
	"plant":      "种菜",
}

func getBaseShopItemDef(key string) (shopItemDef, bool) {
	item, ok := shopItemDefs[key]
	return item, ok
}

func publicShopItem(item shopItemDef) ShopItem {
	meta := shopItemMetas[item.Key]
	payload := ShopItem{
		Key:         item.Key,
		Name:        item.Name,
		Emoji:       meta.Emoji,
		Category:    meta.Category,
		Cost:        item.Cost,
		Description: meta.Description,
	}
	if item.DailyLimit > 0 {
		payload.DailyLimit = &item.DailyLimit
	}
	if item.DurationMinutes > 0 {
		payload.DurationMinutes = &item.DurationMinutes
	}
	if item.SpeedReduceMinutes > 0 {
		payload.SpeedReduceMinutes = &item.SpeedReduceMinutes
	}
	return payload
}
