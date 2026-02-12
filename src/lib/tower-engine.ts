// src/lib/tower-engine.ts - 爬塔游戏纯函数引擎（前后端共用）

import seedrandom from 'seedrandom';

// ---- 类型定义 ----

export type TowerLaneContent =
  | { type: 'monster'; value: number }
  | { type: 'add'; value: number }
  | { type: 'multiply'; value: number };

export interface TowerFloor {
  floor: number;
  lanes: TowerLaneContent[];
}

export type TowerSimulateResult =
  | {
      ok: true;
      floorsClimbed: number;
      finalPower: number;
      gameOver: boolean;
      deathFloor?: number;
      deathLane?: number;
    }
  | {
      ok: false;
      message: string;
    };

// ---- 难度配置 ----

interface DifficultyRange {
  monsterMin: number;
  monsterMax: number;
  addMin: number;
  addMax: number;
  hasMultiply: boolean;
  multiplyMin: number;
  multiplyMax: number;
  laneCount: [number, number]; // [min, max]
  safeChance: number; // 保底安全路概率 (0~1)
}

function getDifficulty(floor: number): DifficultyRange {
  if (floor <= 5) {
    return {
      monsterMin: 1, monsterMax: 3,
      addMin: 1, addMax: 3,
      hasMultiply: false, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 2],
      safeChance: 1.0,
    };
  }
  if (floor <= 15) {
    return {
      monsterMin: 2, monsterMax: 8,
      addMin: 2, addMax: 5,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 3],
      safeChance: 0.85,
    };
  }
  if (floor <= 30) {
    return {
      monsterMin: 5, monsterMax: 20,
      addMin: 3, addMax: 8,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 2,
      laneCount: [2, 3],
      safeChance: 0.55,
    };
  }
  if (floor <= 50) {
    return {
      monsterMin: 10, monsterMax: 50,
      addMin: 5, addMax: 15,
      hasMultiply: true, multiplyMin: 2, multiplyMax: 3,
      laneCount: [2, 3],
      safeChance: 0.3,
    };
  }
  // 51+
  return {
    monsterMin: 20, monsterMax: 100 + Math.floor((floor - 50) * 2),
    addMin: 10, addMax: 30,
    hasMultiply: true, multiplyMin: 2, multiplyMax: 3,
    laneCount: [2, 3],
    safeChance: 0.15,
  };
}

// ---- 工具函数 ----

type Rng = () => number;

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// ---- 楼层生成 ----

export function generateFloor(rng: Rng, floor: number, currentPower: number): TowerFloor {
  const diff = getDifficulty(floor);

  const laneCount = randInt(rng, diff.laneCount[0], diff.laneCount[1]);
  const lanes: TowerLaneContent[] = [];

  // 确定是否强制保底安全路
  const needSafe = rng() < diff.safeChance;

  for (let i = 0; i < laneCount; i++) {
    const roll = rng();

    // 生成增益类型
    if (roll < 0.3) {
      // 加法增益
      const value = randInt(rng, diff.addMin, diff.addMax);
      lanes.push({ type: 'add', value });
    } else if (diff.hasMultiply && roll < 0.4) {
      // 乘法增益
      const value = randInt(rng, diff.multiplyMin, diff.multiplyMax);
      lanes.push({ type: 'multiply', value });
    } else {
      // 怪物
      const value = randInt(rng, diff.monsterMin, diff.monsterMax);
      lanes.push({ type: 'monster', value });
    }
  }

  // 保底安全路：确保至少有一条可生存路线
  if (needSafe) {
    const hasSafe = lanes.some((lane) => {
      if (lane.type === 'add' || lane.type === 'multiply') return true;
      return lane.type === 'monster' && lane.value < currentPower;
    });

    if (!hasSafe) {
      // 替换第一条通道为安全怪物
      const safeValue = Math.max(1, Math.floor(currentPower * 0.5 * rng()) + 1);
      lanes[0] = { type: 'monster', value: Math.min(safeValue, currentPower - 1) };
      // 确保 value >= 1
      if (lanes[0].value < 1) lanes[0] = { type: 'add', value: randInt(rng, diff.addMin, diff.addMax) };
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
  let gameOver = false;
  let deathFloor: number | undefined;
  let deathLane: number | undefined;

  for (let i = 0; i < choices.length; i++) {
    const floorNumber = i + 1;

    // 死亡后不应有后续操作（在生成楼层之前检查，避免不必要的 RNG 消费）
    if (gameOver) {
      return { ok: false, message: `第${floorNumber}层: 角色已死亡，不应有后续操作` };
    }

    const floor = generateFloor(rng, floorNumber, power);
    const choiceIndex = choices[i];

    // 验证通道索引有效性
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= floor.lanes.length) {
      return { ok: false, message: `第${floorNumber}层通道索引无效: ${choiceIndex}` };
    }

    const lane = floor.lanes[choiceIndex];

    if (lane.type === 'monster') {
      if (power > lane.value) {
        // 击败怪物，吞噬其值
        power += lane.value;
      } else {
        // 死亡
        gameOver = true;
        deathFloor = floorNumber;
        deathLane = choiceIndex;
      }
    } else if (lane.type === 'add') {
      power += lane.value;
    } else if (lane.type === 'multiply') {
      power *= lane.value;
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
  };
}

// ---- 积分转换 ----

export function floorToPoints(floorsClimbed: number): number {
  const MAX_POINTS = 500;
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
