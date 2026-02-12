import { describe, expect, it } from 'vitest';
import {
  createTowerRng,
  floorToPoints,
  generateFloor,
  simulateTowerGame,
  type TowerLaneContent,
  type ResolvedLaneContent,
} from '../tower-engine';

function sequenceRng(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return value ?? 0;
  };
}

function resolveLane(lane: TowerLaneContent): ResolvedLaneContent {
  return lane.type === 'mystery' ? lane.hidden : lane;
}

function findFirstFloorLane(
  predicate: (lane: ResolvedLaneContent) => boolean
): { seed: string; choice: number; lane: ResolvedLaneContent } {
  for (let i = 0; i < 5000; i += 1) {
    const seed = `tower-seed-${i}`;
    const floor = generateFloor(createTowerRng(seed), 1, 1);
    const choice = floor.lanes.findIndex((l) => predicate(resolveLane(l)));
    if (choice >= 0) {
      const lane = resolveLane(floor.lanes[choice]);
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
    const firstChoice = floor1.lanes.findIndex((l) => resolveLane(l).type === 'add');
    if (firstChoice < 0) continue;

    const firstLane = resolveLane(floor1.lanes[firstChoice]);
    if (firstLane.type !== 'add') continue;

    const powerAfterFloor1 = 1 + firstLane.value;
    const floor2 = generateFloor(rng, 2, powerAfterFloor1);
    const secondChoice = floor2.lanes.findIndex((l) => {
      const resolved = resolveLane(l);
      return resolved.type === 'monster' && resolved.value < powerAfterFloor1;
    });
    if (secondChoice < 0) continue;

    const secondLane = resolveLane(floor2.lanes[secondChoice]);
    if (secondLane.type !== 'monster') continue;

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
  it('会在保底安全路触发时确保存在安全通道', () => {
    // 新 RNG 模式：每条通道消费 3 次 (shieldRoll, typeRoll, valueRoll)
    // 层 1: laneCount=[2,2], safeChance=1.0, shieldChance=0, mysteryChance=0
    // idx0=0 → laneCount=2, idx1=0 → needSafe=true
    // Lane 0: idx2=0.9(shield), idx3=0.9(type), idx4=0.9(value) → monster(3)
    // Lane 1: idx5=0.9(shield), idx6=0(type), idx7=0(value) → add(1)
    const rng = sequenceRng([0, 0, 0.9, 0.9, 0.9, 0.9, 0, 0]);
    const floor = generateFloor(rng, 1, 1);

    expect(floor.lanes).toHaveLength(2);
    expect(floor.lanes.some((lane) => resolveLane(lane).type === 'add')).toBe(true);
  });

  it('在中层难度允许生成乘法增益通道', () => {
    // 层 6: shieldChance=0.05, hasMultiply=true, multiplyMin=2, multiplyMax=2, mysteryChance=0.15
    // idx0=0 → laneCount=2
    // idx1=0.5 → needSafe (0.5 < 0.85)
    // Lane 0: idx2=0.1(>=0.05 not shield), idx3=0.35(multiply), idx4=0.5(value: 2+floor(0.5*1)=2)
    // Lane 1: idx5=0.1(>=0.05 not shield), idx6=0.5(>=0.4 monster), idx7=0.1(value: 2+floor(0.1*7)=2)
    // Mystery: idx8=0.5(>0.15 skip), idx9=0.5(>0.15 skip)
    const rng = sequenceRng([0, 0.5, 0.1, 0.35, 0.5, 0.1, 0.5, 0.1, 0.5, 0.5]);
    const floor = generateFloor(rng, 6, 3);

    expect(floor.lanes.some((lane) => resolveLane(lane).type === 'multiply')).toBe(true);
  });

  it('Boss 层在 10 的倍数时生成', () => {
    const rng = createTowerRng('boss-test');
    let power = 100;
    const floor10 = generateFloor(rng, 10, power);

    expect(floor10.isBoss).toBe(true);
    expect(floor10.lanes).toHaveLength(2);
    expect(floor10.lanes.some((l) => resolveLane(l).type === 'boss')).toBe(true);
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

  it('护盾可抵挡一次致命怪物攻击', () => {
    // 搜索一个 seed，在前几层内能找到 shield 通道和致命 monster
    for (let i = 0; i < 5000; i++) {
      const seed = `shield-test-${i}`;
      const rng = createTowerRng(seed);
      let power = 1;
      let shield = false;
      const choices: number[] = [];

      let found = false;
      for (let f = 1; f <= 20; f++) {
        const floor = generateFloor(rng, f, power);

        if (!shield) {
          // 寻找 shield 通道
          const shieldIdx = floor.lanes.findIndex((l) => resolveLane(l).type === 'shield');
          if (shieldIdx >= 0) {
            choices.push(shieldIdx);
            shield = true;
            continue;
          }
        } else {
          // 有盾，寻找打不过的怪物
          const lethalIdx = floor.lanes.findIndex((l) => {
            const r = resolveLane(l);
            return r.type === 'monster' && r.value >= power;
          });
          if (lethalIdx >= 0) {
            choices.push(lethalIdx);
            // 护盾应该抵挡了
            const sim = simulateTowerGame(seed, choices);
            expect(sim.ok).toBe(true);
            if (sim.ok) {
              expect(sim.gameOver).toBe(false);
              expect(sim.finalShield).toBe(false);
            }
            found = true;
            break;
          }
        }

        // 选择安全路线继续
        const safeIdx = floor.lanes.findIndex((l) => {
          const r = resolveLane(l);
          return r.type === 'add' || (r.type === 'monster' && r.value < power);
        });
        if (safeIdx < 0) break;
        choices.push(safeIdx);
        const r = resolveLane(floor.lanes[safeIdx]);
        if (r.type === 'add') power += r.value;
        else if (r.type === 'monster' && power > r.value) power += r.value;
      }

      if (found) return;
    }

    throw new Error('未找到可验证护盾机制的样本');
  });

  it('floorToPoints 在分段与上限边界上计算正确', () => {
    expect(floorToPoints(-1)).toBe(0);
    expect(floorToPoints(0)).toBe(0);
    expect(floorToPoints(1)).toBe(20);
    expect(floorToPoints(10)).toBe(200);
    expect(floorToPoints(15)).toBe(275);
    expect(floorToPoints(20)).toBe(350);
    expect(floorToPoints(30)).toBe(450);
    expect(floorToPoints(40)).toBe(500);
    expect(floorToPoints(100)).toBe(500);
  });
});
