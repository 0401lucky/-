// 商店：道具购买与使用

import type { FarmStateV2, ShopItemKey, FarmEvent, FertilizerType } from '@/lib/types/farm-v2';
import type { EffectiveFarmShopItem } from './admin-config';
import {
  SHOP_ITEMS_V2, SPEED_MAX_RATIO, CROPS_V2, FERTILIZERS, PET_TYPE_LABEL,
  PET_SKILL_BOOK_TO_SKILL, PET_SKILL_LABEL,
  PET_ITEM_EFFECTS,
} from './config';
import { computeActualGrowthMs, computeActualWaterIntervalMs, getCurrentSeason, getChinaDateString, getWeatherForDate } from './engine';
import { pushEvent } from './season';
import { learnPetSkill } from './pet';
import { nanoid } from 'nanoid';

export function getShopList() {
  return Object.values(SHOP_ITEMS_V2);
}

export function addToInventory(state: FarmStateV2, key: ShopItemKey, qty: number, now: number) {
  const cur = state.inventory[key] ?? { count: 0, updatedAt: now };
  state.inventory[key] = { count: cur.count + qty, updatedAt: now };
}

export function consumeFromInventory(state: FarmStateV2, key: ShopItemKey, qty = 1): boolean {
  const cur = state.inventory[key];
  if (!cur || cur.count < qty) return false;
  cur.count -= qty;
  return true;
}

const FERTILIZER_ITEM_TO_TYPE: Partial<Record<ShopItemKey, Exclude<FertilizerType, null>>> = {
  fert_normal: 'normal',
  fert_medium: 'medium',
  fert_premium: 'premium',
};

/** 立即应用某些类道具（肥料/稻草人/铃铛/云朵瓶/烟花/防鸟网/加速券） */
export function applyItemUse(
  state: FarmStateV2,
  key: ShopItemKey,
  now: number,
  plotIndex?: number,
  options?: {
    items?: Partial<Record<ShopItemKey, EffectiveFarmShopItem>>;
    petEffects?: typeof PET_ITEM_EFFECTS;
  },
): { ok: boolean; msg?: string } {
  const def = (options?.items?.[key] ?? SHOP_ITEMS_V2[key]) as EffectiveFarmShopItem | undefined;
  if (!def) return { ok: false, msg: '未知道具' };

  const skill = PET_SKILL_BOOK_TO_SKILL[key as keyof typeof PET_SKILL_BOOK_TO_SKILL];
  if (skill) {
    const learned = learnPetSkill(state, skill);
    if (!learned.ok) return learned;
    if (!consumeFromInventory(state, key)) {
      state.pet!.learnedSkills = state.pet!.learnedSkills?.filter((s) => s !== skill);
      return { ok: false, msg: '库存不足' };
    }
    const petName = state.pet?.name || (state.pet ? PET_TYPE_LABEL[state.pet.type] : '宠物');
    pushEvent(state, mkEvent(now, 'pet_task', `${petName} 学会了${PET_SKILL_LABEL[skill]}技能`));
    return { ok: true };
  }

  const fertilizerType = FERTILIZER_ITEM_TO_TYPE[key];
  if (fertilizerType) {
    if (typeof plotIndex !== 'number') return { ok: false, msg: '请选择土地' };
    const land = state.lands[plotIndex];
    if (!land?.crop) return { ok: false, msg: '土地上没有作物' };
    if (land.status === 'mature' || now >= land.crop.matureAt) return { ok: false, msg: '作物已成熟，不能再施肥' };
    if (land.status === 'withered' || land.status === 'eaten') return { ok: false, msg: '该土地无法施肥' };
    if (land.crop.fertilizer) return { ok: false, msg: '该作物已使用过肥料' };
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };

    const previousMatureAt = land.crop.matureAt;
    const nextMatureAt = land.crop.plantedAt + computeActualGrowthMs(
      land.crop.cropId,
      land.crop.plantedSeason,
      fertilizerType,
    );

    land.crop.fertilizer = fertilizerType;
    land.crop.matureAt = Math.min(previousMatureAt, nextMatureAt);

    const fertilizerName = FERTILIZERS[fertilizerType].name;
    const cropName = CROPS_V2[land.crop.cropId].name;
    pushEvent(state, mkEvent(now, 'plant', `给第 ${land.index} 块地的 ${cropName} 使用了${fertilizerName}`));
    return { ok: true };
  }

  if (key === 'scarecrow') {
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    const baseTs = state.scarecrowUntil && state.scarecrowUntil > now ? state.scarecrowUntil : now;
    state.scarecrowUntil = baseTs + def.durationMinutes! * 60 * 1000;
    pushEvent(state, mkEvent(now, 'pet_task', `使用稻草人，全农场乌鸦概率降低`));
    return { ok: true };
  }

  if (key === 'bell') {
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    const baseTs = state.bellUntil && state.bellUntil > now ? state.bellUntil : now;
    state.bellUntil = baseTs + def.durationMinutes! * 60 * 1000;
    pushEvent(state, mkEvent(now, 'pet_task', `使用看守铃铛，偷菜成功率降低`));
    return { ok: true };
  }

  if (key === 'birdnet') {
    if (typeof plotIndex !== 'number') return { ok: false, msg: '请选择土地' };
    const land = state.lands[plotIndex];
    if (!land?.crop) return { ok: false, msg: '土地上没有作物' };
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    land.crop.birdNetUntil = now + def.durationMinutes! * 60 * 1000;
    return { ok: true };
  }

  if (key === 'firework') {
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    // 简化：刷新所有 eaten 状态为 empty（驱散最近一次乌鸦的视觉效果）
    state.lands.forEach((land) => { if (land.status === 'eaten') land.status = 'empty'; });
    pushEvent(state, mkEvent(now, 'pet_task', `驱鸟烟花点燃，乌鸦惊飞`));
    return { ok: true };
  }

  if (key === 'cloud_bottle') {
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    const season = getCurrentSeason(now);
    const date = getChinaDateString(now);
    const weather = getWeatherForDate(date, season);
    state.lands.forEach((land) => {
      if (!land.crop) return;
      if (land.status === 'mature' || land.status === 'withered' || land.status === 'eaten') return;
      const intervalMs = computeActualWaterIntervalMs(land.crop.cropId, season, weather);
      land.crop.lastWaterAt = now;
      land.crop.nextWaterDueAt = now + intervalMs;
      land.status = 'growing';
    });
    pushEvent(state, mkEvent(now, 'water_rain', `云朵瓶为所有未成熟作物浇水`));
    return { ok: true };
  }

  if (key === 'last_supper') {
    if (!state.pet) return { ok: false, msg: '当前没有宠物' };
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    const petName = state.pet.name || PET_TYPE_LABEL[state.pet.type];
    state.pet.mood = 0;
    state.pet = null;
    pushEvent(state, mkEvent(now, 'pet_task', `使用最后的晚餐，${petName}离开了庄园`));
    return { ok: true };
  }

  if (key === 'speed_normal' || key === 'speed_premium') {
    if (typeof plotIndex !== 'number') return { ok: false, msg: '请选择土地' };
    const land = state.lands[plotIndex];
    if (!land?.crop) return { ok: false, msg: '土地上没有作物' };
    if (now >= land.crop.matureAt) return { ok: false, msg: '作物已成熟' };
    if (land.crop.speedUsed >= 1) return { ok: false, msg: '该作物已用过加速券' };
    if (!consumeFromInventory(state, key)) return { ok: false, msg: '库存不足' };
    const reduceMin = def.speedReduceMinutes ?? (key === 'speed_normal' ? 10 : 30);
    const baseGrowMin = CROPS_V2[land.crop.cropId].growthMinutes;
    const maxReduceMin = Math.floor(baseGrowMin * SPEED_MAX_RATIO);
    const allowReduce = Math.min(reduceMin, maxReduceMin - land.crop.speedReducedMinutes);
    if (allowReduce <= 0) return { ok: false, msg: '已达到加速上限' };
    land.crop.matureAt = Math.max(now + 5 * 60 * 1000, land.crop.matureAt - allowReduce * 60 * 1000);
    land.crop.speedReducedMinutes += allowReduce;
    land.crop.speedUsed += 1;
    return { ok: true };
  }

  return { ok: false, msg: '该道具无法直接使用' };
}

function mkEvent(ts: number, type: FarmEvent['type'], text: string): FarmEvent {
  return { id: nanoid(), ts, type, text };
}
