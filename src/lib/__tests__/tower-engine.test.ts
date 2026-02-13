import { describe, expect, it } from 'vitest';
import {
  createTowerRng,
  floorToPoints,
  calculateTowerScore,
  generateFloor,
  simulateTowerGame,
  DIFFICULTY_MODIFIERS,
  type TowerLaneContent,
  type ResolvedLaneContent,
  type BuffType,
  type TowerDifficulty,
  type GenerateFloorOptions,
} from '../tower-engine';

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
    for (let i = 0; i < 5000; i++) {
      const seed = `safe-${i}`;
      const floor = generateFloor(createTowerRng(seed), 1, 1);
      const hasSafe = floor.lanes.some((lane) => {
        const r = resolveLane(lane);
        return r.type === 'add' || r.type === 'multiply' || r.type === 'shield' || (r.type === 'monster' && r.value < 1);
      });
      expect(hasSafe).toBe(true);
      break;
    }
  });

  it('在中层难度允许生成乘法增益通道', () => {
    let found = false;
    for (let i = 0; i < 5000; i++) {
      const seed = `multiply-${i}`;
      const rng = createTowerRng(seed);
      let power = 1;
      for (let f = 1; f <= 5; f++) {
        const floor = generateFloor(rng, f, power);
        const safeIdx = floor.lanes.findIndex((l) => {
          const r = resolveLane(l);
          return r.type === 'add' || (r.type === 'monster' && r.value < power);
        });
        if (safeIdx >= 0) {
          const r = resolveLane(floor.lanes[safeIdx]);
          if (r.type === 'add') power += r.value;
          else if (r.type === 'monster' && power > r.value) power += r.value;
        }
      }
      const floor6 = generateFloor(rng, 6, power);
      if (floor6.lanes.some((lane) => resolveLane(lane).type === 'multiply')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('Boss 层在 10 的倍数时生成', () => {
    const rng = createTowerRng('boss-test');
    let power = 100;
    for (let f = 1; f <= 9; f++) {
      generateFloor(rng, f, power);
    }
    const floor10 = generateFloor(rng, 10, power);

    expect(floor10.isBoss).toBe(true);
    expect(floor10.lanes).toHaveLength(2);
    expect(floor10.lanes.some((l) => resolveLane(l).type === 'boss')).toBe(true);
  });

  it('商店层在第 5 层出现', () => {
    const rng = createTowerRng('shop-test');
    let power = 10;
    for (let f = 1; f <= 4; f++) {
      generateFloor(rng, f, power);
    }
    const floor5 = generateFloor(rng, 5, power, []);
    expect(floor5.isShop).toBe(true);
    expect(floor5.lanes.some((l) => resolveLane(l).type === 'shop')).toBe(true);
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
    for (let i = 0; i < 5000; i++) {
      const seed = `shield-test-${i}`;
      const rng = createTowerRng(seed);
      let power = 1;
      let shield = 0;
      const choices: number[] = [];

      let found = false;
      for (let f = 1; f <= 20; f++) {
        const floor = generateFloor(rng, f, power, []);

        if (floor.isShop) {
          choices.push(0);
          continue;
        }

        if (shield === 0) {
          const shieldIdx = floor.lanes.findIndex((l) => resolveLane(l).type === 'shield');
          if (shieldIdx >= 0) {
            choices.push(shieldIdx);
            shield = 1;
            continue;
          }
        } else {
          const lethalIdx = floor.lanes.findIndex((l) => {
            const r = resolveLane(l);
            return r.type === 'monster' && r.value >= power;
          });
          if (lethalIdx >= 0) {
            choices.push(lethalIdx);
            const sim = simulateTowerGame(seed, choices);
            expect(sim.ok).toBe(true);
            if (sim.ok) {
              expect(sim.gameOver).toBe(false);
              expect(sim.finalShield).toBe(0);
            }
            found = true;
            break;
          }
        }

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

  it('连击系统正确计数', () => {
    for (let i = 0; i < 5000; i++) {
      const seed = `combo-test-${i}`;
      const rng = createTowerRng(seed);
      let power = 1;
      const choices: number[] = [];

      const floor1 = generateFloor(rng, 1, power);
      const addIdx = floor1.lanes.findIndex((l) => resolveLane(l).type === 'add');
      if (addIdx < 0) continue;
      choices.push(addIdx);
      const addLane = resolveLane(floor1.lanes[addIdx]);
      if (addLane.type === 'add') power += addLane.value;

      let monstersKilled = 0;
      for (let f = 2; f <= 8; f++) {
        const floor = generateFloor(rng, f, power);
        const monsterIdx = floor.lanes.findIndex((l) => {
          const r = resolveLane(l);
          return r.type === 'monster' && r.value < power;
        });
        if (monsterIdx >= 0) {
          choices.push(monsterIdx);
          const r = resolveLane(floor.lanes[monsterIdx]);
          if (r.type === 'monster') power += r.value;
          monstersKilled++;
          if (monstersKilled >= 2) break;
        } else {
          const safeIdx = floor.lanes.findIndex((l) => {
            const r = resolveLane(l);
            return r.type === 'add';
          });
          if (safeIdx < 0) break;
          choices.push(safeIdx);
          const r = resolveLane(floor.lanes[safeIdx]);
          if (r.type === 'add') power += r.value;
          monstersKilled = 0;
        }
      }

      if (monstersKilled >= 2) {
        const sim = simulateTowerGame(seed, choices);
        expect(sim.ok).toBe(true);
        if (sim.ok) {
          expect(sim.maxCombo).toBeGreaterThanOrEqual(2);
        }
        return;
      }
    }
    throw new Error('未找到可验证连击系统的样本');
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
    expect(floorToPoints(100)).toBe(800);
  });

  it('calculateTowerScore 正确计算各项加分', () => {
    const score = calculateTowerScore(20, 2, 5, false);
    expect(score.basePoints).toBe(350);
    expect(score.bossPoints).toBe(100);
    expect(score.comboPoints).toBe(40);
    expect(score.perfectPoints).toBe(80);
    expect(score.total).toBe(570);
  });

  it('calculateTowerScore 上限为 2000', () => {
    const score = calculateTowerScore(300, 10, 50, false);
    expect(score.total).toBe(2000);
  });

  it('完美加分需要至少过 10 层且未使用护盾', () => {
    const yes = calculateTowerScore(10, 0, 0, false);
    expect(yes.perfectPoints).toBe(80);

    const noShort = calculateTowerScore(9, 0, 0, false);
    expect(noShort.perfectPoints).toBe(0);

    const noShield = calculateTowerScore(20, 0, 0, true);
    expect(noShield.perfectPoints).toBe(0);
  });

  // ---- 第三期新增测试 ----

  it('difficulty=undefined 时结果与旧路径完全一致（向后兼容）', () => {
    const seed = 'compat-test-42';
    const choices = [0, 1, 0];
    const resultOld = simulateTowerGame(seed, choices);
    const resultNew = simulateTowerGame(seed, choices, undefined);
    expect(resultOld).toEqual(resultNew);
  });

  it('difficulty=normal 的积分倍率为 1.0', () => {
    const score = calculateTowerScore(20, 2, 5, false, 'normal');
    expect(score.difficultyMultiplier).toBe(1);
    expect(score.total).toBe(570); // same as without difficulty
  });

  it('difficulty=hard 的积分倍率为 1.5', () => {
    const score = calculateTowerScore(20, 2, 5, false, 'hard');
    expect(score.difficultyMultiplier).toBe(1.5);
    // (350+100+40+80) * 1.5 = 855
    expect(score.total).toBe(855);
  });

  it('difficulty=hell 的积分倍率为 2.5', () => {
    const score = calculateTowerScore(20, 2, 5, false, 'hell');
    expect(score.difficultyMultiplier).toBe(2.5);
    // (350+100+40+80) * 2.5 = 1425
    expect(score.total).toBe(1425);
  });

  it('difficulty 积分倍率仍受 2000 上限约束', () => {
    const score = calculateTowerScore(300, 10, 50, false, 'hell');
    expect(score.total).toBe(2000);
  });

  it('DIFFICULTY_MODIFIERS 定义完整', () => {
    expect(DIFFICULTY_MODIFIERS.normal.scoreMult).toBe(1.0);
    expect(DIFFICULTY_MODIFIERS.hard.scoreMult).toBe(1.5);
    expect(DIFFICULTY_MODIFIERS.hell.scoreMult).toBe(2.5);
    expect(DIFFICULTY_MODIFIERS.hard.monsterMult).toBe(1.3);
    expect(DIFFICULTY_MODIFIERS.hell.monsterMult).toBe(1.6);
    expect(DIFFICULTY_MODIFIERS.hell.safeMult).toBe(0);
  });

  it('difficulty=normal 时 simulateTowerGame 返回 difficulty 字段', () => {
    const sim = simulateTowerGame('diff-sim-test', [0], 'normal');
    if (sim.ok) {
      expect(sim.difficulty).toBe('normal');
    }
  });

  it('generateFloor 传入 options 时能正确生成楼层', () => {
    const rng = createTowerRng('opts-floor-test');
    const opts: GenerateFloorOptions = {
      difficulty: 'hard',
      blessings: [],
      curses: [],
      bossesDefeated: 0,
    };
    const floor = generateFloor(rng, 1, 1, [], opts);
    expect(floor.floor).toBe(1);
    expect(floor.lanes.length).toBeGreaterThanOrEqual(2);
  });

  it('RNG 确定性：相同 seed + choices + difficulty 总是产生相同结果', () => {
    const seed = 'determinism-test-123';
    const choices = [0, 1, 0, 1, 0];
    const difficulties: (TowerDifficulty | undefined)[] = [undefined, 'normal', 'hard', 'hell'];

    for (const diff of difficulties) {
      const r1 = simulateTowerGame(seed, choices, diff);
      const r2 = simulateTowerGame(seed, choices, diff);
      expect(r1).toEqual(r2);
    }
  });

  it('generateFloor 在 Boss 层仍生成 Boss（带 difficulty options）', () => {
    const rng = createTowerRng('boss-diff-test');
    const opts: GenerateFloorOptions = {
      difficulty: 'hell',
      blessings: [],
      curses: [],
      bossesDefeated: 0,
    };
    let power = 100;
    for (let f = 1; f <= 9; f++) {
      generateFloor(rng, f, power, [], opts);
    }
    const floor10 = generateFloor(rng, 10, power, [], opts);
    expect(floor10.isBoss).toBe(true);
    expect(floor10.lanes.some(l => resolveLane(l).type === 'boss')).toBe(true);
  });

  it('generateFloor 在商店层仍生成商店（带 difficulty options）', () => {
    const rng = createTowerRng('shop-diff-test');
    const opts: GenerateFloorOptions = {
      difficulty: 'hard',
      blessings: [],
      curses: [],
      bossesDefeated: 0,
    };
    let power = 10;
    for (let f = 1; f <= 4; f++) {
      generateFloor(rng, f, power, [], opts);
    }
    const floor5 = generateFloor(rng, 5, power, [], opts);
    expect(floor5.isShop).toBe(true);
    expect(floor5.lanes.some(l => resolveLane(l).type === 'shop')).toBe(true);
  });
});
