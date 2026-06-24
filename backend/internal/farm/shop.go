package farm

type shopItemDef struct {
	Key                string
	Name               string
	Cost               int64
	DailyLimit         int64
	DurationMinutes    int64
	SpeedReduceMinutes int64
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
