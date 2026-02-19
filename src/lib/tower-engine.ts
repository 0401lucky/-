// src/lib/tower-engine.ts - 爬塔游戏纯函数引擎（前后端共用）

import seedrandom from 'seedrandom';

// ---- Buff 类型 ----

export type BuffType = 'lifesteal' | 'eagle_eye' | 'combo_master' | 'lucky' | 'fortify';

export const BUFF_LABELS: Record<BuffType, string> = {
  lifesteal: '吸血',
  eagle_eye: '鹰眼',
  combo_master: '连击大师',
  lucky: '幸运',
  fortify: '坚壁',
};

export const BUFF_ICONS: Record<BuffType, string> = {
  lifesteal: '🩸',
  eagle_eye: '🦅',
  combo_master: '🔥',
  lucky: '🍀',
  fortify: '🏰',
};

export const BUFF_DESCRIPTIONS: Record<BuffType, string> = {
  lifesteal: '击败怪物额外获得 20% 力量',
  eagle_eye: '所有迷雾通道变透明',
  combo_master: '连击加成从 10% 提升到 20%',
  lucky: '增益数值 +30%',
  fortify: '护盾可叠加到 2 层',
};

const ALL_BUFFS: BuffType[] = ['lifesteal', 'eagle_eye', 'combo_master', 'lucky', 'fortify'];

// ---- 难度模式类型 ----

export type TowerDifficulty = 'normal' | 'hard' | 'hell';

export const DIFFICULTY_LABELS: Record<TowerDifficulty, string> = {
  normal: '普通',
  hard: '困难',
  hell: '地狱',
};

export const DIFFICULTY_COLORS: Record<TowerDifficulty, string> = {
  normal: 'green',
  hard: 'orange',
  hell: 'red',
};

export interface DifficultyModifier {
  monsterMult: number;
  mysteryBonus: number;
  safeMult: number;
  scoreMult: number;
  trapBonus: number;
}

export const DIFFICULTY_MODIFIERS: Record<TowerDifficulty, DifficultyModifier> = {
  normal: { monsterMult: 1.0, mysteryBonus: 0, safeMult: 1.0, scoreMult: 1.0, trapBonus: 0 },
  hard:   { monsterMult: 1.3, mysteryBonus: 0.15, safeMult: 0.7, scoreMult: 1.5, trapBonus: 0.05 },
  hell:   { monsterMult: 1.6, mysteryBonus: 0.25, safeMult: 0, scoreMult: 2.5, trapBonus: 0.10 },
};

// ---- 主题楼层类型 ----

export type ThemeFloorType = 'gambling' | 'treasure' | 'hell_theme' | 'chaos';

export const THEME_LABELS: Record<ThemeFloorType, string> = {
  gambling: '赌博层',
  treasure: '宝藏层',
  hell_theme: '地狱层',
  chaos: '混沌层',
};

export const THEME_ICONS: Record<ThemeFloorType, string> = {
  gambling: '🎰',
  treasure: '💎',
  hell_theme: '🔥',
  chaos: '🌀',
};

// ---- 祝福/诅咒类型 ----

export type BlessingType = 'flame_power' | 'golden_touch' | 'insight_eye';
export type CurseType = 'weakness' | 'confusion';

export interface ActiveBlessing {
  type: BlessingType;
  remainingFloors: number;
}

export interface ActiveCurse {
  type: CurseType;
  remainingFloors: number;
}

export const BLESSING_LABELS: Record<BlessingType, string> = {
  flame_power: '烈焰之力',
  golden_touch: '黄金之触',
  insight_eye: '洞察之眼',
};

export const BLESSING_ICONS: Record<BlessingType, string> = {
  flame_power: '🔥',
  golden_touch: '✨',
  insight_eye: '👁️',
};

export const BLESSING_DESCRIPTIONS: Record<BlessingType, string> = {
  flame_power: '战斗时有效攻击力 ×1.5',
  golden_touch: '所有增益数值翻倍',
  insight_eye: '揭示所有迷雾通道',
};

export const CURSE_LABELS: Record<CurseType, string> = {
  weakness: '虚弱',
  confusion: '迷惑',
};

export const CURSE_ICONS: Record<CurseType, string> = {
  weakness: '💔',
  confusion: '🌀',
};

export const CURSE_DESCRIPTIONS: Record<CurseType, string> = {
  weakness: '有效攻击力 ×0.75',
  confusion: '通道位置随机交换',
};

const ALL_BLESSINGS: BlessingType[] = ['flame_power', 'golden_touch', 'insight_eye'];
const ALL_CURSES: CurseType[] = ['weakness', 'confusion'];

// ---- 类型定义 ----

export type ResolvedLaneContent =
  | { type: 'monster'; value: number }
  | { type: 'add'; value: number }
  | { type: 'multiply'; value: number }
  | { type: 'boss'; value: number }
  | { type: 'shield'; value: number }
  | { type: 'shop'; buff: BuffType }
  | { type: 'trap'; subtype: 'sub' | 'div'; value: number };

export type TowerLaneContent =
  | ResolvedLaneContent
  | { type: 'mystery'; hidden: ResolvedLaneContent };

export interface TowerFloor {
  floor: number;
  lanes: TowerLaneContent[];
  isBoss?: boolean;
  isShop?: boolean;
  theme?: ThemeFloorType;
}

export interface TowerSimulateResult {
  ok: true;
  floorsClimbed: number;
  finalPower: number;
  gameOver: boolean;
  deathFloor?: number;
  deathLane?: number;
  finalShield: number;
  bossesDefeated: number;
  maxCombo: number;
  finalCombo: number;
  finalBuffs: BuffType[];
  usedShield: boolean;
  // 难度模式扩展字段
  difficulty?: TowerDifficulty;
  blessings?: ActiveBlessing[];
  curses?: ActiveCurse[];
  themeFloorsVisited?: ThemeFloorType[];
}

export interface TowerSimulateError {
  ok: false;
  message: string;
}

export type TowerSimulateOutput = TowerSimulateResult | TowerSimulateError;

// ---- 力量值上限 ----

export const MAX_POWER = 999_999_999;

export function formatPower(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---- 基础难度配置 ----

interface DifficultyRange {
  monsterMin: number;
  monsterMax: number;
  addMin: number;
  addMax: number;
  hasMultiply: boolean;
  multiplyMin: number;
  multiplyMax: number;
  laneCount: [number, number];
  safeChance: number;
  mysteryChance: number;
  shieldChance: number;
  shieldConvertMin: number;
  shieldConvertMax: number;
  bossMinRatio: number;
  bossMaxRatio: number;
  bossEscapeMin: number;
  bossEscapeMax: number;
  trapChance: number;
  trapSubMin: number;
  trapSubMax: number;
  trapDivMin: number;
  trapDivMax: number;
}

function getBaseDifficulty(floor: number): DifficultyRange {
  if (floor <= 5) {
    return {
      monsterMin: 1, monsterMax: 3,
      addMin: 1, addMax: 3,
      hasMultiply: false, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 2],
      safeChance: 1.0,
      mysteryChance: 0,
      shieldChance: 0,
      shieldConvertMin: 1, shieldConvertMax: 2,
      bossMinRatio: 0.5, bossMaxRatio: 0.8,
      bossEscapeMin: 1, bossEscapeMax: 3,
      trapChance: 0,
      trapSubMin: 1, trapSubMax: 3,
      trapDivMin: 2, trapDivMax: 2,
    };
  }
  if (floor <= 15) {
    return {
      monsterMin: 2, monsterMax: 8,
      addMin: 2, addMax: 5,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 3],
      safeChance: 0.85,
      mysteryChance: 0.15,
      shieldChance: 0.05,
      shieldConvertMin: 1, shieldConvertMax: 3,
      bossMinRatio: 0.5, bossMaxRatio: 0.8,
      bossEscapeMin: 1, bossEscapeMax: 3,
      trapChance: 0,
      trapSubMin: 1, trapSubMax: 5,
      trapDivMin: 2, trapDivMax: 2,
    };
  }
  if (floor <= 30) {
    return {
      monsterMin: 5, monsterMax: 20,
      addMin: 3, addMax: 8,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 3],
      safeChance: 0.55,
      mysteryChance: 0.25,
      shieldChance: 0.08,
      shieldConvertMin: 2, shieldConvertMax: 5,
      bossMinRatio: 0.6, bossMaxRatio: 0.9,
      bossEscapeMin: 2, bossEscapeMax: 5,
      trapChance: 0.08,
      trapSubMin: 3, trapSubMax: 10,
      trapDivMin: 2, trapDivMax: 3,
    };
  }
  if (floor <= 50) {
    return {
      monsterMin: 10, monsterMax: 50,
      addMin: 5, addMax: 15,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 3,
      laneCount: [2, 3],
      safeChance: 0.3,
      mysteryChance: 0.35,
      shieldChance: 0.10,
      shieldConvertMin: 3, shieldConvertMax: 8,
      bossMinRatio: 0.7, bossMaxRatio: 1.1,
      bossEscapeMin: 3, bossEscapeMax: 8,
      trapChance: 0.12,
      trapSubMin: 5, trapSubMax: 20,
      trapDivMin: 2, trapDivMax: 3,
    };
  }
  // 51+
  return {
    monsterMin: 20, monsterMax: 100 + Math.floor((floor - 50) * 2),
    addMin: 10, addMax: 30,
    hasMultiply: true, multiplyMin: 2, multiplyMax: 3,
    laneCount: [2, 3],
    safeChance: 0.15,
    mysteryChance: 0.35,
    shieldChance: 0.10,
    shieldConvertMin: 5, shieldConvertMax: 15,
    bossMinRatio: 0.8, bossMaxRatio: 1.3,
    bossEscapeMin: 5, bossEscapeMax: 15,
    trapChance: 0.15,
    trapSubMin: 10, trapSubMax: 40,
    trapDivMin: 2, trapDivMax: 4,
  };
}


/** 应用难度修正到基础配置 */
function applyDifficultyMod(base: DifficultyRange, mod: DifficultyModifier): DifficultyRange {
  return {
    ...base,
    monsterMin: Math.round(base.monsterMin * mod.monsterMult),
    monsterMax: Math.round(base.monsterMax * mod.monsterMult),
    safeChance: base.safeChance * mod.safeMult,
    mysteryChance: Math.min(1, base.mysteryChance + mod.mysteryBonus),
    trapChance: Math.min(1, base.trapChance + mod.trapBonus),
    bossMinRatio: base.bossMinRatio * mod.monsterMult,
    bossMaxRatio: base.bossMaxRatio * mod.monsterMult,
  };
}

// ---- 工具函数 ----

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function resolveLane(lane: TowerLaneContent): ResolvedLaneContent {
  return lane.type === 'mystery' ? lane.hidden : lane;
}

// ---- 楼层生成选项（难度模式传入） ----

export interface GenerateFloorOptions {
  difficulty: TowerDifficulty;
  blessings: ActiveBlessing[];
  curses: ActiveCurse[];
  bossesDefeated: number;
}

// ---- 商店层判定 ----

function isShopFloor(floor: number): boolean {
  if (floor <= 0) return false;
  if (floor % 10 === 0) return false;
  return floor % 10 === 5 && floor >= 5;
}

// ---- 商店层生成 ----

function generateShopFloor(rng: Rng, floor: number, ownedBuffs: BuffType[]): TowerFloor {
  const available = ALL_BUFFS.filter(b => !ownedBuffs.includes(b));

  if (available.length === 0) {
    const lanes: TowerLaneContent[] = [];
    for (let i = 0; i < 3; i++) {
      const v = 3 + Math.floor(rng() * 10);
      lanes.push({ type: 'add', value: v });
    }
    return { floor, lanes, isShop: true };
  }

  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const pick = shuffled.slice(0, Math.min(3, shuffled.length));
  const lanes: TowerLaneContent[] = pick.map(buff => ({ type: 'shop' as const, buff }));

  const remaining = 3 - pick.length;
  for (let i = 0; i < remaining; i++) rng();

  return { floor, lanes, isShop: true };
}

// ---- Boss 层生成 ----

function generateBossFloor(rng: Rng, floor: number, currentPower: number, diff: DifficultyRange): TowerFloor {
  const ratioRoll = rng();
  const ratio = diff.bossMinRatio + ratioRoll * (diff.bossMaxRatio - diff.bossMinRatio);
  const bossValue = Math.max(1, Math.round(currentPower * ratio));

  const escapeRoll = rng();
  const escapeValue = diff.bossEscapeMin + Math.floor(escapeRoll * (diff.bossEscapeMax - diff.bossEscapeMin + 1));

  const orderRoll = rng();
  const bossLane: TowerLaneContent = { type: 'boss', value: bossValue };
  const escapeLane: TowerLaneContent = { type: 'add', value: escapeValue };

  const lanes = orderRoll < 0.5 ? [bossLane, escapeLane] : [escapeLane, bossLane];

  return { floor, lanes, isBoss: true };
}

// ---- 主题楼层判定 ----

function determineThemeFloor(
  floor: number,
  themeRoll: number,
  options: GenerateFloorOptions,
): ThemeFloorType | null {
  // 宝藏层：Boss 后下一层（floor 11, 21, 31...），40% 概率
  if (floor > 10 && floor % 10 === 1 && options.bossesDefeated > 0) {
    if (themeRoll < 0.4) return 'treasure';
    return null;
  }

  // 赌博/地狱/混沌：floor >= 16
  if (floor < 16) return null;

  const diffBonus = options.difficulty === 'hell' ? 0.15
    : options.difficulty === 'hard' ? 0.10
    : 0.05;
  const baseChance = 0.12 + diffBonus + (floor - 16) * 0.003;
  const chance = Math.min(baseChance, 0.4);

  if (themeRoll >= chance) return null;

  // 按比例分配主题类型
  const typeNorm = themeRoll / chance;
  if (typeNorm < 0.35) return 'gambling';
  if (typeNorm < 0.65) return 'hell_theme';
  return 'chaos';
}

// ---- 主题楼层生成 ----

function generateGamblingFloor(rng: Rng, floor: number, power: number, diff: DifficultyRange): TowerFloor {
  const lanes: TowerLaneContent[] = [];

  for (let i = 0; i < 3; i++) {
    const r1 = rng();
    const r2 = rng();
    rng(); // r3 对齐
    const r4 = rng();

    let hidden: ResolvedLaneContent;
    if (r1 < 0.25) {
      // 高倍乘法
      const v = 2 + Math.floor(r4 * 3);
      hidden = { type: 'multiply', value: v };
    } else if (r1 < 0.45) {
      // 强怪（接近力量值）
      const ratio = 0.6 + r4 * 0.35;
      const v = Math.max(1, Math.round(power * ratio));
      hidden = { type: 'monster', value: v };
    } else if (r1 < 0.65) {
      // 陷阱
      if (r2 < 0.5) {
        const v = Math.max(1, diff.trapSubMin + Math.floor(r4 * (diff.trapSubMax - diff.trapSubMin + 1)));
        hidden = { type: 'trap', subtype: 'sub', value: v };
      } else {
        const v = Math.max(2, diff.trapDivMin + Math.floor(r4 * (diff.trapDivMax - diff.trapDivMin + 1)));
        hidden = { type: 'trap', subtype: 'div', value: v };
      }
    } else {
      // 大额增益
      const v = Math.max(1, diff.addMax + Math.floor(r4 * diff.addMax * 2));
      hidden = { type: 'add', value: v };
    }

    lanes.push({ type: 'mystery', hidden });
  }

  return { floor, lanes, theme: 'gambling' };
}

function generateTreasureFloor(rng: Rng, floor: number, _power: number, diff: DifficultyRange): TowerFloor {
  const lanes: TowerLaneContent[] = [];

  for (let i = 0; i < 3; i++) {
    const r1 = rng();
    rng(); // r2 对齐
    rng(); // r3 对齐
    const r4 = rng();

    if (r1 < 0.35) {
      const v = Math.max(1, diff.addMax * 2 + Math.floor(r4 * diff.addMax * 3));
      lanes.push({ type: 'add', value: v });
    } else if (r1 < 0.6) {
      const v = diff.multiplyMin + Math.floor(r4 * (diff.multiplyMax - diff.multiplyMin + 1));
      lanes.push({ type: 'multiply', value: v });
    } else {
      const v = Math.max(1, diff.shieldConvertMax + Math.floor(r4 * diff.shieldConvertMax));
      lanes.push({ type: 'shield', value: v });
    }
  }

  return { floor, lanes, theme: 'treasure' };
}

function generateHellThemeFloor(rng: Rng, floor: number, power: number): TowerFloor {
  const lanes: TowerLaneContent[] = [];

  for (let i = 0; i < 3; i++) {
    rng(); // r1 对齐
    rng(); // r2 对齐
    rng(); // r3 对齐
    const r4 = rng();

    const ratio = 0.6 + r4 * 0.35;
    const v = Math.max(1, Math.round(power * ratio));
    lanes.push({ type: 'monster', value: v });
  }

  return { floor, lanes, theme: 'hell_theme' };
}

function generateChaosFloor(rng: Rng, floor: number, power: number, diff: DifficultyRange): TowerFloor {
  const lanes: TowerLaneContent[] = [];
  const countRoll = rng();
  const laneCount = countRoll < 0.5 ? 4 : 5;

  // 始终消耗 5 组 × 4 rng = 20 rng，保持确定性
  for (let i = 0; i < 5; i++) {
    const r1 = rng();
    const r2 = rng();
    rng(); // r3 对齐
    const r4 = rng();

    if (i >= laneCount) continue;

    if (r1 < 0.6) {
      // 60% 陷阱
      if (r2 < 0.5) {
        const v = Math.max(1, diff.trapSubMin + Math.floor(r4 * (diff.trapSubMax - diff.trapSubMin + 1)));
        lanes.push({ type: 'trap', subtype: 'sub', value: v });
      } else {
        const v = Math.max(2, diff.trapDivMin + Math.floor(r4 * (diff.trapDivMax - diff.trapDivMin + 1)));
        lanes.push({ type: 'trap', subtype: 'div', value: v });
      }
    } else if (r1 < 0.8) {
      // 20% 怪物
      const ratio = 0.5 + r4 * 0.45;
      const v = Math.max(1, Math.round(power * ratio));
      lanes.push({ type: 'monster', value: v });
    } else {
      // 20% 高额奖励
      if (r2 < 0.5) {
        const v = Math.max(1, diff.addMax * 3 + Math.floor(r4 * diff.addMax * 5));
        lanes.push({ type: 'add', value: v });
      } else {
        const v = Math.max(2, diff.multiplyMax + Math.floor(r4 * 2));
        lanes.push({ type: 'multiply', value: v });
      }
    }
  }

  return { floor, lanes, theme: 'chaos' };
}

function generateThemeFloorByType(
  rng: Rng,
  floor: number,
  power: number,
  diff: DifficultyRange,
  theme: ThemeFloorType,
): TowerFloor {
  switch (theme) {
    case 'gambling': return generateGamblingFloor(rng, floor, power, diff);
    case 'treasure': return generateTreasureFloor(rng, floor, power, diff);
    case 'hell_theme': return generateHellThemeFloor(rng, floor, power);
    case 'chaos': return generateChaosFloor(rng, floor, power, diff);
  }
}

// ---- 祝福/诅咒系统 ----

export function rollBlessing(rng: Rng, activeBlessings: ActiveBlessing[]): ActiveBlessing | null {
  const roll = rng(); // 始终消耗 1 次 rng
  const available = ALL_BLESSINGS.filter(b => !activeBlessings.some(ab => ab.type === b));
  if (available.length === 0) return null;
  const idx = Math.floor(roll * available.length);
  return { type: available[idx], remainingFloors: 5 };
}

export function rollCurse(rng: Rng): ActiveCurse | null {
  const probRoll = rng(); // 始终消耗 1 次 rng
  const typeRoll = rng(); // 始终消耗 1 次 rng (共 2 次)
  if (probRoll >= 0.2) return null; // 20% 概率
  const idx = Math.floor(typeRoll * ALL_CURSES.length);
  return { type: ALL_CURSES[idx], remainingFloors: 3 };
}

// ---- 普通楼层生成（从原 generateFloor 中提取） ----

function generateNormalFloor(
  rng: Rng,
  floor: number,
  currentPower: number,
  diff: DifficultyRange,
  _ownedBuffs: BuffType[],
): TowerFloor {
  const laneCount = randInt(rng, diff.laneCount[0], diff.laneCount[1]);

  const needSafe = rng() < diff.safeChance;

  const lanes: TowerLaneContent[] = [];

  for (let i = 0; i < laneCount; i++) {
    const shieldRoll = rng();
    const trapRoll = rng();
    const typeRoll = rng();
    const valueRoll = rng();

    if (shieldRoll < diff.shieldChance) {
      const value = diff.shieldConvertMin + Math.floor(valueRoll * (diff.shieldConvertMax - diff.shieldConvertMin + 1));
      lanes.push({ type: 'shield', value });
    } else if (trapRoll < diff.trapChance && floor >= 16) {
      if (valueRoll < 0.6) {
        const value = diff.trapSubMin + Math.floor(typeRoll * (diff.trapSubMax - diff.trapSubMin + 1));
        lanes.push({ type: 'trap', subtype: 'sub', value });
      } else {
        const value = diff.trapDivMin + Math.floor(typeRoll * (diff.trapDivMax - diff.trapDivMin + 1));
        lanes.push({ type: 'trap', subtype: 'div', value });
      }
    } else if (typeRoll < 0.3) {
      const value = diff.addMin + Math.floor(valueRoll * (diff.addMax - diff.addMin + 1));
      lanes.push({ type: 'add', value });
    } else if (diff.hasMultiply && typeRoll < 0.4) {
      const value = diff.multiplyMin + Math.floor(valueRoll * (diff.multiplyMax - diff.multiplyMin + 1));
      lanes.push({ type: 'multiply', value });
    } else {
      const value = diff.monsterMin + Math.floor(valueRoll * (diff.monsterMax - diff.monsterMin + 1));
      lanes.push({ type: 'monster', value });
    }
  }

  if (needSafe) {
    const hasSafe = lanes.some((lane) => {
      if (lane.type === 'add' || lane.type === 'multiply' || lane.type === 'shield') return true;
      return lane.type === 'monster' && lane.value < currentPower;
    });

    if (!hasSafe) {
      const safeValue = Math.max(1, Math.floor(currentPower * 0.5 * rng()) + 1);
      lanes[0] = { type: 'monster', value: Math.min(safeValue, currentPower - 1) };
      if (lanes[0].value < 1) lanes[0] = { type: 'add', value: randInt(rng, diff.addMin, diff.addMax) };
    }
  }

  if (diff.mysteryChance > 0) {
    for (let i = 0; i < lanes.length; i++) {
      if (rng() < diff.mysteryChance) {
        lanes[i] = { type: 'mystery', hidden: lanes[i] as ResolvedLaneContent };
      }
    }
  }

  return { floor, lanes };
}

// ---- 楼层生成（主入口） ----

export function generateFloor(
  rng: Rng,
  floor: number,
  currentPower: number,
  ownedBuffs?: BuffType[],
  options?: GenerateFloorOptions,
): TowerFloor {
  const baseDiff = getBaseDifficulty(floor);
  const diff = options
    ? applyDifficultyMod(baseDiff, DIFFICULTY_MODIFIERS[options.difficulty])
    : baseDiff;

  let result: TowerFloor;

  // Boss 层
  if (floor > 0 && floor % 10 === 0) {
    if (options) rng(); // 主题判定位对齐
    result = generateBossFloor(rng, floor, currentPower, diff);
  }
  // 商店层
  else if (isShopFloor(floor)) {
    if (options) rng(); // 主题判定位对齐
    result = generateShopFloor(rng, floor, ownedBuffs ?? []);
  }
  // 有难度模式 → 判定主题层
  else if (options) {
    const themeRoll = rng(); // 主题判定（1 rng）
    const theme = determineThemeFloor(floor, themeRoll, options);
    if (theme) {
      result = generateThemeFloorByType(rng, floor, currentPower, diff, theme);
    } else {
      result = generateNormalFloor(rng, floor, currentPower, diff, ownedBuffs ?? []);
    }
  }
  // 无难度模式 → 原始逻辑
  else {
    result = generateNormalFloor(rng, floor, currentPower, diff, ownedBuffs ?? []);
  }

  // 混沌诅咒：交换两个通道位置（始终消耗 2 次 rng 对齐）
  if (options) {
    const swapIdx1 = Math.floor(rng() * Math.max(1, result.lanes.length));
    const swapIdx2 = Math.floor(rng() * Math.max(1, result.lanes.length));

    const hasConfusion = options.curses.some(c => c.type === 'confusion');
    if (hasConfusion && result.lanes.length > 1 && swapIdx1 !== swapIdx2) {
      const temp = result.lanes[swapIdx1];
      result.lanes[swapIdx1] = result.lanes[swapIdx2];
      result.lanes[swapIdx2] = temp;
    }
  }

  return result;
}

// ---- Buff 效果辅助 ----

function hasBuffActive(buffs: BuffType[], buff: BuffType): boolean {
  return buffs.includes(buff);
}

function getComboPercent(buffs: BuffType[]): number {
  return hasBuffActive(buffs, 'combo_master') ? 0.20 : 0.10;
}

function applyLucky(value: number, buffs: BuffType[]): number {
  if (hasBuffActive(buffs, 'lucky')) {
    return Math.floor(value * 1.3);
  }
  return value;
}

function getMaxShield(buffs: BuffType[]): number {
  return hasBuffActive(buffs, 'fortify') ? 2 : 1;
}

// ---- 游戏模拟/重放验证 ----

export function simulateTowerGame(
  seed: string,
  choices: number[],
  difficulty?: TowerDifficulty,
): TowerSimulateOutput {
  if (typeof seed !== 'string' || seed.trim() === '') {
    return { ok: false, message: '无效的种子' };
  }
  if (!Array.isArray(choices)) {
    return { ok: false, message: '无效的选择序列' };
  }
  if (choices.length > 500) {
    return { ok: false, message: '选择步数过多' };
  }

  const rng = seedrandom(seed);
  let power = 1;
  let shield = 0;
  let combo = 0;
  let maxCombo = 0;
  let gameOver = false;
  let deathFloor: number | undefined;
  let deathLane: number | undefined;
  let bossesDefeated = 0;
  let usedShield = false;
  const buffs: BuffType[] = [];

  // 难度模式扩展状态
  const blessings: ActiveBlessing[] = [];
  const curses: ActiveCurse[] = [];
  const themeFloorsVisited: ThemeFloorType[] = [];
  const hasDifficulty = difficulty !== undefined;

  for (let i = 0; i < choices.length; i++) {
    const floorNumber = i + 1;

    if (gameOver) {
      return { ok: false, message: `第${floorNumber}层: 角色已死亡，不应有后续操作` };
    }

    // 递减祝福/诅咒持续时间
    if (hasDifficulty) {
      for (const b of blessings) b.remainingFloors--;
      for (let j = blessings.length - 1; j >= 0; j--) {
        if (blessings[j].remainingFloors <= 0) blessings.splice(j, 1);
      }
      for (const c of curses) c.remainingFloors--;
      for (let j = curses.length - 1; j >= 0; j--) {
        if (curses[j].remainingFloors <= 0) curses.splice(j, 1);
      }
    }

    // 构建楼层生成选项
    const floorOptions: GenerateFloorOptions | undefined = hasDifficulty ? {
      difficulty: difficulty!,
      blessings: blessings.map(b => ({ ...b })),
      curses: curses.map(c => ({ ...c })),
      bossesDefeated,
    } : undefined;

    const floor = generateFloor(rng, floorNumber, power, buffs, floorOptions);

    if (floor.theme) themeFloorsVisited.push(floor.theme);

    const choiceIndex = choices[i];
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= floor.lanes.length) {
      return { ok: false, message: `第${floorNumber}层通道索引无效: ${choiceIndex}` };
    }

    let lane = floor.lanes[choiceIndex];
    if (lane.type === 'mystery') {
      lane = lane.hidden;
    }

    // 计算有效攻击力（祝福/诅咒影响）
    let effectivePower = power;
    if (hasDifficulty) {
      const hasFlame = blessings.some(b => b.type === 'flame_power');
      const hasWeakness = curses.some(c => c.type === 'weakness');
      if (hasFlame) effectivePower = Math.floor(power * 1.5);
      if (hasWeakness) effectivePower = Math.floor(effectivePower * 0.75);
    }

    const hasGolden = hasDifficulty && blessings.some(b => b.type === 'golden_touch');
    const comboPercent = getComboPercent(buffs);
    const maxShieldCap = getMaxShield(buffs);

    if (lane.type === 'boss') {
      if (effectivePower > lane.value) {
        let gain = lane.value * 2;
        if (hasGolden) gain *= 2;
        if (hasBuffActive(buffs, 'lifesteal')) {
          gain += Math.floor(lane.value * 0.2);
        }
        const comboBonus = Math.floor(gain * comboPercent * combo * 2);
        power = Math.min(power + gain + comboBonus, MAX_POWER);
        bossesDefeated++;
        combo++;
        maxCombo = Math.max(maxCombo, combo);

        // Boss 击败后掷祝福
        if (hasDifficulty) {
          const blessing = rollBlessing(rng, blessings);
          if (blessing) blessings.push(blessing);
        }
      } else if (shield > 0) {
        shield--;
        usedShield = true;
        combo = 0;
      } else {
        gameOver = true;
        deathFloor = floorNumber;
        deathLane = choiceIndex;
      }
    } else if (lane.type === 'monster') {
      if (effectivePower > lane.value) {
        let gain = lane.value;
        if (hasGolden) gain *= 2;
        if (hasBuffActive(buffs, 'lifesteal')) {
          gain += Math.floor(lane.value * 0.2);
        }
        const comboBonus = Math.floor(gain * comboPercent * combo);
        power = Math.min(power + gain + comboBonus, MAX_POWER);
        combo++;
        maxCombo = Math.max(maxCombo, combo);
      } else if (shield > 0) {
        shield--;
        usedShield = true;
        combo = 0;
      } else {
        gameOver = true;
        deathFloor = floorNumber;
        deathLane = choiceIndex;
      }
    } else if (lane.type === 'add') {
      let v = applyLucky(lane.value, buffs);
      if (hasGolden) v *= 2;
      power = Math.min(power + v, MAX_POWER);
      combo = 0;
    } else if (lane.type === 'multiply') {
      let v = hasBuffActive(buffs, 'lucky') ? lane.value + 1 : lane.value;
      if (hasGolden) v *= 2;
      power = Math.min(power * v, MAX_POWER);
      combo = 0;
    } else if (lane.type === 'shield') {
      if (shield >= maxShieldCap) {
        let v = applyLucky(lane.value, buffs);
        if (hasGolden) v *= 2;
        power = Math.min(power + v, MAX_POWER);
      } else {
        shield++;
      }
      combo = 0;
    } else if (lane.type === 'shop') {
      if (!buffs.includes(lane.buff)) {
        buffs.push(lane.buff);
      }
      combo = 0;
    } else if (lane.type === 'trap') {
      if (lane.subtype === 'sub') {
        power = Math.max(1, power - lane.value);
      } else {
        power = Math.max(1, Math.ceil(power / lane.value));
      }
      combo = 0;

      // 踩陷阱后掷诅咒
      if (hasDifficulty) {
        const curse = rollCurse(rng);
        if (curse) curses.push(curse);
      }
    }
  }

  const floorsClimbed = gameOver ? choices.length - 1 : choices.length;

  return {
    ok: true,
    floorsClimbed,
    finalPower: power,
    gameOver,
    deathFloor,
    deathLane,
    finalShield: shield,
    bossesDefeated,
    maxCombo,
    finalCombo: combo,
    finalBuffs: [...buffs],
    usedShield,
    ...(hasDifficulty ? {
      difficulty,
      blessings: blessings.map(b => ({ ...b })),
      curses: curses.map(c => ({ ...c })),
      themeFloorsVisited,
    } : {}),
  };
}

// ---- 积分转换（分段计算） ----

export function floorToPoints(floorsClimbed: number): number {
  if (floorsClimbed <= 0) return 0;

  let points = 0;
  const tier1 = Math.min(floorsClimbed, 10);
  points += tier1 * 20;

  if (floorsClimbed > 10) {
    const tier2 = Math.min(floorsClimbed - 10, 10);
    points += tier2 * 15;
  }

  if (floorsClimbed > 20) {
    const tier3 = Math.min(floorsClimbed - 20, 10);
    points += tier3 * 10;
  }

  if (floorsClimbed > 30) {
    const tier4 = floorsClimbed - 30;
    points += tier4 * 5;
  }

  return points;
}

export interface TowerScoreBreakdown {
  basePoints: number;
  bossPoints: number;
  comboPoints: number;
  perfectPoints: number;
  difficultyMultiplier: number;
  total: number;
}

export function calculateTowerScore(
  floorsClimbed: number,
  bossesDefeated: number,
  maxCombo: number,
  usedShield: boolean,
  difficulty?: TowerDifficulty,
): TowerScoreBreakdown {
  const MAX_POINTS = 2000;

  const basePoints = floorToPoints(floorsClimbed);
  const bossPoints = bossesDefeated * 50;
  const comboPoints = maxCombo * 8;
  const perfectPoints = (!usedShield && floorsClimbed >= 10) ? 80 : 0;

  const difficultyMultiplier = difficulty ? DIFFICULTY_MODIFIERS[difficulty].scoreMult : 1.0;

  const rawTotal = basePoints + bossPoints + comboPoints + perfectPoints;
  const total = Math.min(Math.floor(rawTotal * difficultyMultiplier), MAX_POINTS);

  return { basePoints, bossPoints, comboPoints, perfectPoints, difficultyMultiplier, total };
}

// ---- 前端用：生成单层（带当前rng状态） ----

export function createTowerRng(seed: string): Rng {
  return seedrandom(seed);
}
