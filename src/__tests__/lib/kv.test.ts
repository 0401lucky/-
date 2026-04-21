import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { addCodesToProject, reserveDirectClaim, tryUseExtraSpin } from '@/lib/kv';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    lpush: vi.fn(),
    rpop: vi.fn(),
    sadd: vi.fn(),
    srem: vi.fn(),
    incrby: vi.fn(),
    decrby: vi.fn(),
    lrange: vi.fn(),
    llen: vi.fn(),
    mget: vi.fn(),
    scard: vi.fn(),
    smembers: vi.fn(),
  },
}));

vi.mock('../../lib/economy-lock', () => ({
  withUserEconomyLock: vi.fn(async (_userId: number, handler: () => Promise<unknown>) => handler()),
  withKvLock: vi.fn(async (_lockKey: string, handler: () => Promise<unknown>) => handler()),
}));

describe('kv D1 migration tests', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvLpush = vi.mocked(kv.lpush);
  const mockKvSadd = vi.mocked(kv.sadd);
  const mockKvDecrby = vi.mocked(kv.decrby);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('addCodesToProject pushes codes via lpush and updates project codesCount', async () => {
    // lpush returns the new list length
    mockKvLpush.mockResolvedValue(12);
    // kv.get for the project object
    mockKvGet.mockResolvedValue({
      id: 'project-1',
      name: 'Test',
      codesCount: 9,
      claimedCount: 0,
      status: 'active',
    });
    mockKvSet.mockResolvedValue('OK');

    const added = await addCodesToProject('project-1', ['A', 'B', 'C']);

    expect(added).toBe(12);

    // Verify lpush was called with the codes
    expect(mockKvLpush).toHaveBeenCalledTimes(1);
    expect(mockKvLpush).toHaveBeenCalledWith('codes:available:project-1', 'A', 'B', 'C');

    // Verify project was fetched
    expect(mockKvGet).toHaveBeenCalledWith('projects:project-1');

    // Verify project codesCount was updated (9 + 3 = 12)
    expect(mockKvSet).toHaveBeenCalledWith('projects:project-1', expect.objectContaining({
      codesCount: 12,
    }));
  });

  it('addCodesToProject returns 0 for empty codes array without calling kv', async () => {
    const added = await addCodesToProject('project-1', []);

    expect(added).toBe(0);
    expect(mockKvLpush).not.toHaveBeenCalled();
    expect(mockKvGet).not.toHaveBeenCalled();
    expect(mockKvSet).not.toHaveBeenCalled();
  });

  it('reserveDirectClaim creates pending record and updates project', async () => {
    const directProject = {
      id: 'project-2',
      name: 'Direct Project',
      description: '',
      maxClaims: 100,
      claimedCount: 5,
      codesCount: 0,
      status: 'active',
      createdAt: Date.now(),
      createdBy: 'admin',
      rewardType: 'direct',
      directDollars: 1,
    };

    // First get: check existing claim (none)
    // Second get: fetch project
    mockKvGet
      .mockResolvedValueOnce(null)       // claimed:project-2:1001 — no existing claim
      .mockResolvedValueOnce(directProject); // projects:project-2

    mockKvSet.mockResolvedValue('OK');
    mockKvLpush.mockResolvedValue(1);
    mockKvSadd.mockResolvedValue(1);

    const result = await reserveDirectClaim('project-2', 1001, 'alice');

    expect(result.success).toBe(true);
    expect(result.record?.creditStatus).toBe('pending');
    expect(result.record?.directCredit).toBe(true);
    expect(result.record?.creditedDollars).toBe(1);
    expect(result.record?.userId).toBe(1001);
    expect(result.record?.username).toBe('alice');
    expect(result.record?.projectId).toBe('project-2');
    expect(result.record?.code).toBe('');

    // Verify claim check
    expect(mockKvGet).toHaveBeenCalledWith('claimed:project-2:1001');
    // Verify project fetch
    expect(mockKvGet).toHaveBeenCalledWith('projects:project-2');

    // Verify claim record was saved
    expect(mockKvSet).toHaveBeenCalledWith(
      'claimed:project-2:1001',
      expect.objectContaining({
        projectId: 'project-2',
        userId: 1001,
        username: 'alice',
        creditStatus: 'pending',
        directCredit: true,
        creditedDollars: 1,
      })
    );

    // Verify record was pushed to records list
    expect(mockKvLpush).toHaveBeenCalledWith(
      'records:project-2',
      expect.objectContaining({
        projectId: 'project-2',
        userId: 1001,
        creditStatus: 'pending',
      })
    );

    // Verify project was updated (claimedCount incremented)
    expect(mockKvSet).toHaveBeenCalledWith(
      'projects:project-2',
      expect.objectContaining({
        claimedCount: 6,
      })
    );

    // Verify user claimed set was updated
    expect(mockKvSadd).toHaveBeenCalledWith('claimed:user:1001', 'project-2');
  });

  it('reserveDirectClaim returns existing record if already claimed', async () => {
    const existingRecord = {
      id: 'claim_existing',
      projectId: 'project-2',
      userId: 1001,
      username: 'alice',
      code: '',
      claimedAt: Date.now(),
      directCredit: true,
      creditedDollars: 1,
      creditStatus: 'success',
    };

    mockKvGet.mockResolvedValueOnce(existingRecord);

    const result = await reserveDirectClaim('project-2', 1001, 'alice');

    expect(result.success).toBe(true);
    expect(result.message).toBe('你已经领取过了');
    expect(result.record).toEqual(existingRecord);

    // Should not write anything since claim already exists
    expect(mockKvSet).not.toHaveBeenCalled();
    expect(mockKvLpush).not.toHaveBeenCalled();
    expect(mockKvSadd).not.toHaveBeenCalled();
  });

  it('tryUseExtraSpin succeeds when balance > 0', async () => {
    // kv.get returns current spin count
    mockKvGet.mockResolvedValue(3);
    // kv.decrby returns remaining after decrement
    mockKvDecrby.mockResolvedValue(2);

    const result = await tryUseExtraSpin(2001);

    expect(result).toEqual({ success: true, remaining: 2 });

    // Verify get was called to check balance
    expect(mockKvGet).toHaveBeenCalledWith('user:extra_spins:2001');
    // Verify decrby was called to decrement
    expect(mockKvDecrby).toHaveBeenCalledWith('user:extra_spins:2001', 1);
  });

  it('tryUseExtraSpin fails when balance is 0', async () => {
    mockKvGet.mockResolvedValue(0);

    const result = await tryUseExtraSpin(2001);

    expect(result).toEqual({ success: false, remaining: 0 });

    // Should not call decrby since balance is already 0
    expect(mockKvGet).toHaveBeenCalledWith('user:extra_spins:2001');
    expect(mockKvDecrby).not.toHaveBeenCalled();
  });

  it('tryUseExtraSpin fails when balance is null (no key)', async () => {
    mockKvGet.mockResolvedValue(null);

    const result = await tryUseExtraSpin(2002);

    expect(result).toEqual({ success: false, remaining: 0 });

    expect(mockKvGet).toHaveBeenCalledWith('user:extra_spins:2002');
    expect(mockKvDecrby).not.toHaveBeenCalled();
  });

  it('tryUseExtraSpin clamps negative remaining to 0', async () => {
    // Current balance is 1, so decrement goes through
    mockKvGet.mockResolvedValue(1);
    // But decrby somehow returns a negative (edge case)
    mockKvDecrby.mockResolvedValue(-1);

    const result = await tryUseExtraSpin(2003);

    // 新实现会把异常的负数结果回滚，并按失败处理
    expect(result).toEqual({ success: false, remaining: 0 });
  });

  it('tryUseExtraSpin concurrent calls: read→check→write pattern', async () => {
    // Simulate two concurrent calls:
    // First call sees balance 1 and decrements
    // Second call sees balance 0 (after first decrement) and fails
    mockKvGet
      .mockResolvedValueOnce(1)   // first call: balance is 1
      .mockResolvedValueOnce(0);  // second call: balance is 0 after first consumed it
    mockKvDecrby.mockResolvedValueOnce(0); // first call: remaining after decrement

    const [first, second] = await Promise.all([
      tryUseExtraSpin(2001),
      tryUseExtraSpin(2001),
    ]);

    // At least one should succeed and one should fail
    // (in practice both see their own snapshot, so both get and decrby independently)
    expect(first).toEqual({ success: true, remaining: 0 });
    expect(second).toEqual({ success: false, remaining: 0 });

    expect(mockKvGet).toHaveBeenCalledTimes(2);
    expect(mockKvDecrby).toHaveBeenCalledTimes(1);
  });
});
