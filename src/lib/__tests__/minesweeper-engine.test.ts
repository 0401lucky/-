import { describe, expect, it } from 'vitest';
import {
  buildMinesweeperStateView,
  calculateMinesweeperPointReward,
  calculateMinesweeperScore,
  createInitialMinesweeperState,
  generateMinesweeperMinePositions,
  positionKey,
  resolveMinesweeperAction,
  type MinesweeperGameState,
} from '../minesweeper-engine';

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  return result as Extract<T, { ok: true }>;
}

function reveal(state: MinesweeperGameState, row: number, col: number): MinesweeperGameState {
  return ok(resolveMinesweeperAction(state, { type: 'reveal', position: { row, col } })).state;
}

describe('minesweeper-engine', () => {
  it('同一 seed、难度和首点会生成相同雷区', () => {
    const first = generateMinesweeperMinePositions('mine-seed', 'normal', { row: 4, col: 4 });
    const second = generateMinesweeperMinePositions('mine-seed', 'normal', { row: 4, col: 4 });

    expect(second).toEqual(first);
  });

  it('首点和周围一圈不会是雷', () => {
    const firstClick = { row: 4, col: 4 };
    const state = reveal(createInitialMinesweeperState('first-safe', 'easy'), firstClick.row, firstClick.col);
    const safeKeys = new Set([
      '4:4',
      '3:3',
      '3:4',
      '3:5',
      '4:3',
      '4:5',
      '5:3',
      '5:4',
      '5:5',
    ]);

    for (const key of safeKeys) {
      const cell = state.cells.find((item) => positionKey(item) === key);
      expect(cell?.mine).toBe(false);
    }
  });

  it('插旗格不能被翻开', () => {
    let state = createInitialMinesweeperState('flag-check', 'easy');
    state = ok(resolveMinesweeperAction(state, { type: 'flag', position: { row: 0, col: 0 } })).state;

    const result = resolveMinesweeperAction(state, { type: 'reveal', position: { row: 0, col: 0 } });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('插旗');
  });

  it('踩到雷会失败并在视图中揭示雷', () => {
    let state = reveal(createInitialMinesweeperState('boom-check', 'easy'), 0, 0);
    const mine = state.cells.find((cell) => cell.mine);
    expect(mine).toBeTruthy();

    state = reveal(state, mine!.row, mine!.col);
    const view = buildMinesweeperStateView(state);

    expect(state.status).toBe('lost');
    expect(view.cells.some((cell) => cell.display === 'exploded')).toBe(true);
    expect(view.cells.filter((cell) => cell.display === 'mine' || cell.display === 'exploded').length).toBe(state.mines);
  });

  it('翻开所有安全格会胜利', () => {
    let state = reveal(createInitialMinesweeperState('win-check', 'easy'), 0, 0);
    for (const cell of [...state.cells]) {
      if (state.status !== 'playing') break;
      const latest = state.cells.find((item) => item.row === cell.row && item.col === cell.col)!;
      if (!latest.mine && !latest.revealed) {
        state = reveal(state, latest.row, latest.col);
      }
    }

    expect(state.status).toBe('won');
    expect(state.revealedSafe).toBe(state.rows * state.cols - state.mines);
  });

  it('快速展开要求周围旗帜数量等于数字', () => {
    const state = reveal(createInitialMinesweeperState('chord-check', 'easy'), 0, 0);
    const numberCell = state.cells.find((cell) => cell.revealed && cell.adjacent > 0);
    expect(numberCell).toBeTruthy();

    const result = resolveMinesweeperAction(state, {
      type: 'chord',
      position: { row: numberCell!.row, col: numberCell!.col },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('旗帜数量');
  });

  it('结算分数只来自服务端状态和耗时', () => {
    let state = reveal(createInitialMinesweeperState('score-check', 'normal'), 2, 2);
    const safe = state.cells.find((cell) => !cell.mine && !cell.revealed);
    expect(safe).toBeTruthy();
    state = reveal(state, safe!.row, safe!.col);

    const score = calculateMinesweeperScore(state, 45_000);

    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(5000);
  });

  it('福利积分按得分 1% 向下取整', () => {
    expect(calculateMinesweeperPointReward(1019)).toBe(10);
    expect(calculateMinesweeperPointReward(1379)).toBe(13);
    expect(calculateMinesweeperPointReward(5000)).toBe(50);
  });
});
