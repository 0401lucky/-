import { describe, expect, it } from 'vitest';
import {
  WHACK_MOLE_END_REFRESH_MS,
  WHACK_MOLE_GAME_DURATION_MS,
  WHACK_MOLE_MAX_BOMBS,
  WHACK_MOLE_START_REFRESH_MS,
  getWhackMoleBoard,
  getWhackMoleBombCount,
  calculateWhackMolePointReward,
  getWhackMoleRefreshMs,
  getWhackMoleScoreDelta,
  getWhackMoleTickIndex,
  scoreWhackMoleEvents,
} from '../whack-mole-engine';

describe('whack mole engine', () => {
  it('linearly speeds up from slow refresh to fast refresh', () => {
    expect(getWhackMoleRefreshMs(0)).toBe(WHACK_MOLE_START_REFRESH_MS);
    expect(getWhackMoleRefreshMs(WHACK_MOLE_GAME_DURATION_MS)).toBe(WHACK_MOLE_END_REFRESH_MS);
    expect(getWhackMoleRefreshMs(WHACK_MOLE_GAME_DURATION_MS / 2)).toBe(
      Math.round((WHACK_MOLE_START_REFRESH_MS + WHACK_MOLE_END_REFRESH_MS) / 2),
    );
  });

  it('linearly increases bomb count over the round', () => {
    expect(getWhackMoleBombCount(0)).toBe(0);
    expect(getWhackMoleBombCount(WHACK_MOLE_GAME_DURATION_MS * 0.24)).toBe(1);
    expect(getWhackMoleBombCount(WHACK_MOLE_GAME_DURATION_MS * 0.5)).toBe(2);
    expect(getWhackMoleBombCount(WHACK_MOLE_GAME_DURATION_MS * 0.76)).toBe(3);
    expect(getWhackMoleBombCount(WHACK_MOLE_GAME_DURATION_MS - 1)).toBe(WHACK_MOLE_MAX_BOMBS);
  });

  it('uses variable-length ticks as refresh speed changes', () => {
    const earlyTick = getWhackMoleTickIndex(5_000);
    const lateTick = getWhackMoleTickIndex(55_000) - getWhackMoleTickIndex(50_000);

    expect(earlyTick).toBeLessThan(lateTick + 5);
    expect(getWhackMoleTickIndex(55_000)).toBeGreaterThan(getWhackMoleTickIndex(30_000));
  });

  it('keeps board generation deterministic for the same seed and time', () => {
    const first = getWhackMoleBoard('seed-a', 24_000);
    const second = getWhackMoleBoard('seed-a', 24_000);

    expect(second).toEqual(first);
    expect(first.filter((cell) => cell === 'bomb')).toHaveLength(getWhackMoleBombCount(24_000));
  });

  it('applies combo bonus from the next combo count', () => {
    expect(getWhackMoleScoreDelta('mole', 0)).toBe(10);
    expect(getWhackMoleScoreDelta('mole', 1)).toBe(12);
    expect(getWhackMoleScoreDelta('golden', 2)).toBe(39);
  });

  it('dedupes the same target in the same tick', () => {
    const seed = 'dedupe-seed';
    const elapsedMs = 10_000;
    const board = getWhackMoleBoard(seed, elapsedMs);
    const target = board.findIndex((cell) => cell === 'mole' || cell === 'golden');

    expect(target).toBeGreaterThanOrEqual(0);

    const result = scoreWhackMoleEvents(seed, [
      { index: target, elapsedMs },
      { index: target, elapsedMs: elapsedMs + 1 },
    ]);

    expect(result.stats.hits).toBe(1);
    expect(result.events[1]?.result).toBe('duplicate');
    expect(result.combo).toBe(0);
  });

  it('converts score to reward at 10%', () => {
    expect(calculateWhackMolePointReward(0)).toBe(0);
    expect(calculateWhackMolePointReward(99)).toBe(9);
    expect(calculateWhackMolePointReward(860)).toBe(86);
  });
});
