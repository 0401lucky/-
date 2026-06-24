package economy

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var ErrFarmShopItemNotFound = errors.New("farm shop item not found")

type farmShopBaseItem struct {
	Key             string
	Name            string
	Emoji           string
	Category        string
	Cost            int64
	Description     string
	DurationMinutes *int64
	DailyLimit      *int64
}

var farmShopBaseItems = []farmShopBaseItem{
	{Key: "fert_normal", Name: "普通肥料", Emoji: "🌱", Category: "fertilizer", Cost: 20, Description: "成长时间 -10%，金星概率 +5%"},
	{Key: "fert_medium", Name: "中级肥料", Emoji: "🌿", Category: "fertilizer", Cost: 45, Description: "成长时间 -20%，银星 +10%，金星 +10%"},
	{Key: "fert_premium", Name: "高级肥料", Emoji: "🌳", Category: "fertilizer", Cost: 80, Description: "成长时间 -35%，银星 +15%，金星 +20%"},
	{Key: "scarecrow", Name: "稻草人", Emoji: "👻", Category: "protection", Cost: 100, Description: "12 小时内，全场乌鸦出现概率降为 40%", DurationMinutes: int64Ptr(12 * 60)},
	{Key: "birdnet", Name: "防鸟网", Emoji: "🕸️", Category: "protection", Cost: 50, Description: "指定 1 块土地 6 小时免疫乌鸦", DurationMinutes: int64Ptr(6 * 60)},
	{Key: "bell", Name: "看守铃铛", Emoji: "🔔", Category: "protection", Cost: 80, Description: "6 小时内偷菜成功率 -50%", DurationMinutes: int64Ptr(6 * 60)},
	{Key: "firework", Name: "驱鸟烟花", Emoji: "🎆", Category: "protection", Cost: 30, Description: "立即驱散当前出现的乌鸦事件"},
	{Key: "cloud_bottle", Name: "云朵瓶", Emoji: "🌧️", Category: "speed", Cost: 40, Description: "立即给所有未成熟作物浇水"},
	{Key: "speed_normal", Name: "加速券", Emoji: "⏩", Category: "speed", Cost: 30, Description: "指定作物剩余成长 -10 分钟"},
	{Key: "speed_premium", Name: "高级加速", Emoji: "🚀", Category: "speed", Cost: 70, Description: "指定作物剩余成长 -30 分钟"},
	{Key: "weather_tv", Name: "天气电视机", Emoji: "📺", Category: "special", Cost: 120, Description: "永久解锁电视机按钮，可查看明日天气预报"},
	{Key: "pet_food_normal", Name: "普通宠粮", Emoji: "🍖", Category: "pet", Cost: 15, Description: "饱食明显提升，情绪略微变好，成长 +5", DailyLimit: int64Ptr(3)},
	{Key: "pet_food_premium", Name: "高级宠粮", Emoji: "🥩", Category: "pet", Cost: 40, Description: "饱食大幅提升，情绪和健康变好，成长 +12", DailyLimit: int64Ptr(1)},
	{Key: "pet_water_basic", Name: "清水", Emoji: "💧", Category: "pet", Cost: 0, Description: "免费的基础喂水，口渴值 +35"},
	{Key: "pet_milk", Name: "牛奶", Emoji: "🥛", Category: "pet", Cost: 12, Description: "口渴值 +45，并补充少量饱食和情绪"},
	{Key: "pet_coconut", Name: "椰子水", Emoji: "🥥", Category: "pet", Cost: 25, Description: "口渴值 +65，并增加健康和情绪"},
	{Key: "pet_care_basic", Name: "基础体检", Emoji: "🩺", Category: "pet", Cost: 0, Description: "免费基础保养，健康 +12，情绪 +3"},
	{Key: "pet_vitamin", Name: "维生素", Emoji: "💊", Category: "pet", Cost: 30, Description: "健康 +25，情绪 +5"},
	{Key: "pet_supplement", Name: "营养剂", Emoji: "🧪", Category: "pet", Cost: 60, Description: "健康 +45，情绪 +8，并补充饱食 +10"},
	{Key: "pet_rest_basic", Name: "随地休息", Emoji: "😴", Category: "pet", Cost: 0, Description: "免费休息，体力 +20，情绪 +2"},
	{Key: "pet_nest", Name: "舒适小窝", Emoji: "🛏️", Category: "pet", Cost: 25, Description: "体力 +35，情绪 +5，健康 +3"},
	{Key: "pet_blanket", Name: "柔软毛毯", Emoji: "🧣", Category: "pet", Cost: 50, Description: "体力 +55，情绪 +8，健康 +5"},
	{Key: "pet_wash", Name: "洗澡券", Emoji: "🛁", Category: "pet", Cost: 20, Description: "体力 +35，情绪和健康变好，成长 +4", DailyLimit: int64Ptr(1)},
	{Key: "pet_play_basic", Name: "徒手陪玩", Emoji: "🤲", Category: "pet", Cost: 0, Description: "免费陪玩，情绪 +12、健康 +4，但消耗饱食 -5、体力 -5、口渴值 -6"},
	{Key: "pet_yarn_ball", Name: "毛线球", Emoji: "🧶", Category: "pet", Cost: 15, Description: "情绪 +20、健康 +7，消耗饱食 -8、体力 -8、口渴值 -10"},
	{Key: "pet_frisbee", Name: "飞盘", Emoji: "🥏", Category: "pet", Cost: 35, Description: "情绪 +30、健康 +12，消耗饱食 -12、体力 -12、口渴值 -14"},
	{Key: "pet_toy", Name: "玩具球", Emoji: "🎾", Category: "pet", Cost: 30, Description: "情绪大幅变好，健康 +4，但会降低少量口渴值、消耗体力", DailyLimit: int64Ptr(1)},
	{Key: "pet_skill_water", Name: "自动浇水技能书", Emoji: "📘", Category: "pet", Cost: 120, Description: "成年宠物学习后，可派遣自动浇水 3 小时；同一只宠物同技能只能学习一次"},
	{Key: "pet_skill_guard", Name: "守护庄园技能书", Emoji: "📗", Category: "pet", Cost: 140, Description: "成年宠物学习后，可守护庄园降低乌鸦和偷菜风险；同一只宠物同技能只能学习一次"},
	{Key: "pet_skill_chase_crow", Name: "赶乌鸦技能书", Emoji: "📙", Category: "pet", Cost: 130, Description: "成年宠物学习后，可主动赶走乌鸦 4 小时；同一只宠物同技能只能学习一次"},
	{Key: "pet_skill_steal", Name: "偷菜技能书", Emoji: "📕", Category: "pet", Cost: 160, Description: "成年宠物学习后，可前往好友庄园偷菜；同一只宠物同技能只能学习一次"},
	{Key: "pet_skill_harvest", Name: "收菜技能书", Emoji: "📒", Category: "pet", Cost: 180, Description: "成年宠物学习后，成熟作物会自动收获；同一只宠物同技能只能学习一次"},
	{Key: "pet_skill_plant", Name: "种菜技能书", Emoji: "📔", Category: "pet", Cost: 180, Description: "成年宠物学习后，会自动挑选当前季节高收益种子播种空地；同一只宠物同技能只能学习一次"},
	{Key: "last_supper", Name: "最后的晚餐", Emoji: "🍽️", Category: "pet", Cost: 1000, Description: "当前宠物离开庄园，之后可重新领养宠物"},
}

func (service *Service) SaveFarmShopItemOverride(ctx context.Context, input FarmShopItemOverrideInput) (*FarmShopItemOverride, error) {
	input.Key = strings.TrimSpace(input.Key)
	if !farmShopItemExists(input.Key) {
		return nil, ErrFarmShopItemNotFound
	}

	tx, err := service.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer rollbackSilently(ctx, tx)

	now := time.Now().UnixMilli()
	petEffectRaw, err := encodeOptionalPetEffect(input.PetEffect)
	if err != nil {
		return nil, err
	}
	override, err := queryFarmShopOverride(ctx, tx,
		`INSERT INTO farm_shop_overrides (
		   key, cost, daily_limit, duration_minutes, speed_reduce_minutes,
		   pet_effect, updated_at_ms, created_at, updated_at
		 ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
		 ON CONFLICT (key) DO UPDATE
		 SET cost = COALESCE(EXCLUDED.cost, farm_shop_overrides.cost),
		     daily_limit = COALESCE(EXCLUDED.daily_limit, farm_shop_overrides.daily_limit),
		     duration_minutes = COALESCE(EXCLUDED.duration_minutes, farm_shop_overrides.duration_minutes),
		     speed_reduce_minutes = COALESCE(EXCLUDED.speed_reduce_minutes, farm_shop_overrides.speed_reduce_minutes),
		     pet_effect = COALESCE(EXCLUDED.pet_effect, farm_shop_overrides.pet_effect),
		     updated_at_ms = EXCLUDED.updated_at_ms,
		     updated_at = now()
		 RETURNING key, cost, daily_limit, duration_minutes, speed_reduce_minutes,
		           pet_effect, updated_at_ms`,
		input.Key,
		optionalInt64(input.Cost),
		optionalInt64(input.DailyLimit),
		optionalInt64(input.DurationMinutes),
		optionalInt64(input.SpeedReduceMinutes),
		petEffectRaw,
		now,
	)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &override, nil
}

func listFarmShopItems(ctx context.Context, tx pgx.Tx) ([]EffectiveFarmItem, error) {
	overrides, err := listFarmShopOverrides(ctx, tx)
	if err != nil {
		return nil, err
	}
	items := make([]EffectiveFarmItem, 0, len(farmShopBaseItems))
	for _, base := range farmShopBaseItems {
		item := EffectiveFarmItem{
			Key:             base.Key,
			Name:            base.Name,
			Emoji:           base.Emoji,
			Category:        base.Category,
			Cost:            base.Cost,
			Description:     base.Description,
			DurationMinutes: cloneInt64Ptr(base.DurationMinutes),
			DailyLimit:      cloneInt64Ptr(base.DailyLimit),
		}
		if override, ok := overrides[base.Key]; ok {
			item.Override = &override
			if override.Cost != nil {
				item.Cost = *override.Cost
			}
			if override.DailyLimit != nil {
				item.DailyLimit = cloneInt64Ptr(override.DailyLimit)
			}
			if override.DurationMinutes != nil {
				item.DurationMinutes = cloneInt64Ptr(override.DurationMinutes)
			}
			if override.SpeedReduceMinutes != nil {
				item.SpeedReduceMinutes = cloneInt64Ptr(override.SpeedReduceMinutes)
			}
			if len(override.PetEffect) > 0 {
				item.PetEffect = clonePetEffect(override.PetEffect)
			}
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(left, right int) bool {
		if items[left].Category != items[right].Category {
			return items[left].Category < items[right].Category
		}
		return items[left].Cost < items[right].Cost
	})
	return items, nil
}

func listFarmShopOverrides(ctx context.Context, tx pgx.Tx) (map[string]FarmShopItemOverride, error) {
	rows, err := tx.Query(ctx,
		`SELECT key, cost, daily_limit, duration_minutes, speed_reduce_minutes,
		        pet_effect, updated_at_ms
		 FROM farm_shop_overrides`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]FarmShopItemOverride)
	for rows.Next() {
		override, err := scanFarmShopOverride(rows)
		if err != nil {
			return nil, err
		}
		result[override.Key] = override
	}
	return result, rows.Err()
}

func queryFarmShopOverride(ctx context.Context, tx pgx.Tx, sql string, args ...any) (FarmShopItemOverride, error) {
	return scanFarmShopOverride(tx.QueryRow(ctx, sql, args...))
}

type farmShopOverrideScanner interface {
	Scan(dest ...any) error
}

func scanFarmShopOverride(row farmShopOverrideScanner) (FarmShopItemOverride, error) {
	var override FarmShopItemOverride
	var cost sql.NullInt64
	var dailyLimit sql.NullInt64
	var durationMinutes sql.NullInt64
	var speedReduceMinutes sql.NullInt64
	var petEffectRaw []byte
	err := row.Scan(
		&override.Key,
		&cost,
		&dailyLimit,
		&durationMinutes,
		&speedReduceMinutes,
		&petEffectRaw,
		&override.UpdatedAt,
	)
	if err != nil {
		return FarmShopItemOverride{}, err
	}
	override.Cost = nullableInt64Ptr(cost)
	override.DailyLimit = nullableInt64Ptr(dailyLimit)
	override.DurationMinutes = nullableInt64Ptr(durationMinutes)
	override.SpeedReduceMinutes = nullableInt64Ptr(speedReduceMinutes)
	override.PetEffect = decodePetEffect(petEffectRaw)
	return override, nil
}

func farmShopItemExists(key string) bool {
	for _, item := range farmShopBaseItems {
		if item.Key == key {
			return true
		}
	}
	return false
}

func encodeOptionalPetEffect(effect PetItemEffect) (any, error) {
	if len(effect) == 0 {
		return nil, nil
	}
	raw, err := json.Marshal(effect)
	if err != nil {
		return nil, err
	}
	return string(raw), nil
}

func decodePetEffect(raw []byte) PetItemEffect {
	if len(raw) == 0 || !json.Valid(raw) {
		return nil
	}
	var effect PetItemEffect
	if err := json.Unmarshal(raw, &effect); err != nil {
		return nil
	}
	if len(effect) == 0 {
		return nil
	}
	return effect
}

func clonePetEffect(effect PetItemEffect) PetItemEffect {
	if len(effect) == 0 {
		return nil
	}
	cloned := make(PetItemEffect, len(effect))
	for key, value := range effect {
		cloned[key] = value
	}
	return cloned
}

func cloneInt64Ptr(value *int64) *int64 {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func nullableInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return int64Ptr(value.Int64)
}

func int64Ptr(value int64) *int64 {
	return &value
}
