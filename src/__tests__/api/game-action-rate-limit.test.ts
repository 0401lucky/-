import { describe, expect, it, vi } from 'vitest';

const { mockWithUserRateLimit } = vi.hoisted(() => ({
  mockWithUserRateLimit: vi.fn((action: string, handler: unknown) => handler),
}));

vi.mock('@/lib/rate-limit', () => ({
  withUserRateLimit: mockWithUserRateLimit,
}));

vi.mock('@/lib/minesweeper', () => ({
  stepMinesweeperGame: vi.fn(),
}));

vi.mock('@/lib/roguelite', () => ({
  stepRogueliteGame: vi.fn(),
}));

vi.mock('@/lib/memory', () => ({
  flipMemoryCard: vi.fn(),
}));

import '@/app/api/games/minesweeper/step/route';
import '@/app/api/games/roguelite/step/route';
import '@/app/api/games/memory/flip/route';

describe('game action route rate limit', () => {
  it('局内操作接口使用 game:action，避免耗尽结算限流桶', () => {
    const actions = mockWithUserRateLimit.mock.calls.map(([action]) => action);

    expect(actions).toEqual(['game:action', 'game:action', 'game:action']);
    expect(actions).not.toContain('game:submit');
  });
});
