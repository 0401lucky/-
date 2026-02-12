// src/lib/tower-engine.ts - 爬塔游戏纯函数引擎（前后端共用）

import seedrandom from 'seedrandom';

// ---- 类型定义 ----

export type ResolvedLaneContent =
  | { type: 'monster'; value: number }
  | { type: 'add'; value: number }
  | { type: 'multiply'; value: number }
  | { type: 'boss'; value: number }
  | { type: 'shield'; value: number };

export type TowerLaneContent =
  | ResolvedLaneContent
  | { type: 'mystery'; hidden: ResolvedLaneContent };

export interface TowerFloor {
  floor: number;
  lanes: TowerLaneContent[];
  isBoss?: boolean;
}

export type TowerSimulateResult =
  | {
      ok: true;
      floorsClimbed: number;
      finalPower: number;
      gameOver: boolean;
      deathFloor?: number;
      deathLane?: number;
      finalShield: boolean;
      bossesDefeated: number;
    }
  | {
      ok: false;
      message: string;
    };

// ---- 力量值上限 ----

export const MAX_POWER = 999_999_999;

export function formatPower(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ---- 难度配置 ----

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
}

function getDifficulty(floor: number): DifficultyRange {
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

// ---- 楼层生成 ----

export function generateFloor(rng: Rng, floor: number, currentPower: number): TowerFloor {
  const diff = getDifficulty(floor);

  // Boss 层走独立分支
  if (floor > 0 && floor % 10 === 0) {
    return generateBossFloor(rng, floor, currentPower, diff);
  }

  const laneCount = randInt(rng, diff.laneCount[0], diff.laneCount[1]);

  // 确定是否强制保底安全路
  const needSafe = rng() < diff.safeChance;

  const lanes: TowerLaneContent[] = [];

  for (let i = 0; i < laneCount; i++) {
    // 每条通道固定消费 3 次 rng，保证 RNG 序列确定
    const shieldRoll = rng();
    const typeRoll = rng();
    const valueRoll = rng();

    if (shieldRoll < diff.shieldChance) {
      const value = diff.shieldConvertMin + Math.floor(valueRoll * (diff.shieldConvertMax - diff.shieldConvertMin + 1));
      lanes.push({ type: 'shield', value });
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

  // 保底安全路：shield 也视为安全通道
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

  // 迷雾包裹（在通道生成之后，此时 lanes 全为 ResolvedLaneContent）
  if (diff.mysteryChance > 0) {
    for (let i = 0; i < lanes.length; i++) {
      if (rng() < diff.mysteryChance) {
        lanes[i] = { type: 'mystery', hidden: lanes[i] as ResolvedLaneContent };
      }
    }
  }

  return { floor, lanes };
}

// ---- 游戏模拟/重放验证 ----

export function simulateTowerGame(
  seed: string,
  choices: number[]
): TowerSimulateResult {
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
  let shield = false;
  let gameOver = false;
  let deathFloor: number | undefined;
  let deathLane: number | undefined;
  let bossesDefeated = 0;

  for (let i = 0; i < choices.length; i++) {
    const floorNumber = i + 1;

    if (gameOver) {
      return { ok: false, message: `第${floorNumber}层: 角色已死亡，不应有后续操作` };
    }

    const floor = generateFloor(rng, floorNumber, power);
    const choiceIndex = choices[i];

    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= floor.lanes.length) {
      return { ok: false, message: `第${floorNumber}层通道索引无效: ${choiceIndex}` };
    }

    let lane = floor.lanes[choiceIndex];

    // mystery 解包
    if (lane.type === 'mystery') {
      lane = lane.hidden;
    }

    if (lane.type === 'boss') {
      if (power > lane.value) {
        power = Math.min(power + lane.value * 2, MAX_POWER);
        bossesDefeated++;
      } else if (shield) {
        shield = false;
      } else {
        gameOver = true;
        deathFloor = floorNumber;
        deathLane = choiceIndex;
      }
    } else if (lane.type === 'monster') {
      if (power > lane.value) {
        power = Math.min(power + lane.value, MAX_POWER);
      } else if (shield) {
        shield = false;
      } else {
        gameOver = true;
        deathFloor = floorNumber;
        deathLane = choiceIndex;
      }
    } else if (lane.type === 'add') {
      power = Math.min(power + lane.value, MAX_POWER);
    } else if (lane.type === 'multiply') {
      power = Math.min(power * lane.value, MAX_POWER);
    } else if (lane.type === 'shield') {
      if (shield) {
        power = Math.min(power + lane.value, MAX_POWER);
      } else {
        shield = true;
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
  };
}

// ---- 积分转换 ----

export function floorToPoints(floorsClimbed: number): number {
  const MAX_POINTS = 1500;
  let points = 0;

  if (floorsClimbed <= 0) return 0;

  // 层1-10：每层20分
  const tier1 = Math.min(floorsClimbed, 10);
  points += tier1 * 20;

  // 层11-20：每层15分
  if (floorsClimbed > 10) {
    const tier2 = Math.min(floorsClimbed - 10, 10);
    points += tier2 * 15;
  }

  // 层21-30：每层10分
  if (floorsClimbed > 20) {
    const tier3 = Math.min(floorsClimbed - 20, 10);
    points += tier3 * 10;
  }

  // 层31+：每层5分
  if (floorsClimbed > 30) {
    const tier4 = floorsClimbed - 30;
    points += tier4 * 5;
  }

  return Math.min(points, MAX_POINTS);
}

// ---- 前端用：生成单层（带当前rng状态） ----

export function createTowerRng(seed: string): Rng {
  return seedrandom(seed);
}
