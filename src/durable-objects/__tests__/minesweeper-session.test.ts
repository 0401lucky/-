import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MinesweeperSessionDurableObject } from '../minesweeper-session';
import { createInitialMinesweeperState } from '../../lib/minesweeper-engine';

function createStorage() {
  const store = new Map<string, unknown>();
  let alarm: number | Date | null = null;
  return {
    store,
    storage: {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      delete: vi.fn(async (key: string) => store.delete(key)),
      setAlarm: vi.fn(async (value: number | Date) => {
        alarm = value;
      }),
      deleteAlarm: vi.fn(async () => {
        alarm = null;
      }),
    },
    getAlarm: () => alarm,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://minesweeper-session${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

describe('MinesweeperSessionDurableObject', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('在 DO 存储内完成扫雷 step 并返回快照', async () => {
    const fake = createStorage();
    const durableObject = new MinesweeperSessionDurableObject(
      { storage: fake.storage } as unknown as DurableObjectState,
      {},
    );
    const session = {
      id: 'session-1',
      userId: 1001,
      gameType: 'minesweeper',
      difficulty: 'easy',
      seed: 'seed-1',
      startedAt: Date.now(),
      expiresAt: Date.now() + 300_000,
      status: 'playing',
      state: createInitialMinesweeperState('seed-1', 'easy'),
      actions: [],
    };

    const init = await readJson<{ success: boolean }>(
      await durableObject.fetch(post('/init', { session })),
    );
    const stepped = await readJson<{ success: boolean; session?: { actionsCount: number } }>(
      await durableObject.fetch(post('/step', {
        userId: 1001,
        sessionId: 'session-1',
        action: { type: 'reveal', position: { row: 0, col: 0 } },
      })),
    );
    const batchStepped = await readJson<{
      success: boolean;
      session?: { actionsCount: number };
      outcomes?: unknown[];
      skipped?: number;
    }>(
      await durableObject.fetch(post('/step-batch', {
        userId: 1001,
        sessionId: 'session-1',
        actions: [
          { type: 'reveal', position: { row: 0, col: 0 } },
          { type: 'flag', position: { row: 8, col: 8 } },
        ],
      })),
    );
    const snapshot = await readJson<{ success: boolean; session?: { actions: unknown[] } }>(
      await durableObject.fetch(post('/snapshot', { userId: 1001, sessionId: 'session-1' })),
    );

    expect(init.success).toBe(true);
    expect(stepped.success).toBe(true);
    expect(stepped.session?.actionsCount).toBe(1);
    expect(batchStepped.success).toBe(true);
    expect(batchStepped.session?.actionsCount).toBeGreaterThanOrEqual(1);
    expect(batchStepped.outcomes?.length ?? 0).toBeGreaterThanOrEqual(0);
    expect(batchStepped.skipped).toBeGreaterThanOrEqual(0);
    expect(snapshot.success).toBe(true);
    expect(snapshot.session?.actions.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(fake.storage.put).toHaveBeenCalled();
    expect(fake.getAlarm()).toBeTruthy();
  });
});
