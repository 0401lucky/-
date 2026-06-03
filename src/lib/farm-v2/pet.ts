// 宠物系统：领养 / 抚养 / 派遣 / 衰减

import type { FarmStateV2, PetState, PetType, PetTask, ShopItemKey, PetSkill } from '@/lib/types/farm-v2';
import {
  PET_DAILY_DECAY, PET_DAILY_LIMITS,
  PET_STAGE_THRESHOLD, PET_TASKS,
  PET_TYPE_LABEL, PET_WATER_REST_MINUTES,
  PET_HOURLY_DECAY, PET_MOOD_STOP_WORK, PET_MOOD_DISPATCH_MIN,
  PET_ITEM_EFFECTS, PET_SKILL_LABEL, WATER_ACTION_LEAD_MS, type PetActionCategory,
} from './config';
import { computeActualWaterIntervalMs, getCurrentSeason, getChinaDateString, getWeatherForDate } from './engine';
import { isNewChinaDay } from './season';

export function normalizePetName(type: PetType, name?: string): string {
  const cleaned = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 12);
  return cleaned || PET_TYPE_LABEL[type];
}

export function createPet(type: PetType, now: number, name?: string): PetState {
  return {
    type,
    name: normalizePetName(type, name),
    stage: 'child',
    growth: 0,
    hunger: 80,
    cleanliness: 80,
    mood: 55,
    thirst: 80,
    hydrationVersion: 2,
    health: 85,
    learnedSkills: [],
    currentTask: null,
    taskStartAt: null,
    taskEndAt: null,
    cooldownEndAt: null,
    stealTarget: null,
    feedToday: { normal: 0, premium: 0 },
    washToday: 0,
    waterToday: 0,
    playToday: 0,
    toyToday: 0,
    dailyResetAt: now,
  };
}

function recalcStage(p: PetState) {
  if (p.growth >= PET_STAGE_THRESHOLD.adult) p.stage = 'adult';
  else p.stage = 'child';
}

function clamp01_100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

type LegacyPetState = Omit<PetState, 'stage'> & {
  stage?: PetState['stage'] | 'youth';
  intimacy?: number;
  mood?: number;
  thirst?: number;
  hydrationVersion?: 2;
  health?: number;
  learnedSkills?: PetSkill[];
  waterToday?: number;
};

/** 兼容旧存档：青年期并入幼年，亲密度迁移为情绪。 */
export function normalizePetState(p: PetState): PetState {
  const pet = p as LegacyPetState;
  if (!pet.name) pet.name = normalizePetName(pet.type);
  pet.growth = Math.max(0, Math.floor(Number(pet.growth) || 0));
  pet.hunger = clamp01_100(Number(pet.hunger) || 0);
  pet.cleanliness = clamp01_100(Number(pet.cleanliness) || 0);
  pet.mood = clamp01_100(Number(pet.mood ?? pet.intimacy ?? 55) || 0);
  const rawThirst = Number(pet.thirst ?? (pet.hydrationVersion === 2 ? 80 : 20));
  const normalizedThirst = Number.isFinite(rawThirst) ? rawThirst : (pet.hydrationVersion === 2 ? 80 : 20);
  pet.thirst = clamp01_100(pet.hydrationVersion === 2 ? normalizedThirst : 100 - normalizedThirst);
  pet.hydrationVersion = 2;
  pet.health = clamp01_100(Number(pet.health ?? 85) || 0);
  if (!Array.isArray(pet.learnedSkills)) pet.learnedSkills = [];
  pet.learnedSkills = Array.from(new Set(pet.learnedSkills.filter((skill): skill is PetSkill => (
    skill === 'water' || skill === 'guard' || skill === 'chase_crow'
    || skill === 'steal' || skill === 'harvest' || skill === 'plant'
  ))));
  if (!pet.feedToday) pet.feedToday = { normal: 0, premium: 0 };
  pet.feedToday.normal = Math.max(0, Number(pet.feedToday.normal) || 0);
  pet.feedToday.premium = Math.max(0, Number(pet.feedToday.premium) || 0);
  pet.washToday = Math.max(0, Number(pet.washToday) || 0);
  pet.waterToday = Math.max(0, Number(pet.waterToday) || 0);
  pet.playToday = Math.max(0, Number(pet.playToday) || 0);
  pet.toyToday = Math.max(0, Number(pet.toyToday) || 0);
  if (pet.stage === 'youth') pet.stage = 'child';
  recalcStage(pet as PetState);
  delete pet.intimacy;
  return pet as PetState;
}

function computeDailyHealthDelta(p: PetState): number {
  if (p.hunger < 15 || p.cleanliness < 15 || p.thirst < 10) return -14;
  if (p.hunger < 35 || p.cleanliness < 35 || p.thirst < 30) return -7;
  if (p.mood < 25) return -4;
  if (p.hunger >= 60 && p.cleanliness >= 60 && p.thirst >= 65 && p.mood >= 55) return 5;
  return 0;
}

/** 按经过的小时数对宠物各项数值进行线性衰减 */
export function processPetTimeDecay(state: FarmStateV2, lastTickAt: number, now: number): FarmStateV2 {
  if (!state.pet) return state;
  if (now <= lastTickAt) return state;
  const hours = (now - lastTickAt) / (60 * 60 * 1000);
  if (hours <= 0) return state;
  const p = state.pet;
  p.hunger = clamp01_100(p.hunger - PET_HOURLY_DECAY.hunger * hours);
  p.cleanliness = clamp01_100(p.cleanliness - PET_HOURLY_DECAY.cleanliness * hours);
  p.thirst = clamp01_100(p.thirst - PET_HOURLY_DECAY.thirst * hours);

  let moodDrop = PET_HOURLY_DECAY.moodBase;
  if (p.hunger < 30) moodDrop += PET_HOURLY_DECAY.moodBadStat;
  if (p.thirst < 30) moodDrop += PET_HOURLY_DECAY.moodBadStat;
  if (p.cleanliness < 30) moodDrop += PET_HOURLY_DECAY.moodBadStat;
  if (p.health < 40) moodDrop += PET_HOURLY_DECAY.moodBadStat;
  p.mood = clamp01_100(p.mood - moodDrop * hours);

  const critical = p.hunger < 20 || p.thirst < 20 || p.cleanliness < 20 || p.mood < 20;
  const healthDrop = critical ? PET_HOURLY_DECAY.healthCritical : PET_HOURLY_DECAY.healthBase;
  p.health = clamp01_100(p.health - healthDrop * hours);

  recalcStage(p);
  return state;
}

/** 情绪过低时停止当前任务 */
export function maybeStopWorkOnLowMood(state: FarmStateV2, now: number): { stopped: boolean; taskName: string | null } {
  if (!state.pet) return { stopped: false, taskName: null };
  const p = state.pet;
  if (!p.currentTask) return { stopped: false, taskName: null };
  if (p.taskEndAt && p.taskEndAt <= now) return { stopped: false, taskName: null };
  if (p.mood >= PET_MOOD_STOP_WORK) return { stopped: false, taskName: null };
  const taskName = p.currentTask;
  p.currentTask = null;
  p.taskStartAt = null;
  p.taskEndAt = null;
  // 冷却保留：让宠物休息一下
  p.stealTarget = null;
  return { stopped: true, taskName };
}

/** 跨日衰减与每日次数清零 */
export function processPetDailyDecay(state: FarmStateV2, now: number): FarmStateV2 {
  if (!state.pet) return state;
  normalizePetState(state.pet);
  const last = state.lastDailyResetAt || state.pet.dailyResetAt || now;
  if (!isNewChinaDay(last, now)) return state;
  // 计算跨过几天（最多 7 天）
  const days = Math.min(7, Math.floor((now - last) / (24 * 60 * 60 * 1000)) || 1);
  state.pet.hunger = clamp01_100(state.pet.hunger - PET_DAILY_DECAY.hunger * days);
  state.pet.cleanliness = clamp01_100(state.pet.cleanliness - PET_DAILY_DECAY.cleanliness * days);
  state.pet.mood = clamp01_100(state.pet.mood - PET_DAILY_DECAY.mood * days);
  state.pet.thirst = clamp01_100(state.pet.thirst - PET_DAILY_DECAY.thirst * days);
  state.pet.health = clamp01_100(state.pet.health + computeDailyHealthDelta(state.pet) * days);
  state.pet.feedToday = { normal: 0, premium: 0 };
  state.pet.washToday = 0;
  state.pet.waterToday = 0;
  state.pet.playToday = 0;
  state.pet.toyToday = 0;
  state.pet.dailyResetAt = now;
  // 每日被偷次数也清零
  state.stolenTodayCount = 0;
  state.stolenByMap = {};
  state.myStealMap = {};
  state.lastDailyResetAt = now;
  return state;
}

export function feedPet(state: FarmStateV2, kind: 'normal' | 'premium'): { ok: boolean; msg?: string } {
  const key: ShopItemKey = kind === 'normal' ? 'pet_food_normal' : 'pet_food_premium';
  return applyPetItemEffect(state, key);
}

export function washPet(state: FarmStateV2): { ok: boolean; msg?: string } {
  return applyPetItemEffect(state, 'pet_wash');
}

export function drinkPet(state: FarmStateV2): { ok: boolean; msg?: string } {
  return applyPetItemEffect(state, 'pet_water_basic');
}

export function playPet(state: FarmStateV2): { ok: boolean; msg?: string } {
  return applyPetItemEffect(state, 'pet_play_basic');
}

export function useToy(state: FarmStateV2): { ok: boolean; msg?: string } {
  return applyPetItemEffect(state, 'pet_toy');
}

export function dispatchPetTask(
  state: FarmStateV2,
  task: Exclude<PetTask, null>,
  now: number,
  extra?: { targetUserId?: number; targetLandIndex?: number; targetCropId?: import('@/lib/types/farm-v2').CropIdV2 },
): { ok: boolean; msg?: string } {
  const ready = validatePetSkillReady(state, task, now);
  if (!ready.ok) return ready;
  const p = normalizePetState(state.pet!);
  const def = PET_TASKS[task];
  const cooldownMinutes = task === 'water' ? PET_WATER_REST_MINUTES[p.type] : def.cooldownMinutes;
  p.currentTask = task;
  p.taskStartAt = now;
  p.taskEndAt = now + def.durationMinutes * 60 * 1000;
  p.cooldownEndAt = p.taskEndAt + cooldownMinutes * 60 * 1000;
  if (task === 'steal' && extra) {
    p.stealTarget = {
      userId: extra.targetUserId!,
      landIndex: extra.targetLandIndex!,
      cropId: extra.targetCropId!,
    };
  } else {
    p.stealTarget = null;
  }
  return { ok: true };
}

export function hasPetSkill(p: PetState | null, skill: PetSkill): boolean {
  if (!p) return false;
  return (p.learnedSkills ?? []).includes(skill);
}

export function learnPetSkill(state: FarmStateV2, skill: PetSkill): { ok: boolean; msg?: string } {
  if (!state.pet) return { ok: false, msg: '请先领养宠物' };
  const p = normalizePetState(state.pet);
  if (p.stage !== 'adult') return { ok: false, msg: '宠物成年后才能学习技能书' };
  if (hasPetSkill(p, skill)) return { ok: false, msg: `宠物已经学会${PET_SKILL_LABEL[skill]}` };
  p.learnedSkills = [...(p.learnedSkills ?? []), skill];
  return { ok: true };
}

export function validatePetSkillReady(
  state: FarmStateV2,
  skill: Exclude<PetTask, null>,
  now: number,
): { ok: boolean; msg?: string } {
  if (!state.pet) return { ok: false, msg: '请先领养宠物' };
  const p = normalizePetState(state.pet);
  if (p.stage !== 'adult') return { ok: false, msg: '宠物未成年，不能使用技能' };
  if (!hasPetSkill(p, skill)) return { ok: false, msg: `宠物还没有学习${PET_SKILL_LABEL[skill]}技能` };
  if (p.hunger < 25 || p.cleanliness < 25 || p.thirst < 20 || p.health < 35 || p.mood < PET_MOOD_DISPATCH_MIN) {
    return { ok: false, msg: '宠物状态太差，不能工作' };
  }
  if (p.currentTask != null && p.taskEndAt && p.taskEndAt > now) {
    return { ok: false, msg: '宠物正在工作中' };
  }
  if (p.cooldownEndAt && p.cooldownEndAt > now) {
    return { ok: false, msg: '宠物正在休息' };
  }
  return { ok: true };
}

/** 使用宠物物品后应用数值变化 */
export function applyPetItemEffect(
  state: FarmStateV2,
  itemKey: ShopItemKey,
  effects = PET_ITEM_EFFECTS,
): { ok: boolean; msg?: string } {
  if (!state.pet) return { ok: false, msg: '请先领养宠物' };
  const entry = effects[itemKey];
  if (!entry) return { ok: false, msg: '该物品不能用于宠物' };
  const p = normalizePetState(state.pet);
  if (entry.daily) {
    const counter = entry.daily;
    if (counter === 'feedNormal') {
      if (p.feedToday.normal >= PET_DAILY_LIMITS.feedNormal) return { ok: false, msg: '今日普通宠粮已用完' };
      p.feedToday.normal += 1;
    } else if (counter === 'feedPremium') {
      if (p.feedToday.premium >= PET_DAILY_LIMITS.feedPremium) return { ok: false, msg: '今日高级宠粮已用完' };
      p.feedToday.premium += 1;
    } else if (counter === 'wash') {
      if (p.washToday >= PET_DAILY_LIMITS.wash) return { ok: false, msg: '今日洗澡券已用完' };
      p.washToday += 1;
    } else if (counter === 'toy') {
      if (p.toyToday >= PET_DAILY_LIMITS.toy) return { ok: false, msg: '今日玩具球已用完' };
      p.toyToday += 1;
    } else if (counter === 'water') {
      if (p.waterToday >= PET_DAILY_LIMITS.water) return { ok: false, msg: '今日喂水次数已用完' };
      p.waterToday += 1;
    } else if (counter === 'play') {
      if (p.playToday >= PET_DAILY_LIMITS.play) return { ok: false, msg: '今日陪玩次数已用完' };
      p.playToday += 1;
    }
  }
  const e = entry.effect;
  if (e.hunger) p.hunger = clamp01_100(p.hunger + e.hunger);
  if (e.cleanliness) p.cleanliness = clamp01_100(p.cleanliness + e.cleanliness);
  if (e.mood) p.mood = clamp01_100(p.mood + e.mood);
  if (e.thirst) p.thirst = clamp01_100(p.thirst + e.thirst);
  if (e.health) p.health = clamp01_100(p.health + e.health);
  if (e.growth) p.growth += e.growth;
  recalcStage(p);
  return { ok: true };
}

/** 暴露分类查询，方便前端选择物品 */
export function getItemCategory(itemKey: ShopItemKey, effects = PET_ITEM_EFFECTS): PetActionCategory | null {
  return effects[itemKey]?.category ?? null;
}

/** 处理自动浇水任务的懒结算 */
export function processPetWaterTask(state: FarmStateV2, lastTickAt: number, now: number): FarmStateV2 {
  if (!state.pet) return state;
  const p = state.pet;
  if (p.currentTask !== 'water') return state;
  if (!p.taskStartAt || !p.taskEndAt) return state;
  const startTick = Math.max(lastTickAt, p.taskStartAt);
  const stop = Math.min(now, p.taskEndAt);
  if (stop <= startTick) return state;

  for (const land of state.lands) {
    if (!land.crop) continue;
    if (land.status === 'locked' || land.status === 'empty' || land.status === 'mature' || land.status === 'withered' || land.status === 'eaten') {
      continue;
    }
    const crop = land.crop;
    if (crop.waterMissCount >= 3) continue;
    let waterAt = Math.max(crop.nextWaterDueAt - WATER_ACTION_LEAD_MS, startTick, crop.plantedAt);
    while (waterAt <= stop && waterAt < crop.matureAt) {
      const season = getCurrentSeason(waterAt);
      const date = getChinaDateString(waterAt);
      const weather = getWeatherForDate(date, season);
      const intervalMs = computeActualWaterIntervalMs(crop.cropId, season, weather);
      crop.lastWaterAt = waterAt;
      crop.nextWaterDueAt = waterAt + intervalMs;
      land.status = 'growing';
      waterAt = crop.nextWaterDueAt;
    }
  }

  // 任务结束清空
  if (p.taskEndAt <= now) {
    p.currentTask = null;
    p.taskStartAt = null;
    p.taskEndAt = null;
  }
  return state;
}

/** 清理结束的非浇水任务 */
export function processPetTaskEnd(state: FarmStateV2, now: number): FarmStateV2 {
  if (!state.pet) return state;
  const p = state.pet;
  if (p.currentTask && p.taskEndAt && p.taskEndAt <= now) {
    if (p.currentTask !== 'steal') {
      // 偷菜由专门 endpoint 结算（写入事件 + 扣目标 stolen）
      p.currentTask = null;
      p.taskStartAt = null;
      p.taskEndAt = null;
    }
  }
  return state;
}
