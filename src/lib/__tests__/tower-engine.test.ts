import { describe, expect, it } from 'vitest';
import {
  createTowerRng,
  floorToPoints,
  generateFloor,
  simulateTowerGame,
  type TowerLaneContent,
} from '../tower-engine';

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return value ?? 0;
  };
}

function findFirstFloorLane(
  predicate: (lane: TowerLaneContent) => boolean
): { seed: string; choice: number; lane: TowerLaneContent } {
  for (let i = 0; i < 5000; i += 1) {
    const seed = `tower-seed-${i}`;
    const floor = generateFloor(createTowerRng(seed), 1, 1);
    const choice = floor.lanes.findIndex(predicate);
    if (choice >= 0) {
      const lane = floor.lanes[choice];
      if (lane) {
        return { seed, choice, lane };
      }
    }
  }

  throw new Error('未找到满足条件的一层通道样本');
}

function findTwoFloorGrowthScenario(): {
  seed: string;
  firstChoice: number;
  secondChoice: number;
  expectedPower: number;
} {
  for (let i = 0; i < 5000; i += 1) {
    const seed = `tower-growth-${i}`;
    const rng = createTowerRng(seed);

    const floor1 = generateFloor(rng, 1, 1);
    const firstChoice = floor1.lanes.findIndex((lane) => lane.type === 'add');
    if (firstChoice < 0) continue;

    const firstLane = floor1.lanes[firstChoice];
    if (!firstLane || firstLane.type !== 'add') continue;

    const powerAfterFloor1 = 1 + firstLane.value;
    const floor2 = generateFloor(rng, 2, powerAfterFloor1);
    const secondChoice = floor2.lanes.findIndex(
      (lane) => lane.type === 'monster' && lane.value < powerAfterFloor1
    );
    if (secondChoice < 0) continue;

    const secondLane = floor2.lanes[secondChoice];
    if (!secondLane || secondLane.type !== 'monster') continue;

    return {
      seed,
      firstChoice,
      secondChoice,
      expectedPower: powerAfterFloor1 + secondLane.value,
    };
  }

  throw new Error('未找到可验证加法与怪物吞噬成长的样本');
}

describe('tower-engine', () => {
  it('会在保底安全路触发时修正不可通关楼层', () => {
    const rng = sequenceRng([0, 0, 0.9, 0.9, 0.9, 0.9, 0, 0]);
    const floor = generateFloor(rng, 1, 1);

    expect(floor.lanes).toHaveLength(2);
    expect(floor.lanes.some((lane) => lane.type === 'add')).toBe(true);
  });

  it('在中层难度允许生成乘法增益通道', () => {
    const rng = sequenceRng([0, 0, 0.35, 0, 0.9, 0]);
    const floor = generateFloor(rng, 6, 3);

    expect(floor.lanes.some((lane) => lane.type === 'multiply')).toBe(true);
  });

  it('会拒绝非法输入参数', () => {
    const invalidSeed = simulateTowerGame('', []);
    expect(invalidSeed).toEqual({ ok: false, message: '无效的种子' });

    const invalidChoices = simulateTowerGame('seed', 'bad' as unknown as number[]);
    expect(invalidChoices).toEqual({ ok: false, message: '无效的选择序列' });

    const tooManyChoices = simulateTowerGame(
      'seed',
      Array.from({ length: 501 }, () => 0)
    );
    expect(tooManyChoices).toEqual({ ok: false, message: '选择步数过多' });
  });

  it('会校验通道索引边界', () => {
    const result = simulateTowerGame('seed-for-index', [2]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('通道索引无效');
    }
  });

  it('怪物数值与玩家相等时判定死亡，且死亡后不可继续操作', () => {
    const lethalScenario = findFirstFloorLane(
      (lane) => lane.type === 'monster' && lane.value === 1
    );

    const firstResult = simulateTowerGame(lethalScenario.seed, [lethalScenario.choice]);
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) {
      throw new Error(firstResult.message);
    }
    expect(firstResult.gameOver).toBe(true);
    expect(firstResult.floorsClimbed).toBe(0);
    expect(firstResult.deathFloor).toBe(1);
    expect(firstResult.deathLane).toBe(lethalScenario.choice);

    const continuedAfterDeath = simulateTowerGame(lethalScenario.seed, [
      lethalScenario.choice,
      0,
    ]);
    expect(continuedAfterDeath.ok).toBe(false);
    if (!continuedAfterDeath.ok) {
      expect(continuedAfterDeath.message).toContain('角色已死亡');
    }
  });

  it('会按规则应用加法增益与怪物吞噬成长', () => {
    const scenario = findTwoFloorGrowthScenario();
    const result = simulateTowerGame(scenario.seed, [
      scenario.firstChoice,
      scenario.secondChoice,
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }

    expect(result.gameOver).toBe(false);
    expect(result.floorsClimbed).toBe(2);
    expect(result.finalPower).toBe(scenario.expectedPower);
  });

  it('floorToPoints 在分段与上限边界上计算正确', () => {
    expect(floorToPoints(-1)).toBe(0);
    expect(floorToPoints(1)).toBe(10);
    expect(floorToPoints(10)).toBe(100);
    expect(floorToPoints(15)).toBe(135);
    expect(floorToPoints(18)).toBe(150);
    expect(floorToPoints(100)).toBe(150);
  });
});
