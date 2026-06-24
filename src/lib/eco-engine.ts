// 环保行动 —— 纯逻辑引擎（配置 + 服务端权威的挂机/产出/兑换计算）
//
// 设计要点（防作弊）：
// - 产出按"真实流逝时间 × 刷新速度"在服务端结算，封顶=回收袋容量；
//   玩家的拖拽只是"回收已累计的垃圾"，无法凭空制造。
// - 积分兑换：每 POINT_DIVISOR 个垃圾 = 1 袋；每袋积分价格 = pointMultiplier。
// - 所有数值集中在此，便于调平衡。

import type {
  EcoState,
  EcoUpgradeKey,
  EcoItemKey,
  EcoTrashKind,
  EcoPrizeInventory,
  EcoPrizeKey,
  EcoPrizeLot,
} from './types/eco';

export type EcoPrizeClaimStats = Partial<Record<EcoPrizeKey, number>> & {
  total?: number;
};

export type EcoPrizeSpawnRates = Partial<Record<EcoPrizeKey, number>>;

// ───────────────────────── 基础常量 ─────────────────────────

/** 每多少个垃圾兑换 1 袋（用户口径：10 个垃圾 = 1 积分起步） */
export const POINT_DIVISOR = 10;

export const BASE_SPAWN_PER_MIN = 10;
export const BASE_STORAGE_CAP = 80;
export const BASE_POINT_MULTIPLIER = 1;
export const BASE_AUTO_PER_MIN = 0;
export const BASE_GRAB_SIZE = 1;

/** 自动回收机器人每级速率（个/分钟）——刻意压低上限，克制纯挂机收益 */
export const AUTO_RATE_BY_LEVEL = [0, 1, 3, 5, 7, 10, 14];

/** 离线自动回收最多累计的产能（分钟）——克制纯挂机收益，鼓励主动游玩 */
export const OFFLINE_AUTO_CAP_MINUTES = 60;

/** 5 种垃圾外观（前端随机选取，单一回收桶） */
export const ECO_TRASH_KINDS: readonly EcoTrashKind[] = ['bottle', 'can', 'glass', 'paper', 'banana'];

export const ECO_TRASH_LABEL: Record<EcoTrashKind, string> = {
  bottle: '塑料瓶',
  can: '易拉罐',
  glass: '玻璃瓶',
  paper: '废纸板',
  banana: '果皮',
};

// ───────────────────────── 奖品配置 ─────────────────────────

interface PrizeDef {
  name: string;
  emoji: string;
  imageSrc: string;
  /** 在线生成一个物品时，额外刷出该奖品的概率 */
  spawnRate: number;
  minPrice: number;
  maxPrice: number;
}

export const ECO_PRIZES: Record<EcoPrizeKey, PrizeDef> = {
  diamond: {
    name: '钻石',
    emoji: '💎',
    imageSrc: '/images-optimized/ui/games/eco/prizes/diamond.webp?v=1',
    spawnRate: 0.00005,
    minPrice: 1000,
    maxPrice: 15000,
  },
  coin: {
    name: '金币',
    emoji: '🪙',
    imageSrc: '/images-optimized/ui/games/eco/prizes/coin.webp?v=1',
    spawnRate: 0.0001,
    minPrice: 1000,
    maxPrice: 9000,
  },
  necklace: {
    name: '项链',
    emoji: '📿',
    imageSrc: '/images-optimized/ui/games/eco/prizes/necklace.webp?v=1',
    spawnRate: 0.0003,
    minPrice: 1000,
    maxPrice: 7000,
  },
  trophy: {
    name: '奖杯',
    emoji: '🏆',
    imageSrc: '/images-optimized/ui/games/eco/prizes/trophy.webp?v=1',
    spawnRate: 0.0005,
    minPrice: 500,
    maxPrice: 5000,
  },
  photo: {
    name: '照片',
    emoji: '🖼️',
    imageSrc: '/images-optimized/ui/games/eco/prizes/photo.webp?v=1',
    spawnRate: 0.00001,
    minPrice: 5000,
    maxPrice: 50000,
  },
};

export const ECO_PRIZE_KEYS = Object.keys(ECO_PRIZES) as EcoPrizeKey[];
export const ECO_GLOBAL_PRIZE_LIMITS: Record<EcoPrizeKey, number> = {
  photo: 10,
  diamond: 10,
  coin: 15,
  necklace: 15,
  trophy: 20,
};
export const ECO_BASE_PRIZE_RATE = ECO_PRIZE_KEYS.reduce(
  (sum, key) => sum + ECO_PRIZES[key].spawnRate,
  0,
);
export const ECO_NORMAL_SINGLE_PRIZE_RATE = 1;
export const ECO_LUCKY_PRIZE_RATE = 5;
export const LUCKY_FLASHLIGHT_GENERATIONS = 200;
export const RECYCLE_GLOVE_USES = 50;
export const CLEAR_TRUCK_TRASH = 80;
export const MAX_VISIBLE_PRIZES = 12;
export const ECO_PRIZE_TTL_MS = 10 * 60 * 1000;
export const ECO_THEFT_CHECK_INTERVAL_MS = 20 * 60 * 1000;
export const ECO_THEFT_PROTECTION_MS = 24 * 60 * 60 * 1000;
export const ECO_THEFT_BASE_CAUGHT_RATE = 0.1;
export const ECO_THEFT_HOURLY_CAUGHT_RATE = 0.02;
export const ECO_THEFT_CAUGHT_RATE_DECAY_PER_RESTORE = 0.05;

// ───────────────────────── 升级配置 ─────────────────────────

interface UpgradeDef {
  name: string;
  emoji: string;
  desc: string;
  /** 第 n 项代表 n 级升 n+1 级的花费 */
  costs: number[];
  /** 给定等级的效果数值 */
  effect: (level: number) => number;
  /** 效果文案 */
  effectLabel: (level: number) => string;
}

export const ECO_UPGRADES: Record<EcoUpgradeKey, UpgradeDef> = {
  spawn: {
    name: '刷新速度',
    emoji: '♻️',
    desc: '街区垃圾刷新更快，单位时间能回收的更多',
    costs: [50, 90, 160, 280, 480, 820, 1400, 2400],
    effect: (level) => BASE_SPAWN_PER_MIN + level * 3,
    effectLabel: (level) => `${BASE_SPAWN_PER_MIN + level * 3} 个/分钟`,
  },
  storage: {
    name: '回收袋容量',
    emoji: '🛍️',
    desc: '挂机时能囤积更多垃圾，离开越久收获越多',
    costs: [40, 70, 120, 200, 340, 580, 980, 1600],
    effect: (level) => BASE_STORAGE_CAP + level * 40,
    effectLabel: (level) => `${BASE_STORAGE_CAP + level * 40} 容量`,
  },
  value: {
    name: '积分价格',
    emoji: '💰',
    desc: `每 ${POINT_DIVISOR} 个垃圾兑换的积分更多`,
    costs: [180, 360, 720, 1400, 2600],
    effect: (level) => BASE_POINT_MULTIPLIER + level,
    effectLabel: (level) => `每 ${POINT_DIVISOR} 个 = ${BASE_POINT_MULTIPLIER + level} 积分`,
  },
  auto: {
    name: '自动回收机器人',
    emoji: '🤖',
    desc: '在线/离线自动回收普通垃圾，不会拾取奖品',
    costs: [250, 450, 850, 1600, 3000, 5600],
    effect: (level) => AUTO_RATE_BY_LEVEL[level] ?? AUTO_RATE_BY_LEVEL[AUTO_RATE_BY_LEVEL.length - 1],
    effectLabel: (level) =>
      level <= 0 ? '未启用' : `${AUTO_RATE_BY_LEVEL[level] ?? AUTO_RATE_BY_LEVEL[AUTO_RATE_BY_LEVEL.length - 1]} 个/分钟`,
  },
};

export const ECO_UPGRADE_KEYS = Object.keys(ECO_UPGRADES) as EcoUpgradeKey[];

// ───────────────────────── 道具配置 ─────────────────────────

interface ItemDef {
  name: string;
  emoji: string;
  desc: string;
  cost: number;
  dailyLimit: number;
}

export const ECO_ITEMS: Record<EcoItemKey, ItemDef> = {
  clear_truck: {
    name: '清运车',
    emoji: '🚛',
    desc: `立即补充 ${CLEAR_TRUCK_TRASH} 个普通垃圾，不生成奖品`,
    cost: 35,
    dailyLimit: 3,
  },
  lucky_flashlight: {
    name: '幸运手电',
    emoji: '🔦',
    desc: `接下来 ${LUCKY_FLASHLIGHT_GENERATIONS} 个在线生成物，上述奖品出现概率变为 5 倍`,
    cost: 20,
    dailyLimit: 1,
  },
  recycle_glove: {
    name: '回收手套',
    emoji: '🧤',
    desc: `接下来 ${RECYCLE_GLOVE_USES} 次拖拽，每次额外回收 1 个垃圾`,
    cost: 25,
    dailyLimit: 2,
  },
};

export const ECO_ITEM_KEYS = Object.keys(ECO_ITEMS) as EcoItemKey[];

// ───────────────────────── 升级 / 道具读取 ─────────────────────────

function clampLevel(level: number | undefined, maxLevel: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(level as number)));
}

export function getUpgradeMaxLevel(key: EcoUpgradeKey): number {
  return ECO_UPGRADES[key].costs.length;
}

export function getUpgradeLevel(state: EcoState, key: EcoUpgradeKey): number {
  return clampLevel(state.upgrades?.[key], getUpgradeMaxLevel(key));
}

/** 升到下一级花费；已满级返回 null */
export function getUpgradeCost(key: EcoUpgradeKey, currentLevel: number): number | null {
  const def = ECO_UPGRADES[key];
  if (currentLevel >= def.costs.length) return null;
  return def.costs[currentLevel] ?? null;
}

export function getEffectiveSpawnPerMin(state: EcoState, now: number): number {
  void now;
  return ECO_UPGRADES.spawn.effect(getUpgradeLevel(state, 'spawn'));
}

export function getStorageCap(state: EcoState): number {
  return ECO_UPGRADES.storage.effect(getUpgradeLevel(state, 'storage'));
}

export function getPointMultiplier(state: EcoState): number {
  return ECO_UPGRADES.value.effect(getUpgradeLevel(state, 'value'));
}

export function getEffectiveAutoPerMin(state: EcoState, now: number): number {
  void now;
  const base = ECO_UPGRADES.auto.effect(getUpgradeLevel(state, 'auto'));
  return base <= 0 ? 0 : base;
}

export function getGrabSize(state: EcoState): number {
  return BASE_GRAB_SIZE + (state.gloveUsesRemaining > 0 ? 1 : 0);
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createEmptyPrizeInventory(): EcoPrizeInventory {
  return ECO_PRIZE_KEYS.reduce((inventory, key) => {
    inventory[key] = 0;
    return inventory;
  }, {} as EcoPrizeInventory);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function calculateEcoTheftCaughtProbability(
  stolenAt: number,
  checkedAt: number,
  previousCaughtCount = 0,
): number {
  const elapsedMs = Math.max(0, checkedAt - stolenAt);
  const fullHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const decay = Math.max(0, Math.floor(previousCaughtCount)) * ECO_THEFT_CAUGHT_RATE_DECAY_PER_RESTORE;
  return clamp01(ECO_THEFT_BASE_CAUGHT_RATE + fullHours * ECO_THEFT_HOURLY_CAUGHT_RATE - decay);
}

function resolvePrizeSpawnRate(key: EcoPrizeKey, overrides?: EcoPrizeSpawnRates): number {
  const raw = overrides?.[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, raw);
  }
  return ECO_PRIZES[key].spawnRate;
}

function getClaimCount(stats: EcoPrizeClaimStats | undefined, key: EcoPrizeKey): number {
  const value = stats?.[key];
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

export function getEcoPrizePrice(
  key: EcoPrizeKey,
  dateKey: string,
  previousDayClaims: EcoPrizeClaimStats = {},
): number {
  const def = ECO_PRIZES[key];
  const range = def.maxPrice - def.minPrice;
  const hash = hashString(`${dateKey}:${key}:eco-prize-price`);
  const randomRatio = (hash % 10000) / 9999;
  const claimTotal = Number.isFinite(previousDayClaims.total)
    ? Math.max(0, Math.floor(previousDayClaims.total as number))
    : ECO_PRIZE_KEYS.reduce((sum, prizeKey) => sum + getClaimCount(previousDayClaims, prizeKey), 0);
  const expectedRate = ECO_BASE_PRIZE_RATE > 0 ? def.spawnRate / ECO_BASE_PRIZE_RATE : 0;
  const actualRate = claimTotal > 0 ? getClaimCount(previousDayClaims, key) / claimTotal : 0;
  const pressure = expectedRate > 0 ? clamp01(actualRate / expectedRate) : 1;
  const scarcityShift = 0.35 * (1 - pressure);
  const abundantShift = 0.35 * Math.max(0, pressure - 1);
  const adjustedRatio = clamp01(randomRatio + scarcityShift - abundantShift);
  return def.minPrice + Math.round(range * adjustedRatio);
}

export function rollEcoPrize(
  rng: () => number = Math.random,
  totalRateMultiplier = 1,
  prizeRates?: EcoPrizeSpawnRates,
): EcoPrizeKey | null {
  return rollEcoPrizes(rng, totalRateMultiplier, prizeRates)[0] ?? null;
}

export function rollEcoPrizes(
  rng: () => number = Math.random,
  totalRateMultiplier = 1,
  prizeRates?: EcoPrizeSpawnRates,
): EcoPrizeKey[] {
  const multiplier = Math.max(0, Number.isFinite(totalRateMultiplier) ? totalRateMultiplier : 1);
  const prizes: EcoPrizeKey[] = [];
  for (const key of ECO_PRIZE_KEYS) {
    const rate = Math.min(1, resolvePrizeSpawnRate(key, prizeRates) * multiplier);
    if (rng() < rate) {
      prizes.push(key);
    }
  }
  return prizes;
}

/** 单个生成槽位的结果：命中奖品则返回奖品，否则返回 null（普通垃圾）。 */
export function rollEcoGeneratedPrize(
  rng: () => number = Math.random,
  totalRateMultiplier = 1,
  prizeRates?: EcoPrizeSpawnRates,
): EcoPrizeKey | null {
  const multiplier = Math.max(0, Number.isFinite(totalRateMultiplier) ? totalRateMultiplier : 1);
  const roll = rng();
  let cursor = 0;
  for (const key of ECO_PRIZE_KEYS) {
    cursor += Math.min(1, resolvePrizeSpawnRate(key, prizeRates) * multiplier);
    if (roll < cursor) return key;
  }
  return null;
}

export function pruneExpiredVisiblePrizes(state: EcoState, now: number): number {
  return pruneExpiredVisiblePrizesDetailed(state, now).length;
}

export function pruneExpiredVisiblePrizesDetailed(state: EcoState, now: number): EcoState['visiblePrizes'] {
  const expired: EcoState['visiblePrizes'] = [];
  const active: EcoState['visiblePrizes'] = [];
  for (const prize of state.visiblePrizes) {
    const alive = Number.isFinite(prize.createdAt)
      && prize.createdAt <= now
      && now - prize.createdAt <= ECO_PRIZE_TTL_MS;
    if (alive) {
      active.push(prize);
    } else {
      expired.push(prize);
    }
  }
  state.visiblePrizes = active;
  return expired;
}

// ───────────────────────── 核心结算 ─────────────────────────

export interface EcoTickResult {
  /** 本次区间内理论生成槽位数 */
  spawned: number;
  /** 实际进入场景或被机器人即时处理的生成槽位数 */
  acceptedSpawned: number;
  /** 本次区间内新留下来的普通垃圾 */
  trashSpawned: number;
  /** 本次区间内新刷出的奖品 */
  prizeKeys: EcoPrizeKey[];
  /** 本次区间内自动回收机器人清理的垃圾（待服务端转积分） */
  autoCollected: number;
  /** 本次区间时长 */
  elapsedMs: number;
}

export interface EcoTickOptions {
  rollPrize?: () => EcoPrizeKey | null;
}

/**
 * 时间推进结算（纯函数，按引用修改 state 的产出相关字段）：
 * 1. 按刷新速度产出垃圾（带毫秒进位）；
 * 2. 自动回收机器人按其速度回收（带毫秒进位）；
 * 3. 剩余待回收垃圾封顶到容量（多余溢出丢弃）。
 *
 * 返回 autoCollected 交由服务层做积分兑换。
 */
export function tickEco(state: EcoState, now: number, options: EcoTickOptions = {}): EcoTickResult {
  const last = Number.isFinite(state.lastTickAt) ? state.lastTickAt : now;
  const elapsedMs = Math.max(0, now - last);

  if (elapsedMs <= 0) {
    state.lastTickAt = now;
    return { spawned: 0, acceptedSpawned: 0, trashSpawned: 0, prizeKeys: [], autoCollected: 0, elapsedMs: 0 };
  }

  const spawnPerMin = getEffectiveSpawnPerMin(state, now);
  const autoPerMin = getEffectiveAutoPerMin(state, now);
  const cap = getStorageCap(state);

  // 产出（毫秒进位，避免高频轮询丢精度）
  let spawned = 0;
  if (spawnPerMin > 0) {
    const msPer = 60000 / spawnPerMin;
    const total = (state.spawnLeftoverMs ?? 0) + elapsedMs;
    spawned = Math.floor(total / msPer);
    state.spawnLeftoverMs = total - spawned * msPer;
  } else {
    state.spawnLeftoverMs = 0;
  }

  // 自动回收容量（毫秒进位）
  let autoCapacity = 0;
  if (autoPerMin > 0) {
    const msPer = 60000 / autoPerMin;
    const total = (state.autoLeftoverMs ?? 0) + elapsedMs;
    autoCapacity = Math.floor(total / msPer);
    state.autoLeftoverMs = total - autoCapacity * msPer;
    // 被动克制：单次结算（尤其离线归来）自动回收最多累计 OFFLINE_AUTO_CAP_MINUTES 分钟产能
    const offlineCap = Math.floor(autoPerMin * OFFLINE_AUTO_CAP_MINUTES);
    if (autoCapacity > offlineCap) {
      autoCapacity = offlineCap;
      state.autoLeftoverMs = 0;
    }
  } else {
    state.autoLeftoverMs = 0;
  }

  const existingPrizes = Array.isArray(state.visiblePrizes) ? state.visiblePrizes.length : 0;
  let pending = Math.min(Math.max(0, Math.floor(state.pending)), Math.max(0, cap - existingPrizes));
  let visibleCount = existingPrizes;
  let freeSlots = Math.max(0, cap - pending - visibleCount);

  // 机器人先处理已存在的普通垃圾，随后仍可即时处理本轮刷出的普通垃圾。
  let autoCollected = Math.min(autoCapacity, pending);
  pending -= autoCollected;
  let remainingAuto = autoCapacity - autoCollected;
  freeSlots = Math.max(0, cap - pending - visibleCount);

  let acceptedSpawned = 0;
  let trashSpawned = 0;
  const prizeKeys: EcoPrizeKey[] = [];
  for (let index = 0; index < spawned; index += 1) {
    if (freeSlots <= 0 && remainingAuto <= 0) break;

    const prizeKey = freeSlots > 0 ? options.rollPrize?.() ?? null : null;
    if (prizeKey) {
      if (freeSlots <= 0) break;
      visibleCount += 1;
      freeSlots -= 1;
      prizeKeys.push(prizeKey);
      acceptedSpawned += 1;
      continue;
    }

    acceptedSpawned += 1;
    if (remainingAuto > 0) {
      remainingAuto -= 1;
      autoCollected += 1;
      continue;
    }

    pending += 1;
    trashSpawned += 1;
    freeSlots = Math.max(0, cap - pending - visibleCount);
  }

  state.pending = pending;
  state.lastTickAt = now;

  return { spawned, acceptedSpawned, trashSpawned, prizeKeys, autoCollected, elapsedMs };
}

export interface ConvertResult {
  /** 应发放积分 */
  pointsToAward: number;
  /** 兑换掉的袋数 */
  batches: number;
  /** 兑换后剩余的零头缓冲 */
  newBuffer: number;
}

/**
 * 把垃圾缓冲转换为积分（纯函数）。
 * maxPoints 仅保留给兼容调用方；默认不设上限。
 */
export function convertBuffer(
  rawBuffer: number,
  multiplier: number,
  maxPoints = Number.POSITIVE_INFINITY,
): ConvertResult {
  const buffer = Math.max(0, Math.floor(rawBuffer));
  const mult = Math.max(1, Math.floor(multiplier));
  const availableBatches = Math.floor(buffer / POINT_DIVISOR);
  const maxBatchesByCap = Number.isFinite(maxPoints)
    ? Math.max(0, Math.floor(Math.max(0, maxPoints) / mult))
    : availableBatches;
  const batches = Math.max(0, Math.min(availableBatches, maxBatchesByCap));
  return {
    pointsToAward: batches * mult,
    batches,
    newBuffer: buffer - batches * POINT_DIVISOR,
  };
}

// ───────────────────────── 初始化 / 归一化 ─────────────────────────

export function createInitialEcoState(userId: number, now: number): EcoState {
  return {
    userId,
    pending: 0,
    spawnLeftoverMs: 0,
    autoLeftoverMs: 0,
    pointBuffer: 0,
    upgrades: { spawn: 0, storage: 0, value: 0, auto: 0 },
    inventory: createEmptyPrizeInventory(),
    prizeLots: [],
    limitedPrizeInventory: createEmptyPrizeInventory(),
    lifetimePrizeClaims: 0,
    lifetimePrizeClaimCounts: createEmptyPrizeInventory(),
    visiblePrizes: [],
    luckyGenerationsRemaining: 0,
    gloveUsesRemaining: 0,
    itemPurchases: {},
    dailyTrashPoints: { date: '', points: 0 },
    exp: 0,
    lifetimeCleared: 0,
    lifetimePoints: 0,
    points: 0,
    lastTickAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

/** 防御性归一化旧/脏存档 */
export function normalizeEcoState(raw: EcoState, now: number): EcoState {
  const base = createInitialEcoState(raw.userId, now);
  const upgrades = { ...base.upgrades };
  for (const key of ECO_UPGRADE_KEYS) {
    upgrades[key] = clampLevel(raw.upgrades?.[key], getUpgradeMaxLevel(key));
  }
  const inventory = createEmptyPrizeInventory();
  for (const key of ECO_PRIZE_KEYS) {
    const value = raw.inventory?.[key];
    inventory[key] = Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
  }
  const limitedPrizeInventory = createEmptyPrizeInventory();
  for (const key of ECO_PRIZE_KEYS) {
    const value = raw.limitedPrizeInventory?.[key];
    const normalizedValue = Number.isFinite(value)
      ? Math.max(0, Math.floor(value as number))
      : 0;
    limitedPrizeInventory[key] = Math.min(normalizedValue, inventory[key]);
  }
  const prizeLots = Array.isArray(raw.prizeLots)
    ? raw.prizeLots.filter((lot) => (
        lot
        && typeof lot.id === 'string'
        && typeof lot.key === 'string'
        && (ECO_PRIZE_KEYS as string[]).includes(lot.key)
        && Number.isFinite(lot.acquiredAt)
      )).map((lot) => ({
        id: lot.id,
        key: lot.key,
        acquiredAt: Math.max(0, Math.floor(lot.acquiredAt)),
        availableAt: Number.isFinite(lot.availableAt)
          ? Math.max(0, Math.floor(lot.availableAt))
          : Math.max(0, Math.floor(lot.acquiredAt)),
        limited: lot.limited === true,
        source: (lot.source === 'stolen' || lot.source === 'restored' ? lot.source : 'claim') as EcoPrizeLot['source'],
        publicEntryId: typeof lot.publicEntryId === 'string' ? lot.publicEntryId : null,
        publiclyListedAt: Number.isFinite(lot.publiclyListedAt) ? Math.max(0, Math.floor(lot.publiclyListedAt as number)) : null,
        merchantAvailableAt: Number.isFinite(lot.merchantAvailableAt) ? Math.max(0, Math.floor(lot.merchantAvailableAt as number)) : null,
        stolenFromUserId: Number.isSafeInteger(lot.stolenFromUserId) ? lot.stolenFromUserId : null,
        stolenAt: Number.isFinite(lot.stolenAt) ? Math.max(0, Math.floor(lot.stolenAt as number)) : null,
        theftId: typeof lot.theftId === 'string' ? lot.theftId : null,
        blackMarketAvailableAt: Number.isFinite(lot.blackMarketAvailableAt) ? Math.max(0, Math.floor(lot.blackMarketAvailableAt as number)) : null,
      })).slice(0, ECO_PRIZE_KEYS.reduce((sum, key) => sum + inventory[key], 0))
    : [];
  const legacyPrizeTotal = ECO_PRIZE_KEYS.reduce((sum, key) => sum + inventory[key], 0);
  const lifetimePrizeClaimCounts = createEmptyPrizeInventory();
  for (const key of ECO_PRIZE_KEYS) {
    const value = raw.lifetimePrizeClaimCounts?.[key];
    const normalizedValue = Number.isFinite(value)
      ? Math.max(0, Math.floor(value as number))
      : 0;
    lifetimePrizeClaimCounts[key] = Math.max(normalizedValue, inventory[key]);
  }
  const normalizedPrizeTotal = ECO_PRIZE_KEYS.reduce((sum, key) => sum + lifetimePrizeClaimCounts[key], 0);
  const safeNumber = (value: unknown, fallback: number): number =>
    Number.isFinite(value as number) ? Math.max(0, value as number) : fallback;
  const itemPurchases = Object.fromEntries(
    Object.entries(raw.itemPurchases ?? {}).filter(([key, value]) => (
      (ECO_ITEM_KEYS as string[]).includes(key)
      && value
      && typeof value === 'object'
      && typeof value.date === 'string'
      && Number.isFinite(value.count)
    )).map(([key, value]) => [
      key,
      { date: value.date, count: Math.max(0, Math.floor(value.count)) },
    ]),
  );
  const rawDailyTrashPoints = raw.dailyTrashPoints;
  const dailyTrashPoints = {
    date: typeof rawDailyTrashPoints?.date === 'string' ? rawDailyTrashPoints.date : '',
    points: Math.floor(safeNumber(rawDailyTrashPoints?.points, 0)),
  };
  const normalizedVisiblePrizes = Array.isArray(raw.visiblePrizes)
    ? raw.visiblePrizes.filter(
        (prize) =>
          prize
          && typeof prize.id === 'string'
          && typeof prize.key === 'string'
          && (ECO_PRIZE_KEYS as string[]).includes(prize.key)
          && Number.isFinite(prize.createdAt)
          && prize.createdAt <= now,
      ).map((prize) => ({
        id: prize.id,
        key: prize.key,
        createdAt: prize.createdAt,
        limited: prize.limited === true,
      }))
    : [];
  const activeVisiblePrizes = normalizedVisiblePrizes.filter(
    (prize) => now - prize.createdAt <= ECO_PRIZE_TTL_MS,
  );
  const expiredLimitedVisiblePrizes = normalizedVisiblePrizes.filter(
    (prize) => prize.limited === true && now - prize.createdAt > ECO_PRIZE_TTL_MS,
  );

  return {
    userId: raw.userId,
    pending: Math.floor(safeNumber(raw.pending, 0)),
    spawnLeftoverMs: safeNumber(raw.spawnLeftoverMs, 0),
    autoLeftoverMs: safeNumber(raw.autoLeftoverMs, 0),
    pointBuffer: Math.floor(safeNumber(raw.pointBuffer, 0)),
    upgrades,
    inventory,
    prizeLots,
    limitedPrizeInventory,
    lifetimePrizeClaims: Math.max(
      Math.floor(safeNumber(raw.lifetimePrizeClaims, legacyPrizeTotal)),
      normalizedPrizeTotal,
    ),
    lifetimePrizeClaimCounts,
    visiblePrizes: [
      ...expiredLimitedVisiblePrizes,
      ...activeVisiblePrizes.slice(0, MAX_VISIBLE_PRIZES),
    ],
    luckyGenerationsRemaining: Math.floor(safeNumber(raw.luckyGenerationsRemaining, 0)),
    gloveUsesRemaining: Math.floor(safeNumber(raw.gloveUsesRemaining, 0)),
    itemPurchases,
    dailyTrashPoints,
    exp: Math.floor(safeNumber(raw.exp, 0)),
    lifetimeCleared: Math.floor(safeNumber(raw.lifetimeCleared, 0)),
    lifetimePoints: Math.floor(safeNumber(raw.lifetimePoints, 0)),
    points: Math.floor(safeNumber(raw.points, 0)),
    lastTickAt: Number.isFinite(raw.lastTickAt) ? raw.lastTickAt : now,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    updatedAt: now,
  };
}
