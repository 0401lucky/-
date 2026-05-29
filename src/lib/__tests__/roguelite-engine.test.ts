import { describe, expect, it } from 'vitest';
import {
  ROGUELITE_EXPANDED_SIGHT_RADIUS,
  ROGUELITE_SIGHT_RADIUS,
  ROGUELITE_START_POSITION,
  ROGUELITE_VIEW_RADIUS,
  ROGUELITE_VIEW_SIZE,
  buildRogueliteStateView,
  calculateRoguelitePointReward,
  calculateRogueliteScore,
  createInitialRogueliteState,
  generateRogueliteBoard,
  generateRogueliteCell,
  positionKey,
  resolveRogueliteAction,
  type RogueliteCell,
  type RogueliteCellType,
  type RogueliteGameState,
  type RoguelitePosition,
} from '../roguelite-engine';

function makeCell(position: RoguelitePosition, type: RogueliteCellType, patch: Partial<RogueliteCell> = {}): RogueliteCell {
  return {
    id: `test:${position.row}:${position.col}`,
    position,
    type,
    risk: type === 'rift' || type === 'boss' ? 'high' : type === 'empty' || type === 'start' ? 'safe' : 'medium',
    hint: '测试线索',
    label: '测试格',
    icon: '·',
    ...patch,
  };
}

function buildStateWithCells(
  cells: RogueliteCell[],
  floor = 1,
  exit: RoguelitePosition = { row: 6, col: 0 },
): RogueliteGameState {
  const state = createInitialRogueliteState('roguelite-test-seed');
  state.floor = floor;
  state.board = {
    ...generateRogueliteBoard(state.seed, floor),
    exitPosition: exit,
  };
  state.player.position = { ...ROGUELITE_START_POSITION };
  state.visited = [positionKey(ROGUELITE_START_POSITION)];
  state.player.exploredCells = 1;
  state.cellOverrides = Object.fromEntries(cells.map((cell) => [positionKey(cell.position), cell]));
  return state;
}

function moveOk(state: RogueliteGameState, to: RoguelitePosition): RogueliteGameState {
  const result = resolveRogueliteAction(state, { type: 'move', to });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('roguelite-engine', () => {
  it('起点是世界坐标正中心，视窗中心始终是玩家', () => {
    const state = createInitialRogueliteState('center-start');

    expect(state.player.position).toEqual({ row: 0, col: 0 });

    state.player.position = { row: 3, col: -2 };
    state.visited = [positionKey(state.player.position)];
    const view = buildRogueliteStateView(state);
    const current = view.board.find((cell) => cell.state === 'current');

    expect(view.boardSize).toBe(ROGUELITE_VIEW_SIZE);
    expect(view.board).toHaveLength(ROGUELITE_VIEW_SIZE * ROGUELITE_VIEW_SIZE);
    expect(current?.position).toEqual(state.player.position);
    expect(current?.viewPosition).toEqual({ row: ROGUELITE_VIEW_RADIUS, col: ROGUELITE_VIEW_RADIUS });
  });

  it('默认只显示中心与周围 8 格', () => {
    const state = createInitialRogueliteState('base-vision');
    const view = buildRogueliteStateView(state);
    const hiddenCells = view.board.filter((cell) => cell.state === 'hidden');

    expect(view.viewportRadius).toBe(ROGUELITE_VIEW_RADIUS);
    expect(view.sightRadius).toBe(ROGUELITE_SIGHT_RADIUS);
    expect(view.boardSize).toBe(ROGUELITE_VIEW_SIZE);
    expect(view.board).toHaveLength(ROGUELITE_VIEW_SIZE * ROGUELITE_VIEW_SIZE);
    expect(hiddenCells).toHaveLength(40);
    expect(hiddenCells[0]?.label).toBe('迷雾');
  });

  it('星辉透镜会额外显示外圈 16 格', () => {
    const state = createInitialRogueliteState('expanded-vision');
    state.player.relics = ['starlight_lens'];

    const view = buildRogueliteStateView(state);
    const current = view.board.find((cell) => cell.state === 'current');
    const hiddenCells = view.board.filter((cell) => cell.state === 'hidden');

    expect(view.viewportRadius).toBe(ROGUELITE_VIEW_RADIUS);
    expect(view.sightRadius).toBe(ROGUELITE_EXPANDED_SIGHT_RADIUS);
    expect(view.boardSize).toBe(ROGUELITE_VIEW_SIZE);
    expect(view.board).toHaveLength(ROGUELITE_VIEW_SIZE * ROGUELITE_VIEW_SIZE);
    expect(hiddenCells).toHaveLength(24);
    expect(current?.viewPosition).toEqual({
      row: ROGUELITE_VIEW_RADIUS,
      col: ROGUELITE_VIEW_RADIUS,
    });
  });

  it('走过路线照亮过的视野不会消失', () => {
    const state = buildStateWithCells([
      makeCell({ row: 0, col: 1 }, 'empty'),
    ]);
    const moved = moveOk(state, { row: 0, col: 1 });

    const view = buildRogueliteStateView(moved);
    const rememberedCell = view.board.find((cell) => cell.position.row === -1 && cell.position.col === -1);

    expect(rememberedCell?.state).not.toBe('hidden');
  });

  it('相同 seed、层数和世界坐标会生成完全相同的格子', () => {
    const firstBoard = generateRogueliteBoard('fixed-seed', 2);
    const secondBoard = generateRogueliteBoard('fixed-seed', 2);
    const firstCell = generateRogueliteCell('fixed-seed', 2, { row: 12, col: -7 });
    const secondCell = generateRogueliteCell('fixed-seed', 2, { row: 12, col: -7 });

    expect(secondBoard).toEqual(firstBoard);
    expect(secondCell).toEqual(firstCell);
  });

  it('事件格会从扩展事件池中稳定随机抽取两个选项', () => {
    const seen = new Set<string>();
    let checkedEvents = 0;

    for (let row = -20; row <= 20; row += 1) {
      for (let col = -20; col <= 20; col += 1) {
        const cell = generateRogueliteCell('event-pool-check', 2, { row, col });
        if (cell.type !== 'event') continue;

        const sameCell = generateRogueliteCell('event-pool-check', 2, { row, col });
        expect(cell.eventOptions).toHaveLength(2);
        expect(sameCell.eventOptions).toEqual(cell.eventOptions);
        for (const option of cell.eventOptions ?? []) {
          seen.add(option.id);
        }
        checkedEvents += 1;
      }
    }

    expect(checkedEvents).toBeGreaterThan(10);
    expect(seen.size).toBeGreaterThan(8);
  });

  it('会拒绝非相邻移动', () => {
    const state = createInitialRogueliteState('move-check');
    const result = resolveRogueliteAction(state, {
      type: 'move',
      to: { row: 2, col: 2 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('相邻格子');
    }
  });

  it('可以移动到旧 5x5 边界外的坐标', () => {
    const state = buildStateWithCells([
      makeCell({ row: 0, col: -1 }, 'empty'),
    ]);

    const result = resolveRogueliteAction(state, { type: 'move', to: { row: 0, col: -1 } });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.player.position).toEqual({ row: 0, col: -1 });
  });

  it('已触发世界坐标不会重复发放星尘奖励', () => {
    const rewardCell = makeCell(
      { row: 1, col: 0 },
      'stardust',
      { stardust: 20, risk: 'low', label: '星尘' },
    );
    const state = buildStateWithCells([
      rewardCell,
      makeCell({ row: 0, col: 0 }, 'start'),
    ]);

    const first = moveOk(state, rewardCell.position);
    expect(first.player.stardust).toBe(20);

    const back = moveOk(first, { row: 0, col: 0 });
    const second = moveOk(back, rewardCell.position);
    expect(second.player.stardust).toBe(20);
  });

  it('集尘瓶会提高星尘格收益', () => {
    const rewardCell = makeCell(
      { row: 1, col: 0 },
      'stardust',
      { stardust: 20, risk: 'low', label: '星尘' },
    );
    const state = buildStateWithCells([rewardCell]);
    state.player.relics = ['dust_collector'];

    const result = resolveRogueliteAction(state, { type: 'move', to: rewardCell.position });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.player.stardust).toBe(24);
    expect(result.outcome.stardustDelta).toBe(24);
  });

  it('战斗类新增遗物会在进战和击败时生效', () => {
    const monsterCell = makeCell(
      { row: 1, col: 0 },
      'monster',
      {
        monster: {
          name: '测试守卫',
          hp: 1,
          maxHp: 1,
          attack: 1,
          rewardStardust: 7,
        },
      },
    );
    const state = buildStateWithCells([monsterCell]);
    state.player.relics = ['warden_glyph', 'spoils_magnet'];

    const encounter = resolveRogueliteAction(state, { type: 'move', to: monsterCell.position });
    expect(encounter.ok).toBe(true);
    if (!encounter.ok) throw new Error(encounter.message);
    expect(encounter.state.pending?.type).toBe('combat');
    expect(encounter.state.player.shield).toBe(3);

    const defeated = resolveRogueliteAction(encounter.state, { type: 'combat', style: 'attack' });
    expect(defeated.ok).toBe(true);
    if (!defeated.ok) throw new Error(defeated.message);
    expect(defeated.state.pending).toBeUndefined();
    expect(defeated.state.player.stardust).toBe(12);
    expect(defeated.outcome.stardustDelta).toBe(12);
  });

  it('生命归零时会进入失败状态', () => {
    const rift = makeCell(
      { row: 1, col: 0 },
      'rift',
      { damage: 99, risk: 'high', label: '裂隙' },
    );
    const state = buildStateWithCells([rift]);

    const result = resolveRogueliteAction(state, { type: 'move', to: rift.position });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.status).toBe('defeated');
    expect(result.state.player.hp).toBe(0);
  });

  it('第三层星门后进入无尽阶段，并允许撤离结算', () => {
    const exit = { row: 1, col: 0 };
    const state = buildStateWithCells([], 3, exit);

    const throughGate = resolveRogueliteAction(state, {
      type: 'move',
      to: exit,
    });

    expect(throughGate.ok).toBe(true);
    if (!throughGate.ok) throw new Error(throughGate.message);
    expect(throughGate.state.status).toBe('playing');
    expect(throughGate.state.floor).toBe(4);
    expect(throughGate.state.player.floorsCleared).toBe(3);

    const escaped = resolveRogueliteAction(throughGate.state, { type: 'escape' });
    expect(escaped.ok).toBe(true);
    if (!escaped.ok) throw new Error(escaped.message);
    expect(escaped.state.status).toBe('escaped');
  });

  it('未穿过第三层星门前不能撤离', () => {
    const state = createInitialRogueliteState('escape-check');
    const result = resolveRogueliteAction(state, { type: 'escape' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('第 3 层');
    }
  });

  it('新增事件会按服务端状态结算', () => {
    const state = buildStateWithCells([]);
    state.player.stardust = 7;
    state.player.keys = 0;
    state.pending = {
      type: 'event',
      position: { row: 1, col: 0 },
      options: [
        { id: 'key_trade', label: '与钥灵交易', description: '测试事件' },
        { id: 'time_spark', label: '点燃时光火花', description: '测试事件' },
      ],
    };

    const result = resolveRogueliteAction(state, { type: 'event', optionId: 'key_trade' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.pending).toBeUndefined();
    expect(result.state.player.keys).toBe(2);
    expect(result.state.player.stardust).toBe(0);
    expect(result.state.player.hp).toBe(27);
    expect(result.outcome.keyDelta).toBe(2);
    expect(result.outcome.stardustDelta).toBe(-7);
    expect(result.outcome.hpDelta).toBe(-3);
  });

  it('结算分数完全来自服务端状态', () => {
    const state = createInitialRogueliteState('score-check');
    state.status = 'escaped';
    state.floor = 4;
    state.player.floorsCleared = 3;
    state.player.exploredCells = 18;
    state.player.stardust = 40;
    state.player.hp = 12;
    state.player.relics = ['battle_charm', 'star_compass'];
    state.player.monstersDefeated = 4;
    state.player.chestsOpened = 1;

    const score = calculateRogueliteScore(state);

    expect(score.total).toBeGreaterThan(0);
    expect(score.winBonus).toBeGreaterThan(0);
    expect(score.total).toBe(
      score.floorPoints
      + score.explorationPoints
      + score.monsterPoints
      + score.stardustPoints
      + score.lifePoints
      + score.relicPoints
      + score.chestPoints
      + score.winBonus,
    );
  });

  it('无尽阶段分数不会被 3000 硬封顶', () => {
    const state = createInitialRogueliteState('score-cap-check');
    state.status = 'escaped';
    state.floor = 12;
    state.player.floorsCleared = 11;
    state.player.exploredCells = 200;
    state.player.stardust = 500;
    state.player.hp = 30;
    state.player.relics = ['battle_charm', 'star_compass', 'dust_collector', 'meteor_boots'];
    state.player.monstersDefeated = 30;
    state.player.chestsOpened = 10;

    const score = calculateRogueliteScore(state);

    expect(score.total).toBeGreaterThan(3000);
  });

  it('重复提交当前位置移动会按幂等操作处理', () => {
    const state = buildStateWithCells([]);
    const result = resolveRogueliteAction(state, { type: 'move', to: ROGUELITE_START_POSITION });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.player.position).toEqual(ROGUELITE_START_POSITION);
    expect(result.outcome.message).toContain('当前位置');
  });

  it('存在待处理事件时会拒绝继续移动，等待客户端同步处理', () => {
    const state = buildStateWithCells([]);
    state.pending = {
      type: 'event',
      position: ROGUELITE_START_POSITION,
      options: [{ id: 'test_option', label: '测试选项', description: '测试事件' }],
    };

    const result = resolveRogueliteAction(state, { type: 'move', to: { row: 0, col: 1 } });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('移动不应该成功');
    expect(result.message).toContain('当前事件尚未处理完成');
  });

  it('福利积分按得分 10% 向下取整', () => {
    expect(calculateRoguelitePointReward(0)).toBe(0);
    expect(calculateRoguelitePointReward(9)).toBe(0);
    expect(calculateRoguelitePointReward(991)).toBe(99);
    expect(calculateRoguelitePointReward(3000)).toBe(300);
  });
});
