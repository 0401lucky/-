import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { buyEcoItem, claimEcoPrize, collectEcoTrash, getEcoStatus, getEcoTrashLeaderboard, runEcoTheftInvestigations, sellEcoPrize, stealEcoPublicPrize } from '../eco';
import { createInitialEcoState, getStorageCap } from '../eco-engine';
import { getAllUsers } from '../kv';
import { getCustomUserProfile, getPublicSessionUserProfile } from '../user-profile';
import { forceEquipAchievement, getEquippedAchievementForUser, grantUserAchievement } from '../user-achievements';
import { acquireGameLock, releaseGameLock } from '../game-locks';
import { isNativeHotStoreReady } from '../hot-d1';
import { addPoints, applyPointsDelta, deductPoints, getUserPoints } from '../points';
import type { EcoPublicPrizeEntry, EcoState } from '../types/eco';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    get: vi.fn(),
    set: vi.fn(),
    hgetall: vi.fn(),
    hincrby: vi.fn(),
    zrange: vi.fn(),
    zcard: vi.fn(),
    zincrby: vi.fn(),
    expire: vi.fn(),
  },
}));

vi.mock('../kv', () => ({
  getAllUsers: vi.fn(),
}));

vi.mock('../user-profile', () => ({
  getCustomUserProfile: vi.fn(),
  getPublicSessionUserProfile: vi.fn(),
  updatePublicSessionUserProfile: vi.fn(),
}));

vi.mock('../user-achievements', () => ({
  forceEquipAchievement: vi.fn(),
  getEquippedAchievementForUser: vi.fn(),
  grantUserAchievement: vi.fn(),
}));

vi.mock('../points', () => ({
  addPoints: vi.fn(),
  applyPointsDelta: vi.fn(),
  deductPoints: vi.fn(),
  getUserPoints: vi.fn(),
}));

vi.mock('../game-locks', () => ({
  acquireGameLock: vi.fn(),
  releaseGameLock: vi.fn(),
}));

vi.mock('../hot-d1', () => ({
  isNativeHotStoreReady: vi.fn(),
}));

describe('eco service', () => {
  const mockKvGet = vi.mocked(kv.get);
  const mockKvSet = vi.mocked(kv.set);
  const mockKvHgetall = vi.mocked(kv.hgetall);
  const mockKvHincrby = vi.mocked(kv.hincrby);
  const mockKvZrange = vi.mocked(kv.zrange);
  const mockKvZcard = vi.mocked(kv.zcard);
  const mockKvZincrby = vi.mocked(kv.zincrby);
  const mockKvExpire = vi.mocked(kv.expire);
  const mockGetAllUsers = vi.mocked(getAllUsers);
  const mockGetCustomUserProfile = vi.mocked(getCustomUserProfile);
  const mockGetPublicSessionUserProfile = vi.mocked(getPublicSessionUserProfile);
  const mockForceEquipAchievement = vi.mocked(forceEquipAchievement);
  const mockGetEquippedAchievementForUser = vi.mocked(getEquippedAchievementForUser);
  const mockGrantUserAchievement = vi.mocked(grantUserAchievement);
  const mockAcquireGameLock = vi.mocked(acquireGameLock);
  const mockReleaseGameLock = vi.mocked(releaseGameLock);
  const mockIsNativeHotStoreReady = vi.mocked(isNativeHotStoreReady);
  const mockAddPoints = vi.mocked(addPoints);
  const mockApplyPointsDelta = vi.mocked(applyPointsDelta);
  const mockDeductPoints = vi.mocked(deductPoints);
  const mockGetUserPoints = vi.mocked(getUserPoints);

  function mockGlobalPrizeStock(initial: Partial<Record<string, number>>): Record<string, number> {
    const stock: Record<string, number> = {};
    for (const [key, value] of Object.entries(initial)) {
      if (typeof value === 'number') stock[key] = value;
    }
    mockKvHgetall.mockImplementation(async (key: string) => (
      key === 'eco:global-prize-stock' ? { ...stock } : {}
    ));
    mockKvHincrby.mockImplementation(async (key: string, field: string, increment: number) => {
      if (key !== 'eco:global-prize-stock') return increment;
      stock[field] = (stock[field] ?? 0) + increment;
      return stock[field];
    });
    return stock;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockKvGet.mockResolvedValue(null);
    mockKvSet.mockResolvedValue('OK');
    mockKvHgetall.mockResolvedValue({});
    mockKvHincrby.mockResolvedValue(1);
    mockKvZcard.mockResolvedValue(3);
    mockKvZincrby.mockResolvedValue(1);
    mockKvExpire.mockResolvedValue(1);
    mockGetAllUsers.mockResolvedValue([
      { id: 1001, username: 'alice', firstSeen: 1 },
      { id: 1002, username: 'bob', firstSeen: 1 },
      { id: 1003, username: 'cindy', firstSeen: 1 },
    ]);
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetEquippedAchievementForUser.mockResolvedValue(null);
    mockAcquireGameLock.mockResolvedValue('token');
    mockReleaseGameLock.mockResolvedValue(undefined);
    mockIsNativeHotStoreReady.mockResolvedValue(false);
    mockAddPoints.mockResolvedValue({ success: true, balance: 1000 });
    mockApplyPointsDelta.mockResolvedValue({ success: true, balance: 900 });
    mockDeductPoints.mockResolvedValue({ success: true, balance: 965 });
    mockGetUserPoints.mockResolvedValue(965);
    mockGrantUserAchievement.mockResolvedValue({
      id: 'thief',
      source: 'auto',
      grantedAt: Date.now(),
      expiresAt: null,
    });
    mockForceEquipAchievement.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds eco trash leaderboard and resolves ties by user id', async () => {
    mockKvZrange.mockResolvedValue(['u:1002', 7, 'u:1001', 7, 'u:1003', 3]);
    mockGetCustomUserProfile.mockImplementation(async (userId: number) => (
      userId === 1001 ? { displayName: 'Alice Eco', avatarUrl: 'avatar.png' } : {}
    ));

    const result = await getEcoTrashLeaderboard('daily', 10);

    expect(mockKvZrange).toHaveBeenCalledWith(
      expect.any(String),
      0,
      -1,
      { rev: true, withScores: true },
    );
    expect(result.totalParticipants).toBe(3);
    expect(result.leaderboard.map((entry) => entry.userId)).toEqual([1001, 1002, 1003]);
    expect(result.leaderboard[0]).toMatchObject({
      rank: 1,
      username: 'alice',
      displayName: 'Alice Eco',
      avatarUrl: 'avatar.png',
      trashCleared: 7,
    });
  });

  it('keeps clear truck trash within storage capacity including visible prize slots', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    const cap = getStorageCap(state);
    state.points = 1000;
    state.pending = cap - 1;
    state.visiblePrizes = [
      { id: 'coin-prize', key: 'coin', createdAt: now },
      { id: 'photo-prize', key: 'photo', createdAt: now },
    ];
    mockKvGet.mockResolvedValue(state);

    const result = await buyEcoItem(1001, 'clear_truck');

    expect(result.ok).toBe(true);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.pending).toBe(cap - saved.visiblePrizes.length);
    expect(saved.pending + saved.visiblePrizes.length).toBeLessThanOrEqual(cap);
  });

  it('refunds item cost when eco state save fails after points deduction', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.points = 1000;
    mockKvGet.mockResolvedValue(state);
    mockKvSet.mockRejectedValueOnce(new Error('KV_WRITE_FAILED'));

    await expect(buyEcoItem(1001, 'recycle_glove')).rejects.toThrow('KV_WRITE_FAILED');

    expect(mockDeductPoints).toHaveBeenCalledWith(
      1001,
      25,
      'exchange',
      '环保行动道具·回收手套',
    );
    expect(mockAddPoints).toHaveBeenCalledWith(
      1001,
      25,
      'exchange_refund',
      '环保行动道具·回收手套回滚',
    );
  });

  it('tracks today trash points from normal trash using China date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:50:00.000Z'));

    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.pending = 10;
    state.lastTickAt = now;
    mockKvGet.mockResolvedValue(state);
    mockAddPoints.mockResolvedValue({ success: true, balance: 966 });
    mockGetUserPoints.mockResolvedValue(966);

    const result = await collectEcoTrash(1001, 10);

    expect(result.ok).toBe(true);
    expect(result.pointsEarned).toBe(1);
    expect(result.data?.todayTrashPoints).toBe(1);
    expect(result.data?.todayTrashPointsDate).toBe('2026-06-10');

    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.dailyTrashPoints).toEqual({ date: '2026-06-10', points: 1 });
  });

  it('does not count prize sale points as today trash points', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:55:00.000Z'));

    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.inventory.coin = 1;
    state.dailyTrashPoints = { date: '2026-06-10', points: 4 };
    mockKvGet.mockResolvedValue(state);
    mockAddPoints.mockResolvedValue({ success: true, balance: 2000 });
    mockGetUserPoints.mockResolvedValue(2000);

    const result = await sellEcoPrize(1001, 'coin', 1);

    expect(result.ok).toBe(true);
    expect(result.pointsEarned).toBeGreaterThan(0);
    expect(result.data?.todayTrashPoints).toBe(4);
    expect(result.data?.todayTrashPointsDate).toBe('2026-06-10');

    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.dailyTrashPoints).toEqual({ date: '2026-06-10', points: 4 });
  });

  it('includes previous-day global claim counts on each seven-day price point', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));

    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    mockKvGet.mockResolvedValue(state);
    mockKvHgetall.mockImplementation(async (key: string) => {
      if (key === 'eco:prize-claims:2026-06-09') {
        return { coin: 3, total: 7 };
      }
      return {};
    });

    const status = await getEcoStatus(1001);
    const coin = status.prizes.find((prize) => prize.key === 'coin');
    const todayPoint = coin?.priceHistory.find((point) => point.date === '2026-06-10');

    expect(todayPoint).toMatchObject({
      date: '2026-06-10',
      previousDayClaimCount: 3,
      previousDayTotalClaims: 7,
    });
  });

  it('does not release global stock when selling legacy prize inventory', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.inventory.coin = 1;
    state.limitedPrizeInventory.coin = 0;
    mockKvGet.mockResolvedValue(state);
    mockGlobalPrizeStock({ coin: 8 });

    const result = await sellEcoPrize(1001, 'coin', 1);

    expect(result.ok).toBe(true);
    expect(mockKvHincrby).not.toHaveBeenCalledWith('eco:global-prize-stock', 'coin', -1);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.inventory.coin).toBe(0);
    expect(saved.limitedPrizeInventory.coin).toBe(0);
  });

  it('releases global stock only for limited prize inventory when selling', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.inventory.coin = 2;
    state.limitedPrizeInventory.coin = 1;
    state.prizeLots = [{
      id: 'limited-coin-lot',
      key: 'coin',
      acquiredAt: now - 1_000,
      availableAt: now - 1,
      limited: true,
      source: 'claim',
    }];
    mockKvGet.mockResolvedValue(state);
    const stock = mockGlobalPrizeStock({ coin: 8 });

    const result = await sellEcoPrize(1001, 'coin', 2);

    expect(result.ok).toBe(true);
    expect(mockKvHincrby).toHaveBeenCalledWith('eco:global-prize-stock', 'coin', -1);
    expect(stock.coin).toBe(7);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.inventory.coin).toBe(0);
    expect(saved.limitedPrizeInventory.coin).toBe(0);
  });

  it('allows public prizes to be sold normally after unlock and removes public board entry', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.inventory.coin = 1;
    state.limitedPrizeInventory.coin = 1;
    state.prizeLots = [{
      id: 'public-coin-lot',
      key: 'coin',
      acquiredAt: now - 24 * 60 * 60 * 1000,
      availableAt: now - 1,
      limited: true,
      source: 'claim',
      publicEntryId: 'public-coin-entry',
      publiclyListedAt: now - 24 * 60 * 60 * 1000,
      merchantAvailableAt: now - 1,
    }];
    let publicEntries = [{
      id: 'public-coin-entry',
      key: 'coin' as const,
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'public-coin-lot',
      publicAt: now - 24 * 60 * 60 * 1000,
      merchantAvailableAt: now - 1,
      status: 'listed' as const,
    }];
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1001') return state;
      if (key === 'eco:public-prizes') return publicEntries;
      return null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') publicEntries = value as typeof publicEntries;
      return 'OK';
    });
    const stock = mockGlobalPrizeStock({ coin: 1 });

    const result = await sellEcoPrize(1001, 'coin', 1);

    expect(result.ok).toBe(true);
    expect(publicEntries).toEqual([]);
    expect(stock.coin).toBe(0);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.inventory.coin).toBe(0);
    expect(saved.prizeLots).toEqual([]);
  });

  it('does not allow stolen prizes to be sold through normal sale', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.inventory.coin = 1;
    state.limitedPrizeInventory.coin = 1;
    state.prizeLots = [{
      id: 'stolen-coin-lot',
      key: 'coin',
      acquiredAt: now - 25 * 60 * 60 * 1000,
      availableAt: now - 1,
      limited: true,
      source: 'stolen',
      stolenFromUserId: 1002,
      stolenAt: now - 25 * 60 * 60 * 1000,
      theftId: 'theft-1',
      blackMarketAvailableAt: now - 1,
    }];
    mockKvGet.mockResolvedValue(state);

    const result = await sellEcoPrize(1001, 'coin', 1);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('该奖品需要等到次日早上 6 点后才能出售');
    expect(mockAddPoints).not.toHaveBeenCalled();
  });

  it('uses current profile avatar for public board instead of old public snapshot', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    const publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-coin-entry',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerAvatarUrl: 'https://example.com/old.png',
      ownerLotId: 'public-coin-lot',
      publicAt: now - 1_000,
      merchantAvailableAt: now + 60_000,
      status: 'listed',
    }];
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1001') return state;
      if (key === 'eco:public-prizes') return publicEntries;
      return null;
    });
    mockGetCustomUserProfile.mockResolvedValue({
      displayName: 'Alice Eco',
      avatarUrl: 'https://example.com/current.png',
    });

    const status = await getEcoStatus(1001);

    expect(status.publicBoard.entries[0]).toMatchObject({
      ownerName: 'Alice Eco',
      ownerAvatarUrl: 'https://example.com/current.png',
    });
  });

  it('falls back to current username for public board default avatar initial', async () => {
    const now = Date.now();
    const viewerState = createInitialEcoState(1002, now);
    const publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-photo-entry',
      key: 'photo',
      ownerUserId: 1004,
      ownerName: '#1004',
      ownerAvatarUrl: null,
      ownerLotId: 'public-photo-lot',
      publicAt: now - 1_000,
      merchantAvailableAt: now + 60_000,
      status: 'listed',
    }];
    mockGetAllUsers.mockResolvedValue([
      { id: 1002, username: 'viewer', firstSeen: 1 },
      { id: 1004, username: 'R', firstSeen: 1 },
    ]);
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1002') return viewerState;
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return [];
      return null;
    });
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetPublicSessionUserProfile.mockResolvedValue({});

    const status = await getEcoStatus(1002);

    expect(status.publicBoard.entries[0]).toMatchObject({
      ownerName: 'R',
      ownerUsername: 'R',
      ownerDisplayName: null,
      ownerAvatarUrl: null,
      canSteal: true,
      stealDisabledReason: null,
    });
  });

  it('falls back to direct user record when public board user index is incomplete', async () => {
    const now = Date.now();
    const viewerState = createInitialEcoState(1002, now);
    const publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-photo-entry',
      key: 'photo',
      ownerUserId: 1004,
      ownerName: '#1004',
      ownerAvatarUrl: null,
      ownerLotId: 'public-photo-lot',
      publicAt: now - 1_000,
      merchantAvailableAt: now + 60_000,
      status: 'listed',
    }];
    mockGetAllUsers.mockResolvedValue([]);
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1002') return viewerState;
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return [];
      if (key === 'user:1004') return { id: 1004, username: 'R', firstSeen: 1 };
      return null;
    });
    mockGetCustomUserProfile.mockResolvedValue({});

    const status = await getEcoStatus(1002);

    expect(status.publicBoard.entries[0]).toMatchObject({
      ownerName: 'R',
      ownerUsername: 'R',
      ownerDisplayName: null,
      ownerAvatarUrl: null,
    });
  });

  it('uses public session display name for public board default avatar initial', async () => {
    const now = Date.now();
    const viewerState = createInitialEcoState(1002, now);
    const publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-photo-entry',
      key: 'photo',
      ownerUserId: 1004,
      ownerName: '#1004',
      ownerAvatarUrl: null,
      ownerLotId: 'public-photo-lot',
      publicAt: now - 1_000,
      merchantAvailableAt: now + 60_000,
      status: 'listed',
    }];
    mockGetAllUsers.mockResolvedValue([]);
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1002') return viewerState;
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return [];
      return null;
    });
    mockGetCustomUserProfile.mockResolvedValue({});
    mockGetPublicSessionUserProfile.mockImplementation(async (userId: number) => (
      userId === 1004 ? { username: 'fallback', displayName: 'R' } : {}
    ));

    const status = await getEcoStatus(1002);

    expect(status.publicBoard.entries[0]).toMatchObject({
      ownerName: 'R',
      ownerUsername: 'fallback',
      ownerDisplayName: null,
      ownerAvatarUrl: null,
    });
  });

  it('marks public board steal button disabled when viewer has unresolved theft', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const now = Date.now();
    const viewerState = createInitialEcoState(1002, now);
    const publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-coin-entry',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'public-coin-lot',
      publicAt: now - 1_000,
      merchantAvailableAt: now + 60_000,
      status: 'listed',
    }];
    const thefts = [{
      id: 'active-theft',
      key: 'diamond',
      originalUserId: 1003,
      thiefUserId: 1002,
      publicEntryId: 'public-active',
      originalLotId: 'owner-lot-active',
      thiefLotId: 'thief-lot-active',
      stolenAt: now - 25 * 60 * 60 * 1000,
      nextCheckAt: now - 1,
      blackMarketAvailableAt: now - 60_000,
      message: '还没处理',
    }];
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:state:1002') return viewerState;
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return thefts;
      return null;
    });

    const status = await getEcoStatus(1002);

    expect(status.publicBoard.entries[0]).toMatchObject({
      canSteal: false,
      stealDisabledReason: '已有偷盗',
    });
  });

  it('blocks stealing another public prize when a theft becomes active during reservation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const now = Date.now();
    const ownerState = createInitialEcoState(1001, now);
    const thiefState = createInitialEcoState(1002, now);
    ownerState.inventory.coin = 1;
    ownerState.limitedPrizeInventory.coin = 1;
    ownerState.prizeLots = [{
      id: 'owner-lot-1',
      key: 'coin',
      acquiredAt: now - 60_000,
      availableAt: now + 24 * 60 * 60 * 1000,
      limited: true,
      source: 'claim',
      publicEntryId: 'public-1',
      publiclyListedAt: now - 60_000,
      merchantAvailableAt: now + 24 * 60 * 60 * 1000,
    }];
    const states = new Map<string, EcoState>([
      ['eco:state:1001', ownerState],
      ['eco:state:1002', thiefState],
    ]);
    let publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      publicAt: now - 60_000,
      merchantAvailableAt: now + 24 * 60 * 60 * 1000,
      status: 'listed',
    }];
    const activeTheft = {
      id: 'active-theft',
      key: 'diamond',
      originalUserId: 1003,
      thiefUserId: 1002,
      publicEntryId: 'public-active',
      originalLotId: 'owner-lot-active',
      thiefLotId: 'thief-lot-active',
      stolenAt: now - 60_000,
      nextCheckAt: now + 60_000,
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
      message: '先偷的',
    };
    let theftReads = 0;
    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') {
        theftReads += 1;
        return theftReads === 1 ? [] : [activeTheft];
      }
      return states.get(key) ?? null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') publicEntries = value as EcoPublicPrizeEntry[];
      else if (key.startsWith('eco:state:')) states.set(key, value as EcoState);
      return 'OK';
    });

    const result = await stealEcoPublicPrize(1002, 'public-1', '再偷一个');

    expect(result.ok).toBe(false);
    expect(result.message).toBe('你还有正在被警察追查的奖品，逃脱或被抓后才能继续偷盗');
    expect(publicEntries[0]).toMatchObject({ status: 'listed' });
    expect(states.get('eco:state:1001')?.inventory.coin).toBe(1);
    expect(states.get('eco:state:1002')?.inventory.coin).toBe(0);
  });

  it('blocks stealing public prizes during police protection', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const now = Date.now();
    let publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      publicAt: now - 60_000,
      merchantAvailableAt: now,
      status: 'listed',
      stealProtectedUntil: now + 24 * 60 * 60 * 1000,
      theftCaughtCount: 1,
    }];
    let thefts: unknown[] = [];

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return thefts;
      return null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') publicEntries = value as EcoPublicPrizeEntry[];
      if (key === 'eco:thefts') thefts = value as unknown[];
      return 'OK';
    });

    const result = await stealEcoPublicPrize(1002, 'public-1', '拿走了');

    expect(result.ok).toBe(false);
    expect(result.message).toBe('这个奖品还在保护期内');
    expect(publicEntries[0]).toMatchObject({
      status: 'listed',
      stealProtectedUntil: now + 24 * 60 * 60 * 1000,
      theftCaughtCount: 1,
    });
    expect(thefts).toEqual([]);
  });

  it('records previous police restore count when stealing protected-history prizes again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const now = Date.now();
    const ownerState = createInitialEcoState(1001, now);
    const thiefState = createInitialEcoState(1002, now);
    ownerState.inventory.coin = 1;
    ownerState.limitedPrizeInventory.coin = 1;
    ownerState.prizeLots = [{
      id: 'owner-lot-1',
      key: 'coin',
      acquiredAt: now - 60_000,
      availableAt: now,
      limited: true,
      source: 'restored',
      publicEntryId: 'public-1',
      publiclyListedAt: now - 60_000,
      merchantAvailableAt: now,
    }];
    const states = new Map<string, EcoState>([
      ['eco:state:1001', ownerState],
      ['eco:state:1002', thiefState],
    ]);
    let publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      publicAt: now - 60_000,
      merchantAvailableAt: now,
      status: 'listed',
      stealProtectedUntil: now - 1,
      theftCaughtCount: 1,
    }];
    let thefts: unknown[] = [];

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return thefts;
      return states.get(key) ?? null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') publicEntries = value as EcoPublicPrizeEntry[];
      else if (key === 'eco:thefts') thefts = value as unknown[];
      else if (key.startsWith('eco:state:')) states.set(key, value as EcoState);
      return 'OK';
    });

    const result = await stealEcoPublicPrize(1002, 'public-1', '再次拿走');

    expect(result.ok).toBe(true);
    expect(publicEntries[0]).toMatchObject({
      status: 'stolen',
      stealProtectedUntil: null,
      theftCaughtCount: 1,
    });
    expect(thefts[0]).toMatchObject({
      publicEntryId: 'public-1',
      caughtCountBeforeTheft: 1,
      nextCheckAt: now + 20 * 60 * 1000,
    });
  });

  it('restores both user states when stealing fails after one side is saved', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const now = Date.now();
    const ownerState = createInitialEcoState(1001, now);
    const thiefState = createInitialEcoState(1002, now);
    ownerState.inventory.coin = 1;
    ownerState.limitedPrizeInventory.coin = 1;
    ownerState.prizeLots = [{
      id: 'owner-lot-1',
      key: 'coin',
      acquiredAt: now - 60_000,
      availableAt: now + 24 * 60 * 60 * 1000,
      limited: true,
      source: 'claim',
      publicEntryId: 'public-1',
      publiclyListedAt: now - 60_000,
      merchantAvailableAt: now + 24 * 60 * 60 * 1000,
    }];
    const states = new Map<string, EcoState>([
      ['eco:state:1001', ownerState],
      ['eco:state:1002', thiefState],
    ]);
    let publicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      publicAt: now - 60_000,
      merchantAvailableAt: now + 24 * 60 * 60 * 1000,
      status: 'listed',
    }];
    let thefts: unknown[] = [];
    let failThiefSave = true;

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:public-prizes') return publicEntries;
      if (key === 'eco:thefts') return thefts;
      return states.get(key) ?? null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') {
        publicEntries = value as EcoPublicPrizeEntry[];
        return 'OK';
      }
      if (key === 'eco:thefts') {
        thefts = value as unknown[];
        return 'OK';
      }
      if (key === 'eco:state:1002' && failThiefSave) {
        failThiefSave = false;
        throw new Error('thief state save failed');
      }
      if (key.startsWith('eco:state:')) {
        states.set(key, value as EcoState);
      }
      return 'OK';
    });

    await expect(stealEcoPublicPrize(1002, 'public-1', '拿走了'))
      .rejects.toThrow('thief state save failed');

    expect(publicEntries[0]).toMatchObject({ status: 'listed' });
    expect(publicEntries[0]?.thiefUserId).toBeUndefined();
    expect(thefts).toEqual([]);
    expect(states.get('eco:state:1001')?.inventory.coin).toBe(1);
    expect(states.get('eco:state:1001')?.prizeLots).toHaveLength(1);
    expect(states.get('eco:state:1002')?.inventory.coin).toBe(0);
    expect(states.get('eco:state:1002')?.prizeLots).toHaveLength(0);
  });

  it('moves claimed limited visible prizes into limited inventory without reserving twice', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.visiblePrizes = [{ id: 'coin-prize', key: 'coin', createdAt: now, limited: true }];
    mockKvGet.mockResolvedValue(state);
    mockGlobalPrizeStock({ coin: 1 });

    const result = await claimEcoPrize(1001, 'coin-prize');

    expect(result.ok).toBe(true);
    expect(mockKvHincrby).not.toHaveBeenCalledWith('eco:global-prize-stock', 'coin', 1);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.inventory.coin).toBe(1);
    expect(saved.limitedPrizeInventory.coin).toBe(1);
    expect(saved.visiblePrizes).toEqual([]);
  });

  it('rolls back public board entry when public prize claim state save fails', async () => {
    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.visiblePrizes = [{ id: 'coin-prize', key: 'coin', createdAt: now }];
    let publicEntries: EcoPublicPrizeEntry[] = [];
    const publicWrites: EcoPublicPrizeEntry[][] = [];

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:public-prizes') return publicEntries;
      return state;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:public-prizes') {
        publicEntries = value as EcoPublicPrizeEntry[];
        publicWrites.push(publicEntries.map((entry) => ({ ...entry })));
        return 'OK';
      }
      if (key === 'eco:state:1001') {
        throw new Error('state save failed');
      }
      return 'OK';
    });

    await expect(claimEcoPrize(1001, 'coin-prize', { makePublic: true }))
      .rejects.toThrow('state save failed');

    expect(publicWrites.map((entries) => entries.length)).toEqual([1, 0]);
    expect(publicEntries).toEqual([]);
  });

  it('does not spawn a prize whose global stock has reached the limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:58:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.900455);

    const now = Date.now();
    const state = createInitialEcoState(1001, now - 6_000);
    mockKvGet.mockResolvedValue(state);
    mockGlobalPrizeStock({ photo: 10 });

    const status = await getEcoStatus(1001, { allowOnlinePrizes: true });

    randomSpy.mockRestore();
    expect(status.visiblePrizes).toEqual([]);
    expect(status.pending).toBe(1);
    expect(mockKvHincrby).not.toHaveBeenCalledWith('eco:global-prize-stock', 'photo', 1);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.visiblePrizes).toEqual([]);
    expect(saved.pending).toBe(1);
  });

  it('reserves global stock when a limited prize is spawned', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T15:59:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.00005);

    const now = Date.now();
    const state = createInitialEcoState(1001, now - 6_000);
    mockKvGet.mockResolvedValue(state);
    const stock = mockGlobalPrizeStock({ coin: 0 });

    const status = await getEcoStatus(1001, { allowOnlinePrizes: true });

    randomSpy.mockRestore();
    expect(status.visiblePrizes).toHaveLength(1);
    expect(status.visiblePrizes[0]?.key).toBe('coin');
    expect(mockKvHincrby).toHaveBeenCalledWith('eco:global-prize-stock', 'coin', 1);
    expect(stock.coin).toBe(1);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.visiblePrizes[0]).toMatchObject({ key: 'coin', limited: true });
  });

  it('releases global stock when an unclaimed limited visible prize expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T16:01:00.000Z'));

    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.visiblePrizes = [
      { id: 'expired-diamond', key: 'diamond', createdAt: now - 10 * 60 * 1000 - 1, limited: true },
    ];
    mockKvGet.mockResolvedValue(state);
    const stock = mockGlobalPrizeStock({ diamond: 1 });

    const status = await getEcoStatus(1001);

    expect(status.visiblePrizes).toEqual([]);
    expect(mockKvHincrby).toHaveBeenCalledWith('eco:global-prize-stock', 'diamond', -1);
    expect(stock.diamond).toBe(0);
    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.visiblePrizes).toEqual([]);
  });

  it('resets today trash points after China midnight', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T16:00:01.000Z'));

    const now = Date.now();
    const state = createInitialEcoState(1001, now);
    state.dailyTrashPoints = { date: '2026-06-10', points: 9 };
    state.lastTickAt = now;
    mockKvGet.mockResolvedValue(state);

    const status = await getEcoStatus(1001);

    expect(status.todayTrashPoints).toBe(0);
    expect(status.todayTrashPointsDate).toBe('2026-06-11');

    const saved = mockKvSet.mock.calls.find(([key]) => key === 'eco:state:1001')?.[1] as EcoState;
    expect(saved.dailyTrashPoints).toEqual({ date: '2026-06-11', points: 0 });
  });

  it('reschedules due theft investigations when the thief is not caught', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const now = Date.now();
    let thefts: Array<{
      id: string;
      key: 'coin';
      originalUserId: number;
      thiefUserId: number;
      publicEntryId: string;
      originalLotId: string;
      thiefLotId: string;
      stolenAt: number;
      nextCheckAt: number;
      blackMarketAvailableAt: number;
      message: string;
      resolvedAt?: number | null;
      outcome?: 'caught' | 'escaped' | null;
    }> = [{
      id: 'theft-1',
      key: 'coin',
      originalUserId: 1001,
      thiefUserId: 1002,
      publicEntryId: 'public-1',
      originalLotId: 'owner-lot-1',
      thiefLotId: 'thief-lot-1',
      stolenAt: now - 30 * 60 * 1000,
      nextCheckAt: now - 1,
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
      message: '拿走了',
    }];

    mockKvGet.mockImplementation(async (key: string) => (
      key === 'eco:thefts' ? thefts : null
    ));
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:thefts') thefts = value as typeof thefts;
      return 'OK';
    });

    const result = await runEcoTheftInvestigations({ limit: 10 });

    randomSpy.mockRestore();
    expect(result).toMatchObject({
      checked: 1,
      caught: 0,
      escaped: 0,
      rescheduled: 1,
      skipped: 0,
      locked: true,
    });
    expect(thefts[0]?.resolvedAt).toBeUndefined();
    expect(thefts[0]?.nextCheckAt).toBe(now - 1 + 20 * 60 * 1000);
  });

  it('applies restore-count probability decay to due theft investigations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const now = Date.now();
    let thefts = [{
      id: 'theft-1',
      key: 'coin' as const,
      originalUserId: 1001,
      thiefUserId: 1002,
      publicEntryId: 'public-1',
      originalLotId: 'owner-lot-1',
      thiefLotId: 'thief-lot-1',
      stolenAt: now,
      nextCheckAt: now - 1,
      blackMarketAvailableAt: now + 24 * 60 * 60 * 1000,
      caughtCountBeforeTheft: 1,
      message: '拿走了',
    }];

    mockKvGet.mockImplementation(async (key: string) => (
      key === 'eco:thefts' ? thefts : null
    ));
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:thefts') thefts = value as typeof thefts;
      return 'OK';
    });

    const result = await runEcoTheftInvestigations({ limit: 10 });

    randomSpy.mockRestore();
    expect(result).toMatchObject({
      checked: 1,
      caught: 0,
      escaped: 0,
      rescheduled: 1,
      skipped: 0,
      locked: true,
    });
    expect(thefts[0]).not.toHaveProperty('resolvedAt');
    expect(thefts[0]).not.toHaveProperty('outcome');
    expect(thefts[0]).toMatchObject({
      nextCheckAt: now - 1 + 20 * 60 * 1000,
      caughtCountBeforeTheft: 1,
    });
  });

  it('restores stolen public prizes and forces thief achievement when caught', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const now = Date.now();
    const ownerState = createInitialEcoState(1001, now);
    const thiefState = createInitialEcoState(1002, now);
    thiefState.inventory.coin = 1;
    thiefState.limitedPrizeInventory.coin = 1;
    thiefState.prizeLots = [{
      id: 'thief-lot-1',
      key: 'coin',
      acquiredAt: now - 60 * 60 * 1000,
      availableAt: now + 23 * 60 * 60 * 1000,
      limited: true,
      source: 'stolen',
      stolenFromUserId: 1001,
      stolenAt: now - 60 * 60 * 1000,
      theftId: 'theft-1',
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
    }];
    const states = new Map<string, EcoState>([
      ['eco:state:1001', ownerState],
      ['eco:state:1002', thiefState],
    ]);
    let publicEntries = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      listedAt: now - 2 * 60 * 60 * 1000,
      merchantAvailableAt: now,
      status: 'stolen' as const,
      thiefUserId: 1002,
      thiefName: 'bob',
      theftMessage: '拿走了',
      stolenAt: now - 60 * 60 * 1000,
    }];
    let thefts = [{
      id: 'theft-1',
      key: 'coin',
      originalUserId: 1001,
      thiefUserId: 1002,
      publicEntryId: 'public-1',
      originalLotId: 'owner-lot-1',
      thiefLotId: 'thief-lot-1',
      stolenAt: now - 60 * 60 * 1000,
      nextCheckAt: now - 1,
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
      message: '拿走了',
    }];

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:thefts') return thefts;
      if (key === 'eco:public-prizes') return publicEntries;
      return states.get(key) ?? null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:thefts') thefts = value as typeof thefts;
      else if (key === 'eco:public-prizes') publicEntries = value as typeof publicEntries;
      else if (key.startsWith('eco:state:')) states.set(key, value as EcoState);
      return 'OK';
    });
    mockGetUserPoints.mockResolvedValue(50);

    const result = await runEcoTheftInvestigations({ limit: 10 });

    randomSpy.mockRestore();
    expect(result).toMatchObject({
      checked: 1,
      caught: 1,
      escaped: 0,
      rescheduled: 0,
      skipped: 0,
      locked: true,
    });
    expect(thefts[0]).toMatchObject({ resolvedAt: now, outcome: 'caught' });
    expect(states.get('eco:state:1001')?.inventory.coin).toBe(1);
    expect(states.get('eco:state:1002')?.inventory.coin).toBe(0);
    expect(states.get('eco:state:1001')?.prizeLots[0]).toMatchObject({
      key: 'coin',
      source: 'restored',
      publicEntryId: 'public-1',
    });
    expect(publicEntries[0]).toMatchObject({
      status: 'listed',
      stealProtectedUntil: now + 24 * 60 * 60 * 1000,
      theftCaughtCount: 1,
      thiefUserId: null,
      thiefName: null,
      theftMessage: null,
      stolenAt: null,
    });
    expect(mockApplyPointsDelta).toHaveBeenCalledWith(
      1002,
      -50,
      'game_play',
      expect.stringContaining('环保行动偷盗处罚'),
    );
    expect(mockAddPoints).toHaveBeenCalledWith(
      1001,
      25,
      'game_play',
      expect.stringContaining('环保行动偷盗赔偿'),
    );
    expect(mockGrantUserAchievement).toHaveBeenCalledWith(
      1002,
      'thief',
      expect.objectContaining({ source: 'auto' }),
    );
    expect(mockForceEquipAchievement).toHaveBeenCalledWith(
      1002,
      'thief',
      now + 10 * 60 * 60 * 1000,
    );
  });

  it('rolls back caught theft board state when restored owner state save fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00.000Z'));
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const now = Date.now();
    const ownerState = createInitialEcoState(1001, now);
    const thiefState = createInitialEcoState(1002, now);
    thiefState.inventory.coin = 1;
    thiefState.prizeLots = [{
      id: 'thief-lot-1',
      key: 'coin',
      acquiredAt: now - 60 * 60 * 1000,
      availableAt: now + 23 * 60 * 60 * 1000,
      limited: false,
      source: 'stolen',
      stolenFromUserId: 1001,
      stolenAt: now - 60 * 60 * 1000,
      theftId: 'theft-1',
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
    }];
    const states = new Map<string, EcoState>([
      ['eco:state:1001', ownerState],
      ['eco:state:1002', thiefState],
    ]);
    const originalPublicEntries: EcoPublicPrizeEntry[] = [{
      id: 'public-1',
      key: 'coin',
      ownerUserId: 1001,
      ownerName: 'alice',
      ownerLotId: 'owner-lot-1',
      publicAt: now - 2 * 60 * 60 * 1000,
      merchantAvailableAt: now,
      status: 'stolen',
      thiefUserId: 1002,
      thiefName: 'bob',
      theftMessage: '拿走了',
      stolenAt: now - 60 * 60 * 1000,
    }];
    const originalThefts = [{
      id: 'theft-1',
      key: 'coin' as const,
      originalUserId: 1001,
      thiefUserId: 1002,
      publicEntryId: 'public-1',
      originalLotId: 'owner-lot-1',
      thiefLotId: 'thief-lot-1',
      stolenAt: now - 60 * 60 * 1000,
      nextCheckAt: now - 1,
      blackMarketAvailableAt: now + 23 * 60 * 60 * 1000,
      message: '拿走了',
    }];
    let publicEntries = originalPublicEntries.map((entry) => ({ ...entry }));
    let thefts = originalThefts.map((entry) => ({ ...entry }));

    mockKvGet.mockImplementation(async (key: string) => {
      if (key === 'eco:thefts') return thefts;
      if (key === 'eco:public-prizes') return publicEntries;
      return states.get(key) ?? null;
    });
    mockKvSet.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'eco:thefts') {
        thefts = value as typeof thefts;
        return 'OK';
      }
      if (key === 'eco:public-prizes') {
        publicEntries = value as typeof publicEntries;
        return 'OK';
      }
      if (key.startsWith('eco:state:')) {
        throw new Error('state save failed');
      }
      return 'OK';
    });

    await expect(runEcoTheftInvestigations({ limit: 10 }))
      .rejects.toThrow('state save failed');

    randomSpy.mockRestore();
    expect(publicEntries).toEqual(originalPublicEntries);
    expect(thefts).toEqual(originalThefts);
  });
});
