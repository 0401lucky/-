import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SudokuPage from '@/app/games/sudoku/page';
import { fetchGameRequest } from '@/app/games/_lib/request';
import type { SudokuSessionView } from '@/lib/types/game';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

vi.mock('@/app/games/_lib/request', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/games/_lib/request')>(),
  fetchGameRequest: vi.fn(),
}));

function statusResponse(overrides = {}) {
  return Response.json({
    success: true,
    data: {
      balance: 0,
      dailyStats: { gamesPlayed: 0, pointsEarned: 0 },
      inCooldown: false,
      cooldownRemaining: 0,
      dailyLimit: 100,
      pointsLimitReached: false,
      records: [],
      difficulties: [],
      activeSession: null,
      ...overrides,
    },
  });
}

describe('数独冷却倒计时', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(fetchGameRequest).mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function button(label: string) {
    const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
    expect(found).toBeDefined();
    return found!;
  }

  it('选择页逐秒倒计时，到期后无需刷新即可选择难度并开始', async () => {
    vi.mocked(fetchGameRequest).mockResolvedValueOnce(statusResponse({ inCooldown: true, cooldownRemaining: 5 }));
    await act(async () => root.render(<SudokuPage />));
    expect(container.textContent).toContain('冷却中，还需等待 5 秒');
    expect(button('开始数独')).toBeDisabled();

    await act(async () => vi.advanceTimersByTime(2000));
    expect(container.textContent).toContain('冷却中，还需等待 3 秒');

    await act(async () => vi.advanceTimersByTime(3000));
    expect(container.querySelector('.sudoku-cooldown')).toBeNull();
    expect(button('开始数独')).toBeEnabled();
    for (const difficulty of container.querySelectorAll('.sudoku-difficulty-card')) {
      expect(difficulty).toBeEnabled();
    }
    expect(fetchGameRequest).toHaveBeenCalledTimes(1);
  });

  it.each(['focus', 'visibilitychange'])('后台计时器暂停后，%s 会立即校准冷却', async (event) => {
    vi.mocked(fetchGameRequest).mockResolvedValueOnce(statusResponse({ inCooldown: true, cooldownRemaining: 5 }));
    await act(async () => root.render(<SudokuPage />));
    expect(button('开始数独')).toBeDisabled();

    vi.setSystemTime(Date.now() + 30_000);
    await act(async () => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });
    expect(container.querySelector('.sudoku-cooldown')).toBeNull();
    expect(button('开始数独')).toBeEnabled();
  });

  it('放弃一局后，新返回的冷却会计时并自动解锁开始按钮', async () => {
    const session: SudokuSessionView = {
      sessionId: 'sudoku-test-session',
      difficulty: 'easy',
      startedAt: Date.now(),
      expiresAt: Date.now() + 900_000,
      state: {
        difficulty: 'easy',
        cells: Array.from({ length: 81 }, (_, index) => ({ index, value: 0, given: false })),
        status: 'playing',
        moves: 0,
        mistakes: 0,
      },
    };
    vi.mocked(fetchGameRequest)
      .mockResolvedValueOnce(statusResponse({ activeSession: session }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(statusResponse({ inCooldown: true, cooldownRemaining: 5 }));
    await act(async () => root.render(<SudokuPage />));
    await act(async () => vi.advanceTimersByTime(20_000));
    await act(async () => button('放弃').click());
    await act(async () => button('确认放弃').click());

    expect(container.textContent).toContain('冷却中，还需等待 5 秒');
    await act(async () => vi.advanceTimersByTime(5000));
    expect(button('开始数独')).toBeEnabled();
    expect(container.querySelector('.sudoku-cooldown')).toBeNull();
  });

  it('结算结果页停留超过冷却后，再来一局可以立即开始', async () => {
    const session: SudokuSessionView = {
      sessionId: 'completed-sudoku',
      difficulty: 'easy',
      startedAt: Date.now() - 60_000,
      expiresAt: Date.now() + 840_000,
      state: { difficulty: 'easy', cells: [], status: 'won', moves: 40, mistakes: 0, endedAt: Date.now() },
    };
    vi.mocked(fetchGameRequest)
      .mockResolvedValueOnce(statusResponse({ activeSession: session }))
      .mockResolvedValueOnce(Response.json({
        success: true,
        data: { record: { score: 800, pointsEarned: 8 }, pointsEarned: 8 },
      }))
      .mockResolvedValueOnce(statusResponse({ inCooldown: true, cooldownRemaining: 5 }));
    await act(async () => root.render(<SudokuPage />));
    expect(container.textContent).toContain('这一局完成得很好');

    await act(async () => vi.advanceTimersByTime(6000));
    await act(async () => button('再来一局').click());
    expect(button('开始数独')).toBeEnabled();
    expect(container.querySelector('.sudoku-cooldown')).toBeNull();
  });
});
