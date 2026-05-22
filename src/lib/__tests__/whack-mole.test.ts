import { describe, expect, it } from 'vitest';
import {
  WHACK_MOLE_GAME_DURATION_MS,
  getWhackMoleBoard,
  getWhackMoleRefreshMs,
  getWhackMoleTickIndex,
  type WhackMoleHitEvent,
} from '../whack-mole-engine';
import { getDynamicGraceMs, resolveHitWithGrace } from '../whack-mole';

const TEST_SEED = 'whack-test-seed-alpha';

function findElapsedWithMoleAt(seed: string, candidateMs: number[]): {
  elapsedMs: number;
  index: number;
} {
  for (const candidate of candidateMs) {
    const board = getWhackMoleBoard(seed, candidate);
    const index = board.findIndex((cell) => cell === 'mole' || cell === 'golden');
    if (index >= 0) {
      return { elapsedMs: candidate, index };
    }
  }
  throw new Error('No mole found at any candidate elapsed time for the seed');
}

function canResolveHitAt(seed: string, index: number, elapsedMs: number): boolean {
  const graceMs = getDynamicGraceMs(elapsedMs);
  for (let offset = 0; offset <= graceMs; offset += 10) {
    const candidateElapsed = Math.max(0, elapsedMs - offset);
    const cell = getWhackMoleBoard(seed, candidateElapsed)[index];
    if (cell === 'mole' || cell === 'golden') {
      return true;
    }
  }
  return false;
}

function findMissElapsedOutsideGrace(seed: string, index: number, startMs: number): number {
  for (let elapsedMs = startMs; elapsedMs < WHACK_MOLE_GAME_DURATION_MS; elapsedMs += 50) {
    if (!canResolveHitAt(seed, index, elapsedMs)) {
      return elapsedMs;
    }
  }
  throw new Error('No miss elapsed found outside the dynamic grace window');
}

describe('getDynamicGraceMs', () => {
  it('shrinks the grace window as the round speeds up past the cap', () => {
    const beforeCap = getDynamicGraceMs(40_000);
    const afterCap = getDynamicGraceMs(50_000);
    const late = getDynamicGraceMs(WHACK_MOLE_GAME_DURATION_MS - 1);

    expect(beforeCap).toBeGreaterThanOrEqual(afterCap);
    expect(afterCap).toBeGreaterThan(late);
  });

  it('caps the grace window at 350ms even at very slow refresh rates', () => {
    expect(getDynamicGraceMs(0)).toBeLessThanOrEqual(350);
  });

  it('never returns less than one tracking step', () => {
    expect(getDynamicGraceMs(WHACK_MOLE_GAME_DURATION_MS - 1)).toBeGreaterThanOrEqual(20);
  });

  it('keeps late-game grace at or below 60% of the fast refresh period', () => {
    const lateElapsed = 55_000;
    const lateRefresh = getWhackMoleRefreshMs(lateElapsed);
    expect(getDynamicGraceMs(lateElapsed)).toBeLessThanOrEqual(Math.floor(lateRefresh * 0.6));
  });
});

describe('resolveHitWithGrace', () => {
  it('returns a hit when client elapsed lands directly on a mole tick', () => {
    const { elapsedMs, index } = findElapsedWithMoleAt(TEST_SEED, [4_000, 6_000, 8_000, 10_000]);

    const resolved = resolveHitWithGrace(TEST_SEED, [], index, elapsedMs + 30, elapsedMs);

    expect(resolved.lastEvent).toBeDefined();
    expect(resolved.lastEvent!.result === 'hit' || resolved.lastEvent!.result === 'golden_hit').toBe(true);
    expect(resolved.lastEvent!.scoreDelta).toBeGreaterThan(0);
  });

  it('recovers a hit when the click lands slightly after the mole tick (inside dynamic grace)', () => {
    const { elapsedMs, index } = findElapsedWithMoleAt(TEST_SEED, [4_000, 6_000, 8_000, 10_000]);
    const moleTick = getWhackMoleTickIndex(elapsedMs);
    let nextTickElapsed = elapsedMs + 1;
    while (getWhackMoleTickIndex(nextTickElapsed) === moleTick) {
      nextTickElapsed += 10;
    }

    const graceMs = getDynamicGraceMs(nextTickElapsed);
    const clientElapsed = nextTickElapsed + Math.min(60, Math.max(20, graceMs - 40));

    const resolved = resolveHitWithGrace(
      TEST_SEED,
      [],
      index,
      clientElapsed + 50,
      clientElapsed,
    );

    expect(resolved.lastEvent).toBeDefined();
    expect(resolved.lastEvent!.result === 'hit' || resolved.lastEvent!.result === 'golden_hit').toBe(true);
  });

  it('falls back to server elapsed when client elapsed is undefined and grace still reaches the mole', () => {
    const { elapsedMs, index } = findElapsedWithMoleAt(TEST_SEED, [4_000, 6_000, 8_000, 10_000]);

    const resolved = resolveHitWithGrace(TEST_SEED, [], index, elapsedMs + 60, undefined);

    expect(resolved.lastEvent).toBeDefined();
    expect(resolved.lastEvent!.result === 'hit' || resolved.lastEvent!.result === 'golden_hit').toBe(true);
  });

  it('returns miss when the lookback would have to cross more than the dynamic grace window', () => {
    const { elapsedMs, index } = findElapsedWithMoleAt(TEST_SEED, [4_000, 6_000, 8_000, 10_000]);
    const overshootMs = findMissElapsedOutsideGrace(
      TEST_SEED,
      index,
      elapsedMs + getDynamicGraceMs(elapsedMs) + 2_000,
    );

    const resolved = resolveHitWithGrace(TEST_SEED, [], index, overshootMs, overshootMs);
    expect(resolved.lastEvent).toBeDefined();
    expect(resolved.lastEvent!.result).toBe('miss');
  });

  it('marks the second click on the same target+tick as duplicate', () => {
    const { elapsedMs, index } = findElapsedWithMoleAt(TEST_SEED, [4_000, 6_000, 8_000, 10_000]);
    const firstEvent: WhackMoleHitEvent = { index, elapsedMs };

    const resolved = resolveHitWithGrace(
      TEST_SEED,
      [firstEvent],
      index,
      elapsedMs + 50,
      elapsedMs + 10,
    );

    expect(resolved.lastEvent).toBeDefined();
    expect(resolved.lastEvent!.result).toBe('duplicate');
    expect(resolved.lastEvent!.comboAfter).toBe(0);
  });
});
