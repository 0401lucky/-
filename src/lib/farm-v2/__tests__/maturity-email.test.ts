import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kv } from '@/lib/d1-kv';
import { sendFarmMaturityEmail, sendFarmWaterReminderEmail, isFarmMaturityEmailConfigured } from '@/lib/email';
import { getCustomUserProfile } from '@/lib/user-profile';
import type { FarmStateV2, PetStage } from '@/lib/types/farm-v2';
import { processMaturityEmailEventsForState } from '../maturity-email';

vi.mock('@/lib/d1-kv', () => ({
  kv: {
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('@/lib/email', () => ({
  isFarmMaturityEmailConfigured: vi.fn(),
  sendFarmMaturityEmail: vi.fn(),
  sendFarmWaterReminderEmail: vi.fn(),
}));

vi.mock('@/lib/user-profile', () => ({
  getCustomUserProfile: vi.fn(),
}));

function createState(petStage: PetStage = 'adult'): FarmStateV2 {
  return {
    userId: 1,
    points: 100,
    lands: [{
      index: 1,
      status: 'mature',
      crop: {
        cropId: 'wheat',
        plantedAt: 1_699_999_000_000,
        matureAt: 1_700_000_000_000,
        lastWaterAt: 1_699_999_000_000,
        nextWaterDueAt: 1_700_000_000_000,
        waterMissCount: 0,
        fertilizer: null,
        plantedSeason: 'spring',
        weatherAtPlant: 'sunny',
        birdNetUntil: null,
        stolenAmount: 0,
        stolenCount: 0,
        speedUsed: 0,
        speedReducedMinutes: 0,
      },
    }],
    scarecrowUntil: null,
    bellUntil: null,
    pet: {
      type: 'cat',
      name: '雪球',
      stage: petStage,
      growth: petStage === 'adult' ? 100 : 10,
      hunger: 100,
      cleanliness: 100,
      mood: 50,
      thirst: 10,
      health: 95,
      currentTask: null,
      taskStartAt: null,
      taskEndAt: null,
      cooldownEndAt: null,
      feedToday: { normal: 0, premium: 0 },
      washToday: 0,
      waterToday: 0,
      playToday: 0,
      toyToday: 0,
      dailyResetAt: 1_700_000_000_000,
    },
    stolenTodayCount: 0,
    stolenByMap: {},
    myStealMap: {},
    inventory: {},
    seedInventory: {},
    events: [{
      id: 'event-1',
      ts: 1_700_000_000_000,
      type: 'mature',
      text: '小麦成熟了，快去收获',
      cropId: 'wheat',
      landIndex: 1,
    }],
    lastDailyResetAt: 1_700_000_000_000,
    lastSeasonProcessedAt: 1_700_000_000_000,
    lastTickAt: 1_700_000_000_000,
    bonuses: { firstWater: false, firstHarvest: false, firstAdopt: true },
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };
}

describe('processMaturityEmailEventsForState', () => {
  const mockSet = vi.mocked(kv.set);
  const mockDel = vi.mocked(kv.del);
  const mockConfigured = vi.mocked(isFarmMaturityEmailConfigured);
  const mockSend = vi.mocked(sendFarmMaturityEmail);
  const mockWaterSend = vi.mocked(sendFarmWaterReminderEmail);
  const mockProfile = vi.mocked(getCustomUserProfile);
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSet.mockResolvedValue('OK');
    mockDel.mockResolvedValue(1);
    mockConfigured.mockReturnValue(true);
    mockSend.mockResolvedValue({ sent: true });
    mockWaterSend.mockResolvedValue({ sent: true });
    mockProfile.mockResolvedValue({ qqEmail: '123456@qq.com' });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sends one email for adult pet with configured QQ email', async () => {
    const result = await processMaturityEmailEventsForState(createState(), 1_700_000_010_000);

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mockSet).toHaveBeenCalledWith(
      'farmv2:mature-mail:sent:1:event-1',
      { claimedAt: 1_700_000_010_000 },
      { nx: true, ex: expect.any(Number) },
    );
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      to: '123456@qq.com',
      cropName: '小麦',
      matureAt: 1_700_000_000_000,
      petName: '雪球',
    }));
    expect(mockWaterSend).not.toHaveBeenCalled();
  });

  it('sends one water reminder when crop enters the 10 minute watering window', async () => {
    const now = 1_700_000_010_000;
    const state = createState();
    state.events = [];
    state.lands[0].status = 'growing';
    state.lands[0].crop!.plantedAt = now - 20 * 60 * 1000;
    state.lands[0].crop!.matureAt = now + 60 * 60 * 1000;
    state.lands[0].crop!.nextWaterDueAt = now + 10 * 60 * 1000;
    state.lands[0].crop!.waterMissCount = 0;

    const result = await processMaturityEmailEventsForState(state, now);

    expect(result).toEqual({ checked: 1, sent: 1, skipped: 0, failed: 0 });
    expect(mockSet).toHaveBeenCalledWith(
      `farmv2:water-mail:sent:1:1:${now - 20 * 60 * 1000}:${now + 10 * 60 * 1000}:0`,
      { claimedAt: now },
      { nx: true, ex: expect.any(Number) },
    );
    expect(mockWaterSend).toHaveBeenCalledWith(expect.objectContaining({
      to: '123456@qq.com',
      cropName: '小麦',
      landIndex: 1,
      waterDueAt: now + 10 * 60 * 1000,
      petName: '雪球',
    }));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('skips when pet is not adult', async () => {
    const result = await processMaturityEmailEventsForState(createState('child'));

    expect(result).toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockWaterSend).not.toHaveBeenCalled();
    expect(mockProfile).not.toHaveBeenCalled();
  });

  it('skips duplicate events when claim key already exists', async () => {
    mockSet.mockResolvedValue(null);

    const result = await processMaturityEmailEventsForState(createState());

    expect(result).toEqual({ checked: 1, sent: 0, skipped: 1, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('ignores stale mature events when crop is no longer mature on land', async () => {
    const state = createState();
    state.lands[0].status = 'empty';
    state.lands[0].crop = null;

    const result = await processMaturityEmailEventsForState(state);

    expect(result).toEqual({ checked: 0, sent: 0, skipped: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('releases claim key when sending fails', async () => {
    mockSend.mockRejectedValue(new Error('provider down'));

    const result = await processMaturityEmailEventsForState(createState());

    expect(result).toEqual({ checked: 1, sent: 0, skipped: 0, failed: 1 });
    expect(mockDel).toHaveBeenCalledWith('farmv2:mature-mail:sent:1:event-1');
  });
});
