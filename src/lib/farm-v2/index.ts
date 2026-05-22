// 农场 v1.2 业务层：KV、锁、tick 结算、对外接口
/* eslint-disable @typescript-eslint/no-explicit-any */

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import seedrandom from 'seedrandom';
import { addPoints, deductPoints, getUserPoints } from '@/lib/points';
import type {
  FarmStateV2, FarmStatusResponse, CropIdV2,
  HarvestResult, ShopItemKey, PetType, PetTask, PetSkillBookKey,
} from '@/lib/types/farm-v2';
import {
  INITIAL_POINTS, INITIAL_LAND_COUNT, MAX_LAND_COUNT, LAND_UNLOCK_PRICES,
  CROPS_V2, SHOP_ITEMS_V2, ONBOARDING_BONUS,
  STEAL_LIMITS, PET_ADOPT_COST, PET_TYPE_LABEL, PET_SKILL_BOOK_TO_SKILL,
  ONE_TIME_SHOP_ITEM_KEYS,
} from './config';
import {
  getCurrentSeason, getChinaDateString, getChinaMidnight, getWeatherForDate, computeActualGrowthMs,
  computeActualWaterIntervalMs, buildComputedLands, getPlantableCrops,
  getNextSeasonChangeMs, getNextDailyResetMs, isPerfectCare, rollQualityRates,
  pickQuality, computeFinalYield, computeOverripeFactor,
} from './engine';
import {
  applyRainAutoWater, advanceWaterMisses, maybeApplySeasonChange, pushEvent,
} from './season';
import { runCrowChecks } from './crow';
import {
  createPet, dispatchPetTask, normalizePetState,
  processPetDailyDecay, processPetWaterTask,
  processPetTaskEnd, normalizePetName,
  processPetTimeDecay, maybeStopWorkOnLowMood, applyPetItemEffect,
  getItemCategory, validatePetSkillReady,
} from './pet';
import {
  FARM_V2_STATE_KEY, listStealCandidates, computeStealSuccessRate,
  computeStealAmount, applyStolenOnTarget,
} from './steal';
import { addToInventory, applyItemUse } from './shop';
import { processMaturityEmailEventsForState } from './maturity-email';
import {
  getEffectiveFarmShopItem,
  getEffectiveFarmShopItems,
  getEffectivePetItemEffects,
} from './admin-config';

const FARM_V2_LOCK_KEY = (userId: number) => `farmv2:lock:${userId}`;
const FARM_MATURITY_EMAIL_SCAN_CURSOR_KEY = 'farmv2:mature-mail:scan-cursor';
const LOCK_TTL_SECONDS = 6;
const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 8;
const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const FRIDAY_EVENT_CROP_DELAY_MS = 10 * 60 * 1000;

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

interface Lock { key: string; token: string }

async function acquireLock(userId: number): Promise<Lock | null> {
  const key = FARM_V2_LOCK_KEY(userId);
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < LOCK_MAX_RETRIES; i += 1) {
    const ok = await kv.set(key, token, { nx: true, ex: LOCK_TTL_SECONDS });
    if (ok === 'OK') return { key, token };
    await sleep(LOCK_RETRY_MS);
  }
  return null;
}

async function releaseLock(lock: Lock): Promise<void> {
  kv.del(lock.key).catch(() => {});
}

/** 从 KV 读取或创建初始状态 */
export async function getOrCreateFarmV2(userId: number): Promise<FarmStateV2> {
  const key = FARM_V2_STATE_KEY(userId);
  const existing = await kv.get<FarmStateV2>(key);
  if (existing) return normalizeState(existing);

  const now = Date.now();
  const initial: FarmStateV2 = {
    userId,
    points: INITIAL_POINTS,
    lands: Array.from({ length: MAX_LAND_COUNT }, (_, i) => ({
      index: i + 1,
      status: i < INITIAL_LAND_COUNT ? 'empty' : 'locked',
      crop: null,
    })),
    scarecrowUntil: null,
    bellUntil: null,
    pet: null,
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {},
    purchasedSkillBooks: {},
    // 新手大礼包：4 颗小麦 + 2 颗胡萝卜 + 1 颗生菜种子
    seedInventory: { wheat: 4, carrot: 2, lettuce: 1 },
    events: [{ id: nanoid(), ts: now, type: 'plant', text: '欢迎来到开心农场！已赠送新手种子礼包' }],
    lastDailyResetAt: now,
    lastSeasonProcessedAt: now,
    lastTickAt: now,
    lastFridayEventDate: '',
    bonuses: { firstWater: false, firstHarvest: false, firstAdopt: false },
    createdAt: now,
    updatedAt: now,
  };
  // 同步初始 points 到福利积分系统：使用 max(用户既有积分, 100)
  const cur = await getUserPoints(userId);
  initial.points = cur > 0 ? cur : INITIAL_POINTS;
  if (cur === 0) {
    try { await addPoints(userId, INITIAL_POINTS, 'game_play', '开心农场初始积分'); } catch {}
  }
  await kv.set(key, initial);
  return initial;
}

function normalizeState(s: FarmStateV2): FarmStateV2 {
  // 防御：补齐缺失字段
  if (!s.events) s.events = [];
  if (!s.inventory) s.inventory = {};
  if (!s.purchasedSkillBooks) s.purchasedSkillBooks = {};
  if (!s.seedInventory) s.seedInventory = { wheat: 4, carrot: 2, lettuce: 1 };
  if (!s.bonuses) s.bonuses = { firstWater: false, firstHarvest: false, firstAdopt: false };
  if (!s.stolenByMap) s.stolenByMap = {};
  if (!s.myStealMap) s.myStealMap = {};
  if (s.stolenTodayCount == null) s.stolenTodayCount = 0;
  if (!s.lastDailyResetAt) s.lastDailyResetAt = s.createdAt || Date.now();
  if (!s.lastSeasonProcessedAt) s.lastSeasonProcessedAt = s.createdAt || Date.now();
  if (!s.lastTickAt) s.lastTickAt = s.createdAt || Date.now();
  if (s.lastFridayEventDate == null) s.lastFridayEventDate = '';
  if (s.pet) normalizePetState(s.pet);
  if (s.pet && !s.bonuses.firstAdopt) s.bonuses.firstAdopt = true;
  if (!Array.isArray(s.lands) || s.lands.length !== MAX_LAND_COUNT) {
    s.lands = Array.from({ length: MAX_LAND_COUNT }, (_, i) => s.lands?.[i] ?? { index: i + 1, status: i < INITIAL_LAND_COUNT ? 'empty' : 'locked', crop: null });
  }
  return s;
}

type FridayRandomEvent = {
  apply: (
    state: FarmStateV2,
    rng: () => number,
    now: number,
    season: ReturnType<typeof getCurrentSeason>,
    weather: ReturnType<typeof getWeatherForDate>,
  ) => string;
};

function getChinaWeekday(ts: number): number {
  return new Date(ts + CHINA_TZ_OFFSET_MS).getUTCDay();
}

function pickRandom<T>(items: T[], rng: () => number): T | null {
  if (items.length === 0) return null;
  return items[Math.floor(rng() * items.length)] ?? null;
}

function clampStat(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function addSeeds(state: FarmStateV2, cropId: CropIdV2, qty: number) {
  state.seedInventory[cropId] = (state.seedInventory[cropId] ?? 0) + qty;
}

function pickFridaySeedCrop(state: FarmStateV2, season: ReturnType<typeof getCurrentSeason>, rng: () => number): CropIdV2 {
  const plantable = getPlantableCrops(state, season);
  if (plantable.length > 0) return pickRandom(plantable, rng) ?? 'wheat';

  const unlockedLandCount = state.lands.filter((land) => land.status !== 'locked').length;
  const unlocked = Object.values(CROPS_V2)
    .filter((crop) => crop.unlockLandCount <= unlockedLandCount)
    .map((crop) => crop.id);
  return pickRandom(unlocked, rng) ?? 'wheat';
}

function removeRandomSeed(state: FarmStateV2, rng: () => number): string {
  const entries = Object.entries(state.seedInventory)
    .filter((entry): entry is [CropIdV2, number] => (entry[1] ?? 0) > 0);
  const picked = pickRandom(entries, rng);
  if (!picked) return '仓库正好没有种子，损失被避开了';

  const [cropId, count] = picked;
  state.seedInventory[cropId] = Math.max(0, count - 1);
  return `${CROPS_V2[cropId].name}种子 -1`;
}

function removeRandomInventoryItem(state: FarmStateV2, rng: () => number): string | null {
  const entries = Object.entries(state.inventory)
    .filter((entry): entry is [ShopItemKey, { count: number; updatedAt: number }] => (entry[1]?.count ?? 0) > 0);
  const picked = pickRandom(entries, rng);
  if (!picked) return null;

  const [key, item] = picked;
  item.count = Math.max(0, item.count - 1);
  return `${SHOP_ITEMS_V2[key]?.name ?? '道具'} -1`;
}

function getUnfinishedCropLands(state: FarmStateV2) {
  return state.lands.filter((land) => land.crop && (land.status === 'growing' || land.status === 'thirsty'));
}

function getCrowEventTargets(state: FarmStateV2, now: number) {
  return state.lands.filter((land) => {
    if (!land.crop) return false;
    if (land.status !== 'growing' && land.status !== 'thirsty' && land.status !== 'mature') return false;
    if (now - land.crop.plantedAt < FRIDAY_EVENT_CROP_DELAY_MS) return false;
    if (land.crop.birdNetUntil && land.crop.birdNetUntil > now) return false;
    return true;
  });
}

const FRIDAY_RANDOM_EVENTS: FridayRandomEvent[] = [
  {
    apply: (state, rng, _now, season) => {
      const cropId = pickFridaySeedCrop(state, season, rng);
      addSeeds(state, cropId, 2);
      return `周五随机事件：丰收商队路过，送来 ${CROPS_V2[cropId].name}种子 ×2`;
    },
  },
  {
    apply: (state, _rng, now) => {
      addToInventory(state, 'fert_normal', 1, now);
      return '周五随机事件：园艺补给箱送达，获得普通肥料 ×1';
    },
  },
  {
    apply: (state, _rng, now, season, weather) => {
      const lands = getUnfinishedCropLands(state);
      if (lands.length === 0) {
        addToInventory(state, 'cloud_bottle', 1, now);
        return '周五随机事件：午后云雨没有找到作物，凝成了云朵瓶 ×1';
      }

      lands.forEach((land) => {
        if (!land.crop) return;
        const intervalMs = computeActualWaterIntervalMs(land.crop.cropId, season, weather);
        land.crop.lastWaterAt = now;
        land.crop.nextWaterDueAt = now + intervalMs;
        land.crop.waterMissCount = Math.max(0, land.crop.waterMissCount - 1);
        land.status = 'growing';
      });
      return `周五随机事件：午后云雨滋润了 ${lands.length} 块未成熟作物`;
    },
  },
  {
    apply: (state, _rng, now) => {
      if (!state.pet) {
        addToInventory(state, 'pet_milk', 1, now);
        return '周五随机事件：邻居送来宠物牛奶 ×1，留给未来的小伙伴';
      }

      const petName = state.pet.name || PET_TYPE_LABEL[state.pet.type];
      state.pet.mood = clampStat(state.pet.mood + 12);
      state.pet.health = clampStat(state.pet.health + 5);
      state.pet.thirst = clampStat(state.pet.thirst + 8);
      return `周五随机事件：${petName}今天心情特别好，情绪、健康和口渴值提升`;
    },
  },
  {
    apply: (state, rng) => {
      const lands = getUnfinishedCropLands(state);
      if (lands.length === 0) {
        return `周五随机事件：干燥热风吹过仓库，${removeRandomSeed(state, rng)}`;
      }

      lands.forEach((land) => {
        if (!land.crop) return;
        land.crop.waterMissCount = Math.min(2, land.crop.waterMissCount + 1);
        land.status = 'thirsty';
      });
      return `周五随机事件：干燥热风来袭，${lands.length} 块未成熟作物变得口渴`;
    },
  },
  {
    apply: (state, rng) => {
      const lands = getUnfinishedCropLands(state);
      const target = pickRandom(lands, rng);
      if (!target?.crop) {
        return `周五随机事件：杂草疯长到仓库边，${removeRandomSeed(state, rng)}`;
      }

      target.crop.matureAt += 10 * 60 * 1000;
      return `周五随机事件：第 ${target.index} 块地杂草疯长，${CROPS_V2[target.crop.cropId].name}成熟延后 10 分钟`;
    },
  },
  {
    apply: (state, rng, now) => {
      const target = pickRandom(getCrowEventTargets(state, now), rng);
      if (!target?.crop) {
        return `周五随机事件：乌鸦侦察队扑了个空，${removeRandomSeed(state, rng)}`;
      }

      const cropName = CROPS_V2[target.crop.cropId].name;
      target.status = 'eaten';
      target.crop = null;
      return `周五随机事件：乌鸦侦察队突袭，第 ${target.index} 块地的 ${cropName} 被吃掉了`;
    },
  },
  {
    apply: (state, rng) => {
      const seedLoss = removeRandomSeed(state, rng);
      if (!seedLoss.includes('避开')) {
        return `周五随机事件：货车延误弄丢了一份货物，${seedLoss}`;
      }

      const itemLoss = removeRandomInventoryItem(state, rng);
      if (itemLoss) return `周五随机事件：货车延误弄丢了一份货物，${itemLoss}`;
      return `周五随机事件：货车延误，但仓库太空，什么都没有损失`;
    },
  },
];

function maybeApplyFridayEvent(state: FarmStateV2, now: number): FarmStateV2 {
  const date = getChinaDateString(now);
  if (getChinaWeekday(now) !== 5) return state;
  if (state.lastFridayEventDate === date) return state;

  const season = getCurrentSeason(now);
  const weather = getWeatherForDate(date, season);
  const rng = seedrandom(`farm-friday-event:${state.userId}:${date}`);
  const event = pickRandom(FRIDAY_RANDOM_EVENTS, rng);
  if (!event) return state;

  const text = event.apply(state, rng, now, season, weather);
  state.lastFridayEventDate = date;
  pushEvent(state, { id: nanoid(), ts: now, type: 'friday_event', text });
  return state;
}

/** 核心 tick：跨日衰减 → 跨季 → 雨天浇水 → 宠物自动浇水 → 推进缺水 → 乌鸦判定 → 宠物任务结束 */
export function tickFarm(state: FarmStateV2, now: number): FarmStateV2 {
  const lastTick = state.lastTickAt;
  const season = getCurrentSeason(now);
  const date = getChinaDateString(now);
  const weather = getWeatherForDate(date, season);

  processPetDailyDecay(state, now);
  processPetTimeDecay(state, lastTick, now);
  maybeApplySeasonChange(state, now);
  applyRainAutoWater(state, lastTick, now);
  processPetWaterTask(state, lastTick, now);
  advanceWaterMisses(state, now, season, weather);
  runCrowChecks(state, lastTick, now);
  maybeApplyFridayEvent(state, now);

  // 检查作物成熟事件（只为新成熟的作物追加事件）
  state.lands.forEach((land) => {
    if (!land.crop) return;
    if (land.status === 'growing' || land.status === 'thirsty') {
      if (now >= land.crop.matureAt) {
        land.status = 'mature';
        pushEvent(state, {
          id: nanoid(), ts: land.crop.matureAt, type: 'mature',
          text: `${CROPS_V2[land.crop.cropId].name} 成熟了，快去收获`,
          cropId: land.crop.cropId,
          landIndex: land.index,
        });
      }
    }
    // 检查过熟腐烂（48 小时）
    if (land.status === 'mature' && now > land.crop.matureAt + 48 * 60 * 60 * 1000) {
      land.status = 'withered';
      pushEvent(state, {
        id: nanoid(), ts: now, type: 'wither',
        text: `${CROPS_V2[land.crop.cropId].name} 过熟腐烂枯萎`,
        cropId: land.crop.cropId,
      });
    }
  });

  processPetTaskEnd(state, now);

  const stopped = maybeStopWorkOnLowMood(state, now);
  if (stopped.stopped && stopped.taskName) {
    const taskLabel: Record<string, string> = {
      water: '自动浇水', guard: '守护庄园', chase_crow: '赶乌鸦', steal: '偷菜',
      harvest: '收菜', plant: '种菜',
    };
    pushEvent(state, {
      id: nanoid(), ts: now, type: 'pet_task',
      text: `情绪太低，宠物罢工，${taskLabel[stopped.taskName] ?? '任务'}被中止`,
    });
  }

  state.lastTickAt = now;
  state.updatedAt = now;
  return state;
}

async function saveState(state: FarmStateV2) {
  await kv.set(FARM_V2_STATE_KEY(state.userId), state);
}

export interface FarmMaturityEmailScanResult {
  success: true;
  scannedUsers: number;
  processedUsers: number;
  lockedUsers: number;
  checkedEvents: number;
  sent: number;
  skipped: number;
  failed: number;
  cursor: number;
}

function normalizeScanLimit(maxUsers: number): number {
  if (!Number.isFinite(maxUsers)) return 100;
  return Math.max(1, Math.min(Math.floor(maxUsers), 500));
}

function parseStateUserId(key: string): number | null {
  const match = key.match(/^farmv2:state:(\d+)$/);
  if (!match) return null;
  const userId = Number.parseInt(match[1], 10);
  return Number.isFinite(userId) ? userId : null;
}

/**
 * 定时扫描农场状态：
 * 1. 先 tick，使到点的作物产生 mature 事件；
 * 2. 再按 mature 事件发送邮件；
 * 3. 通过事件级去重键保证同一成熟事件不会重复发送。
 */
export async function processFarmMaturityEmails(maxUsers = 100): Promise<FarmMaturityEmailScanResult> {
  const limit = normalizeScanLimit(maxUsers);
  let cursor = await kv.get<number>(FARM_MATURITY_EMAIL_SCAN_CURSOR_KEY) ?? 0;
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  const result: FarmMaturityEmailScanResult = {
    success: true,
    scannedUsers: 0,
    processedUsers: 0,
    lockedUsers: 0,
    checkedEvents: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    cursor: 0,
  };

  while (result.scannedUsers < limit) {
    const scanCount = Math.min(100, limit - result.scannedUsers);
    const [nextCursor, keys] = await kv.scan(cursor, { match: 'farmv2:state:*', count: scanCount });
    if (keys.length === 0) {
      cursor = 0;
      break;
    }

    for (const key of keys) {
      if (result.scannedUsers >= limit) break;
      result.scannedUsers += 1;

      const userId = parseStateUserId(key);
      if (userId == null) continue;

      const lock = await acquireLock(userId);
      if (!lock) {
        result.lockedUsers += 1;
        continue;
      }

      try {
        const stored = await kv.get<FarmStateV2>(key);
        if (!stored) continue;

        const now = Date.now();
        const state = normalizeState(stored);
        tickFarm(state, now);
        await saveState(state);

        const emailResult = await processMaturityEmailEventsForState(state, now);
        result.processedUsers += 1;
        result.checkedEvents += emailResult.checked;
        result.sent += emailResult.sent;
        result.skipped += emailResult.skipped;
        result.failed += emailResult.failed;
      } finally {
        await releaseLock(lock);
      }
    }

    cursor = nextCursor;
    if (cursor === 0) break;
  }

  result.cursor = cursor;
  await kv.set(FARM_MATURITY_EMAIL_SCAN_CURSOR_KEY, cursor);
  return result;
}

/** 用锁包装的 tick + save */
async function withLock<T>(userId: number, fn: (state: FarmStateV2) => Promise<T>): Promise<{ result?: T; error?: string }> {
  const lock = await acquireLock(userId);
  if (!lock) return { error: '操作处理中，请稍后重试' };
  try {
    const state = await getOrCreateFarmV2(userId);
    const now = Date.now();
    tickFarm(state, now);
    const result = await fn(state);
    await saveState(state);
    return { result };
  } finally {
    await releaseLock(lock);
  }
}

/** 公开接口：获取状态（含 tick） */
export async function getFarmStatus(userId: number): Promise<FarmStatusResponse> {
  const lock = await acquireLock(userId);
  let state: FarmStateV2;
  try {
    state = await getOrCreateFarmV2(userId);
    const now = Date.now();
    tickFarm(state, now);
    if (lock) await saveState(state);
  } finally {
    if (lock) await releaseLock(lock);
  }
  const now = Date.now();
  const season = getCurrentSeason(now);
  const date = getChinaDateString(now);
  const weather = getWeatherForDate(date, season);
  const tomorrowAtMidnight = getChinaMidnight(now) + 24 * 60 * 60 * 1000;
  const tomorrowSeason = getCurrentSeason(tomorrowAtMidnight);
  const tomorrowDate = getChinaDateString(tomorrowAtMidnight);
  const tomorrowWeather = getWeatherForDate(tomorrowDate, tomorrowSeason);
  const computedLands = buildComputedLands(state, now);
  return {
    state,
    computedLands,
    world: { date, weather, season, generatedAt: now },
    weatherForecast: {
      tomorrow: {
        date: tomorrowDate,
        weather: tomorrowWeather,
        season: tomorrowSeason,
        generatedAt: now,
      },
    },
    serverNow: now,
    plantableCrops: getPlantableCrops(state, season),
    nextSeasonInMs: getNextSeasonChangeMs(now),
    nextDailyInMs: getNextDailyResetMs(now),
  };
}

/** 种植 */
export async function plantCrop(
  userId: number, plotIndex: number, cropId: CropIdV2,
): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const lockResult = await withLock(userId, async (state) => {
    const now = Date.now();
    const season = getCurrentSeason(now);
    const date = getChinaDateString(now);
    const weather = getWeatherForDate(date, season);

    if (plotIndex < 0 || plotIndex >= state.lands.length) {
      return { ok: false, msg: '无效土地' };
    }
    const land = state.lands[plotIndex];
    if (land.status === 'locked') return { ok: false, msg: '土地未解锁' };
    if (land.status !== 'empty' && land.status !== 'eaten') return { ok: false, msg: '土地不为空' };

    const cropDef = CROPS_V2[cropId];
    if (!cropDef) return { ok: false, msg: '未知作物' };
    if (!cropDef.seasons.includes(season)) return { ok: false, msg: '当前季节不能种植该作物' };

    const unlockedLandCount = state.lands.filter((l) => l.status !== 'locked').length;
    if (cropDef.unlockLandCount > unlockedLandCount) return { ok: false, msg: '该作物尚未解锁' };

    // 检查种子库存
    const seedCount = state.seedInventory[cropId] ?? 0;
    if (seedCount < 1) return { ok: false, msg: `背包没有 ${cropDef.name} 种子，请先去商店购买` };

    // 消耗种子
    state.seedInventory[cropId] = seedCount - 1;
    const growthMs = computeActualGrowthMs(cropId, season, null);
    const intervalMs = computeActualWaterIntervalMs(cropId, season, weather);

    land.status = 'growing';
    land.crop = {
      cropId,
      plantedAt: now,
      matureAt: now + growthMs,
      lastWaterAt: now,
      nextWaterDueAt: now + intervalMs,
      waterMissCount: 0,
      fertilizer: null,
      plantedSeason: season,
      weatherAtPlant: weather,
      birdNetUntil: null,
      stolenAmount: 0,
      stolenCount: 0,
      speedUsed: 0,
      speedReducedMinutes: 0,
    };
    pushEvent(state, {
      id: nanoid(), ts: now, type: 'plant',
      text: `种下了 ${cropDef.name}`,
      cropId,
    });
    return { ok: true, balance: state.points };
  });
  return lockResult.error ? { ok: false, msg: lockResult.error } : (lockResult.result as { ok: boolean; msg?: string; balance?: number });
}

const PET_AUTO_PLANT_MAX = 3;

function pickPetPlantCrop(state: FarmStateV2, season: ReturnType<typeof getCurrentSeason>): CropIdV2 | null {
  const unlockedLandCount = state.lands.filter((l) => l.status !== 'locked').length;
  const candidate = Object.values(CROPS_V2)
    .filter((crop) => crop.seasons.includes(season))
    .filter((crop) => crop.unlockLandCount <= unlockedLandCount)
    .filter((crop) => (state.seedInventory[crop.id] ?? 0) > 0)
    .sort((a, b) => b.baseYield - a.baseYield || a.growthMinutes - b.growthMinutes)[0];
  return candidate?.id ?? null;
}

function plantCropFromInventory(
  state: FarmStateV2,
  plotIndex: number,
  cropId: CropIdV2,
  now: number,
  season: ReturnType<typeof getCurrentSeason>,
  weather: ReturnType<typeof getWeatherForDate>,
): boolean {
  const land = state.lands[plotIndex];
  if (!land || (land.status !== 'empty' && land.status !== 'eaten')) return false;
  const seedCount = state.seedInventory[cropId] ?? 0;
  if (seedCount <= 0) return false;

  state.seedInventory[cropId] = seedCount - 1;
  const growthMs = computeActualGrowthMs(cropId, season, null);
  const intervalMs = computeActualWaterIntervalMs(cropId, season, weather);
  land.status = 'growing';
  land.crop = {
    cropId,
    plantedAt: now,
    matureAt: now + growthMs,
    lastWaterAt: now,
    nextWaterDueAt: now + intervalMs,
    waterMissCount: 0,
    fertilizer: null,
    plantedSeason: season,
    weatherAtPlant: weather,
    birdNetUntil: null,
    stolenAmount: 0,
    stolenCount: 0,
    speedUsed: 0,
    speedReducedMinutes: 0,
  };
  return true;
}

/** 浇水 */
export async function waterPlot(userId: number, plotIndex: number): Promise<{ ok: boolean; msg?: string; bonus?: number; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    const now = Date.now();
    const season = getCurrentSeason(now);
    const weather = getWeatherForDate(getChinaDateString(now), season);
    if (plotIndex < 0 || plotIndex >= state.lands.length) return { ok: false, msg: '无效土地' };
    const land = state.lands[plotIndex];
    if (!land.crop) return { ok: false, msg: '土地上没有作物' };
    if (land.status === 'mature') return { ok: false, msg: '作物已成熟' };
    if (land.status === 'withered') return { ok: false, msg: '作物已枯萎' };
    const interval = computeActualWaterIntervalMs(land.crop.cropId, season, weather);
    land.crop.lastWaterAt = now;
    land.crop.nextWaterDueAt = now + interval;
    land.status = 'growing';
    let bonus = 0;
    if (!state.bonuses.firstWater) {
      state.bonuses.firstWater = true;
      const r = await addPoints(userId, ONBOARDING_BONUS.firstWater, 'game_play', '农场首次浇水奖励');
      state.points = r.balance;
      bonus = ONBOARDING_BONUS.firstWater;
    }
    return { ok: true, bonus, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 一键浇水 */
export async function waterAllPlots(userId: number): Promise<{ ok: boolean; count?: number; msg?: string }> {
  const r = await withLock(userId, async (state) => {
    const now = Date.now();
    const season = getCurrentSeason(now);
    const weather = getWeatherForDate(getChinaDateString(now), season);
    let count = 0;
    state.lands.forEach((land) => {
      if (!land.crop) return;
      if (land.status === 'mature' || land.status === 'withered' || land.status === 'eaten' || land.status === 'locked' || land.status === 'empty') return;
      const interval = computeActualWaterIntervalMs(land.crop.cropId, season, weather);
      land.crop.lastWaterAt = now;
      land.crop.nextWaterDueAt = now + interval;
      land.status = 'growing';
      count += 1;
    });
    return { ok: true, count };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 收获单块 */
export async function harvestPlot(userId: number, plotIndex: number): Promise<{ ok: boolean; msg?: string; result?: HarvestResult; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    const now = Date.now();
    if (plotIndex < 0 || plotIndex >= state.lands.length) return { ok: false, msg: '无效土地' };
    const land = state.lands[plotIndex];
    if (!land.crop) return { ok: false, msg: '土地上没有作物' };
    if (land.status === 'withered') return { ok: false, msg: '作物已枯萎' };
    if (land.status !== 'mature') return { ok: false, msg: '作物未成熟' };

    const result = doHarvestSingle(state, plotIndex, now);
    const r = await addPoints(userId, result.finalYield, 'game_play', `农场收获: ${result.cropName}（${result.quality}）`);
    state.points = r.balance;
    let bonus = 0;
    if (!state.bonuses.firstHarvest) {
      state.bonuses.firstHarvest = true;
      const b = await addPoints(userId, ONBOARDING_BONUS.firstHarvest, 'game_play', '农场首次收获奖励');
      state.points = b.balance;
      bonus = ONBOARDING_BONUS.firstHarvest;
    }
    return { ok: true, result, balance: state.points, bonus };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

function doHarvestSingle(state: FarmStateV2, plotIndex: number, now: number): HarvestResult {
  const land = state.lands[plotIndex];
  const crop = land.crop!;
  const season = getCurrentSeason(now);
  const perfect = isPerfectCare(crop, now);
  const rates = rollQualityRates(crop.fertilizer, crop.waterMissCount, perfect);
  const rng = seedrandom(`harvest:${state.userId}:${crop.plantedAt}:${plotIndex}`);
  const quality = pickQuality(rates, rng);
  const overripe = computeOverripeFactor(crop, now);
  const finalYield = computeFinalYield(crop.cropId, quality, crop.waterMissCount, season, overripe, crop.stolenAmount);
  const cropDef = CROPS_V2[crop.cropId];

  const result: HarvestResult = {
    cropId: crop.cropId,
    cropName: cropDef.name,
    quality,
    baseYield: cropDef.baseYield,
    qualityMultiplier: { normal: 1.0, silver: 1.3, gold: 1.8 }[quality],
    waterMultiplier: crop.waterMissCount === 0 ? 1.0 : (crop.waterMissCount === 1 ? 0.8 : crop.waterMissCount === 2 ? 0.5 : 0),
    seasonMultiplier: season === 'autumn' ? 1.10 : 1.0,
    overripeMultiplier: overripe,
    stolenDeduct: crop.stolenAmount,
    finalYield,
    perfect,
  };
  pushEvent(state, {
    id: nanoid(), ts: now, type: 'harvest',
    text: `收获了 ${cropDef.name}（${quality === 'gold' ? '金星' : quality === 'silver' ? '银星' : '普通'}）+${finalYield} 积分`,
    cropId: crop.cropId, amount: finalYield,
  });
  // 清空土地
  land.status = 'empty';
  land.crop = null;
  return result;
}

export async function harvestAllPlots(userId: number): Promise<{ ok: boolean; msg?: string; results?: HarvestResult[]; total?: number; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    const now = Date.now();
    const results: HarvestResult[] = [];
    let total = 0;
    state.lands.forEach((land, i) => {
      if (land.status === 'mature' && land.crop) {
        const r = doHarvestSingle(state, i, now);
        results.push(r);
        total += r.finalYield;
      }
    });
    if (results.length === 0) return { ok: false, msg: '没有可收获的作物' };
    const r = await addPoints(userId, total, 'game_play', `农场一键收获: ${results.length} 块`);
    state.points = r.balance;
    if (!state.bonuses.firstHarvest) {
      state.bonuses.firstHarvest = true;
      const b = await addPoints(userId, ONBOARDING_BONUS.firstHarvest, 'game_play', '农场首次收获奖励');
      state.points = b.balance;
    }
    return { ok: true, results, total, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 清除枯萎作物 */
export async function removeWithered(userId: number, plotIndex: number): Promise<{ ok: boolean; msg?: string }> {
  const r = await withLock(userId, async (state) => {
    if (plotIndex < 0 || plotIndex >= state.lands.length) return { ok: false, msg: '无效土地' };
    const land = state.lands[plotIndex];
    if (land.status !== 'withered' && land.status !== 'eaten') return { ok: false, msg: '该土地不需要清除' };
    land.status = 'empty';
    land.crop = null;
    return { ok: true };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 购买种子 */
export async function buySeeds(userId: number, cropId: CropIdV2, qty: number): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    const cropDef = CROPS_V2[cropId];
    if (!cropDef) return { ok: false, msg: '未知作物' };
    if (qty <= 0 || qty > 99) return { ok: false, msg: '数量无效' };
    const unlockedLandCount = state.lands.filter((l) => l.status !== 'locked').length;
    if (cropDef.unlockLandCount > unlockedLandCount) return { ok: false, msg: '作物尚未解锁' };
    const totalCost = cropDef.seedCost * qty;
    if (state.points < totalCost) return { ok: false, msg: '积分不足' };
    const ded = await deductPoints(userId, totalCost, 'exchange', `农场购买种子: ${cropDef.name} x${qty}`);
    if (!ded.success) return { ok: false, msg: ded.message ?? '积分不足' };
    state.points = ded.balance;
    state.seedInventory[cropId] = (state.seedInventory[cropId] ?? 0) + qty;
    return { ok: true, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 购买扩建土地 */
export async function buyLand(userId: number, landIndex: number): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    const land = state.lands.find((l) => l.index === landIndex);
    if (!land) return { ok: false, msg: '无效土地编号' };
    if (land.status !== 'locked') return { ok: false, msg: '该土地已解锁' };
    // 必须按顺序
    const prev = state.lands.find((l) => l.index === landIndex - 1);
    if (prev && prev.status === 'locked') return { ok: false, msg: '请先解锁前一块土地' };
    const price = LAND_UNLOCK_PRICES[landIndex] ?? 0;
    const ded = await deductPoints(userId, price, 'exchange', `农场购买第 ${landIndex} 块土地`);
    if (!ded.success) return { ok: false, msg: ded.message ?? '积分不足' };
    state.points = ded.balance;
    land.status = 'empty';
    pushEvent(state, { id: nanoid(), ts: Date.now(), type: 'land_buy', text: `开垦了第 ${landIndex} 块土地（-${price}积分）` });
    return { ok: true, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 商店列表 */
export async function getShopItems() {
  return Object.values(await getEffectiveFarmShopItems());
}

/** 购买道具 */
export async function buyItem(userId: number, key: ShopItemKey, qty: number): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const effectiveDef = await getEffectiveFarmShopItem(key);
  const r = await withLock(userId, async (state) => {
    const def = effectiveDef ?? SHOP_ITEMS_V2[key];
    if (!def) return { ok: false, msg: '未知道具' };
    if (qty <= 0 || qty > 99) return { ok: false, msg: '数量无效' };
    const skill = PET_SKILL_BOOK_TO_SKILL[key as PetSkillBookKey];
    const oneTimeItem = ONE_TIME_SHOP_ITEM_KEYS.includes(key as (typeof ONE_TIME_SHOP_ITEM_KEYS)[number]);
    if (skill) {
      if (qty !== 1) return { ok: false, msg: '技能书每种限购 1 本' };
      const skillBookKey = key as PetSkillBookKey;
      const alreadyPurchased = state.purchasedSkillBooks?.[skillBookKey]
        || (state.inventory[skillBookKey]?.count ?? 0) > 0
        || (state.pet?.learnedSkills ?? []).includes(skill);
      if (alreadyPurchased) return { ok: false, msg: '该技能书已购买，不能重复购买' };
    }
    if (oneTimeItem) {
      if (qty !== 1) return { ok: false, msg: '该设备每个账号只能购买 1 台' };
      if ((state.inventory[key]?.count ?? 0) > 0) return { ok: false, msg: '该设备已购买，不能重复购买' };
    }
    const dailyLimit = Number(def.dailyLimit ?? 0);
    let dailyKey: string | null = null;
    if (Number.isSafeInteger(dailyLimit) && dailyLimit > 0) {
      const today = getChinaDateString(Date.now());
      dailyKey = `farmv2:shop:daily:${userId}:${today}:${key}`;
      const purchasedToday = Number(await kv.get<number>(dailyKey)) || 0;
      if (purchasedToday + qty > dailyLimit) {
        return { ok: false, msg: `今日限购 ${dailyLimit} 个` };
      }
    }
    const totalCost = def.cost * qty;
    const ded = await deductPoints(userId, totalCost, 'exchange', `农场购买: ${def.name} x${qty}`);
    if (!ded.success) return { ok: false, msg: ded.message ?? '积分不足' };
    state.points = ded.balance;
    addToInventory(state, key, qty, Date.now());
    if (dailyKey) {
      const store = kv as typeof kv & {
        incrby?: (key: string, amount: number) => Promise<number>;
        expire?: (key: string, seconds: number) => Promise<unknown>;
      };
      const count = typeof store.incrby === 'function'
        ? await store.incrby(dailyKey, qty)
        : ((Number(await kv.get<number>(dailyKey)) || 0) + qty);
      if (typeof store.incrby !== 'function') {
        await kv.set(dailyKey, count);
      }
      if (count === qty) {
        await store.expire?.(dailyKey, 48 * 60 * 60);
      }
    }
    if (skill) {
      state.purchasedSkillBooks = { ...(state.purchasedSkillBooks ?? {}), [key as PetSkillBookKey]: true };
    }
    return { ok: true, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 使用道具 */
export async function useItem(userId: number, key: ShopItemKey, plotIndex?: number): Promise<{ ok: boolean; msg?: string }> {
  const [items, petEffects] = await Promise.all([
    getEffectiveFarmShopItems(),
    getEffectivePetItemEffects(),
  ]);
  const r = await withLock(userId, async (state) => {
    return applyItemUse(state, key, Date.now(), plotIndex, { items, petEffects });
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 领养宠物 */
export async function adoptPet(userId: number, type: PetType, name?: string): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const r = await withLock(userId, async (state) => {
    if (state.pet) return { ok: false, msg: '你已领养过宠物' };
    const now = Date.now();
    const isFirstAdopt = !state.bonuses.firstAdopt;
    if (!isFirstAdopt) {
      const ded = await deductPoints(userId, PET_ADOPT_COST, 'exchange', '农场再次领养宠物');
      if (!ded.success) return { ok: false, msg: ded.message ?? '积分不足' };
      state.points = ded.balance;
    }

    const petName = normalizePetName(type, name);
    state.pet = createPet(type, now, petName);
    let bonus = 0;
    if (isFirstAdopt) {
      state.bonuses.firstAdopt = true;
      const r = await addPoints(userId, ONBOARDING_BONUS.firstAdopt, 'game_play', '农场首次领养奖励');
      state.points = r.balance;
      bonus = ONBOARDING_BONUS.firstAdopt;
    }
    pushEvent(state, {
      id: nanoid(),
      ts: now,
      type: 'pet_adopted',
      text: `领养了 ${petName}（${PET_TYPE_LABEL[type]}）！${isFirstAdopt ? '' : ` -${PET_ADOPT_COST} 积分`}`,
    });
    return { ok: true, balance: state.points, bonus };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 通用：使用宠物物品（消耗背包，免费物品直接使用） */
async function applyPetItemAction(userId: number, itemKey: ShopItemKey, expectedCategory: 'feed' | 'drink' | 'care' | 'rest' | 'play'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const [effectiveDef, petEffects] = await Promise.all([
    getEffectiveFarmShopItem(itemKey),
    getEffectivePetItemEffects(),
  ]);
  const r = await withLock(userId, async (state) => {
    const def = effectiveDef ?? SHOP_ITEMS_V2[itemKey];
    if (!def) return { ok: false, msg: '未知物品' };
    const cat = getItemCategory(itemKey, petEffects);
    if (cat !== expectedCategory) return { ok: false, msg: '物品类别不匹配' };
    if (def.cost > 0) {
      const inv = state.inventory[itemKey];
      if (!inv || inv.count < 1) return { ok: false, msg: `库存不足，请先在商店购买${def.name}` };
      inv.count -= 1;
    }
    const r = applyPetItemEffect(state, itemKey, petEffects);
    return { ok: r.ok, msg: r.msg, balance: state.points };
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as { ok: boolean; msg?: string; balance?: number });
}

/** 喂食：消耗宠粮物品 */
export async function feedPetAction(userId: number, kind: 'normal' | 'premium'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  const itemKey: ShopItemKey = kind === 'normal' ? 'pet_food_normal' : 'pet_food_premium';
  return applyPetItemAction(userId, itemKey, 'feed');
}

/** 喂水：可选 itemKey，默认免费 pet_water_basic */
export async function drinkPetAction(userId: number, itemKey: ShopItemKey = 'pet_water_basic'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  return applyPetItemAction(userId, itemKey, 'drink');
}

/** 保养：可选 itemKey，默认免费 pet_care_basic */
export async function carePetAction(userId: number, itemKey: ShopItemKey = 'pet_care_basic'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  return applyPetItemAction(userId, itemKey, 'care');
}

/** 休息：可选 itemKey，默认免费 pet_rest_basic */
export async function restPetAction(userId: number, itemKey: ShopItemKey = 'pet_rest_basic'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  return applyPetItemAction(userId, itemKey, 'rest');
}

/** 陪玩：可选 itemKey，默认免费 pet_play_basic */
export async function playPetItemAction(userId: number, itemKey: ShopItemKey = 'pet_play_basic'): Promise<{ ok: boolean; msg?: string; balance?: number }> {
  return applyPetItemAction(userId, itemKey, 'play');
}

/** 派遣宠物任务 */
export async function dispatchPet(
  userId: number, task: Exclude<PetTask, null>, opts?: { targetUserId?: number; targetLandIndex?: number; targetCropId?: CropIdV2 },
): Promise<{ ok: boolean; msg?: string }> {
  const r = await withLock(userId, async (state) => {
    const now = Date.now();

    if (task === 'harvest') {
      const ready = validatePetSkillReady(state, task, now);
      if (!ready.ok) return ready;
      const matureIndexes = state.lands
        .map((land, index) => (land.status === 'mature' && land.crop ? index : -1))
        .filter((index) => index >= 0);
      if (matureIndexes.length === 0) return { ok: false, msg: '没有成熟作物可收' };

      const dispatched = dispatchPetTask(state, task, now, opts);
      if (!dispatched.ok) return dispatched;

      const results = matureIndexes.map((index) => doHarvestSingle(state, index, now));
      const total = results.reduce((sum, item) => sum + item.finalYield, 0);
      const pointResult = await addPoints(userId, total, 'game_play', `宠物收菜: ${results.length} 块`);
      state.points = pointResult.balance;
      if (!state.bonuses.firstHarvest) {
        state.bonuses.firstHarvest = true;
        const bonus = await addPoints(userId, ONBOARDING_BONUS.firstHarvest, 'game_play', '农场首次收获奖励');
        state.points = bonus.balance;
      }
      pushEvent(state, {
        id: nanoid(), ts: now, type: 'pet_task',
        text: `宠物收菜技能发动，收获 ${results.length} 块作物，获得 ${total} 积分`,
      });
      return { ok: true, msg: `宠物收菜完成：${results.length} 块，+${total} 积分` };
    }

    if (task === 'plant') {
      const ready = validatePetSkillReady(state, task, now);
      if (!ready.ok) return ready;
      const emptyIndexes = state.lands
        .map((land, index) => (land.status === 'empty' || land.status === 'eaten' ? index : -1))
        .filter((index) => index >= 0)
        .slice(0, PET_AUTO_PLANT_MAX);
      if (emptyIndexes.length === 0) return { ok: false, msg: '没有空地可种' };

      const season = getCurrentSeason(now);
      const weather = getWeatherForDate(getChinaDateString(now), season);
      const planned: CropIdV2[] = [];
      for (const index of emptyIndexes) {
        const cropId = pickPetPlantCrop(state, season);
        if (!cropId) break;
        if (plantCropFromInventory(state, index, cropId, now, season, weather)) {
          planned.push(cropId);
        }
      }
      if (planned.length === 0) return { ok: false, msg: '没有当前季节可播种的种子' };

      const dispatched = dispatchPetTask(state, task, now, opts);
      if (!dispatched.ok) return dispatched;
      const names = planned.map((cropId) => CROPS_V2[cropId].name).join('、');
      pushEvent(state, {
        id: nanoid(), ts: now, type: 'pet_task',
        text: `宠物种菜技能发动，自动播种 ${planned.length} 块：${names}`,
      });
      return { ok: true, msg: `宠物种菜完成：播种 ${planned.length} 块` };
    }

    return dispatchPetTask(state, task, now, opts);
  });
  return r.error ? { ok: false, msg: r.error } : (r.result as any);
}

/** 偷菜：列表 */
export { listStealCandidates };

/** 偷菜：执行（需要双方加锁） */
export async function executeSteal(
  thiefId: number, targetUserId: number, landIndex: number,
): Promise<{ ok: boolean; msg?: string; success?: boolean; amount?: number; lucky?: boolean; balance?: number }> {
  if (thiefId === targetUserId) return { ok: false, msg: '不能偷自己' };
  const lockA = await acquireLock(thiefId);
  if (!lockA) return { ok: false, msg: '操作处理中' };
  const lockB = await acquireLock(targetUserId);
  if (!lockB) { await releaseLock(lockA); return { ok: false, msg: '目标繁忙' }; }
  try {
    const thief = await getOrCreateFarmV2(thiefId);
    const target = await getOrCreateFarmV2(targetUserId);
    const now = Date.now();
    tickFarm(thief, now); tickFarm(target, now);

    if (!thief.pet || thief.pet.stage !== 'adult') return { ok: false, msg: '宠物未成年，不能偷菜' };
    const ready = validatePetSkillReady(thief, 'steal', now);
    if (!ready.ok) return ready;
    const myCnt = thief.myStealMap[String(targetUserId)] ?? 0;
    if (myCnt >= STEAL_LIMITS.perThiefDailyPerTarget) return { ok: false, msg: '今天已偷过该玩家' };
    if (target.stolenTodayCount >= STEAL_LIMITS.perPlayerDailyMaxBeingStolen) return { ok: false, msg: '该玩家今天被偷次数已达上限' };
    const land = target.lands[landIndex];
    if (!land?.crop || land.status !== 'mature') return { ok: false, msg: '目标作物不可偷' };
    if (land.crop.stolenCount >= STEAL_LIMITS.perCropMaxTimes) return { ok: false, msg: '该作物已被偷上限' };

    const dispatched = dispatchPetTask(thief, 'steal', now, { targetUserId, targetLandIndex: landIndex, targetCropId: land.crop.cropId });
    if (!dispatched.ok) return dispatched;

    const successRate = computeStealSuccessRate(thief, target, now);
    const success = Math.random() < successRate;
    if (!success) {
      // 写事件
      pushEvent(thief, { id: nanoid(), ts: now, type: 'pet_task', text: `偷菜失败：被对方守护住了` });
      thief.myStealMap[String(targetUserId)] = myCnt + 1;
      await Promise.all([saveState(thief), saveState(target)]);
      return { ok: true, success: false };
    }
    const isCat = thief.pet.type === 'cat';
    const { amount, lucky } = computeStealAmount(land.crop.cropId, isCat);
    const applied = applyStolenOnTarget(target, thiefId, landIndex, amount, now);
    if (!applied) return { ok: false, msg: '该作物已被偷上限' };
    const r = await addPoints(thiefId, amount, 'game_play', `偷菜成功: ${target.userId} 的 ${land.crop ? '' : ''}`);
    thief.points = r.balance;
    pushEvent(thief, { id: nanoid(), ts: now, type: 'stolen_out', text: `偷菜成功 +${amount} 积分${lucky ? '（小白猫的灵巧偷菜！）' : ''}`, amount });
    thief.myStealMap[String(targetUserId)] = myCnt + 1;
    await Promise.all([saveState(thief), saveState(target)]);
    return { ok: true, success: true, amount, lucky, balance: thief.points };
  } finally {
    await releaseLock(lockA);
    await releaseLock(lockB);
  }
}
