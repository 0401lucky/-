import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@vercel/kv';
import { addCodesToProject, reserveDirectClaim, tryUseExtraSpin } from '@/lib/kv';

vi.mock('@vercel/kv', () => ({
  kv: {
    eval: vi.fn(),
  },
}));

describe('kv atomicity fixes', () => {
  const mockKvEval = vi.mocked(kv.eval);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addCodesToProject updates list and codesCount atomically in one eval', async () => {
    mockKvEval.mockResolvedValue(12);

    const added = await addCodesToProject('project-1', ['A', 'B', 'C']);

    expect(added).toBe(12);
    expect(mockKvEval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = mockKvEval.mock.calls[0]!;

    expect(typeof script).toBe('string');
    expect(keys).toEqual(['projects:project-1', 'codes:available:project-1']);
    expect(args).toEqual([3, 'A', 'B', 'C']);
  });

  it('reserveDirectClaim writes pending record into records list in same eval', async () => {
    const pendingRecord = {
      id: 'claim_1',
      projectId: 'project-2',
      userId: 1001,
      username: 'alice',
      code: '',
      claimedAt: Date.now(),
      directCredit: true,
      creditedDollars: 1,
      creditStatus: 'pending',
    };

    mockKvEval.mockResolvedValue([1, JSON.stringify(pendingRecord), 'ok']);

    const result = await reserveDirectClaim('project-2', 1001, 'alice');

    expect(result.success).toBe(true);
    expect(result.record?.creditStatus).toBe('pending');

    const [script, keys] = mockKvEval.mock.calls[0]!;
    expect(typeof script).toBe('string');
    expect(script).toContain('LPUSH');
    expect(keys).toEqual([
      'projects:project-2',
      'claimed:project-2:1001',
      'records:project-2',
      'claimed:user:1001',
    ]);
  });

  it('tryUseExtraSpin simulates concurrent consume with single winner', async () => {
    mockKvEval
      .mockResolvedValueOnce([1, 0])
      .mockResolvedValueOnce([0, 0]);

    const [first, second] = await Promise.all([
      tryUseExtraSpin(2001),
      tryUseExtraSpin(2001),
    ]);

    expect(first).toEqual({ success: true, remaining: 0 });
    expect(second).toEqual({ success: false, remaining: 0 });
    expect(mockKvEval).toHaveBeenCalledTimes(2);
    expect(mockKvEval.mock.calls[0]?.[1]).toEqual(['user:extra_spins:2001']);
    expect(mockKvEval.mock.calls[1]?.[1]).toEqual(['user:extra_spins:2001']);
  });

  it('tryUseExtraSpin clamps negative remaining to avoid leaking invalid balance', async () => {
    mockKvEval.mockResolvedValue([0, -3]);

    const result = await tryUseExtraSpin(2002);

    expect(result).toEqual({ success: false, remaining: 0 });
    expect(mockKvEval).toHaveBeenCalledWith(expect.any(String), ['user:extra_spins:2002'], []);
  });
});
