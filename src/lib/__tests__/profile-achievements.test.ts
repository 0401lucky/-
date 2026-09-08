import { describe, expect, it } from 'vitest';
import {
  buildAchievements,
  getAutomaticAchievementIds,
  type ProfileAchievementOverviewData,
} from '../profile-achievements';

function emptyOverview(): ProfileAchievementOverviewData {
  return {
    points: { balance: 0 },
    cards: { owned: 0, completionRate: 0 },
    gameplay: { checkinStreak: 0, totalCheckinDays: 0, recentRecords: [] },
    achievementStats: {
      gameWinRate: 0,
      gameWinPlays: 0,
      farmUnlockedLands: 0,
      lotteryOrangeCount: 0,
      lotteryHeartCount: 0,
      ecoLifetimeCleared: 0,
      ecoLifetimePrizeClaims: 0,
      ecoLifetimePhotoClaims: 0,
    },
  };
}

describe('profile achievements', () => {
  it('uses historical milestones after spending points, breaking a streak and playing other games', () => {
    const data = emptyOverview();
    data.points.balance = 500;
    data.gameplay.totalCheckinDays = 30;
    data.gameplay.recentRecords = [{ gameType: 'memory' }];
    Object.assign(data.achievementStats!, {
      peakPointsBalance: 10000,
      checkinMaxStreak: 30,
      lotteryPlays: 1,
    });

    expect(getAutomaticAchievementIds(data)).toEqual([
      'beginner', 'first_checkin', 'checkin_3', 'checkin_7', 'checkin_30',
      'first_pot', 'small_success', 'tycoon', 'lottery_player',
    ]);
  });

  it('supports responses without the added history fields', () => {
    const data = emptyOverview();
    data.points.balance = 1000;
    data.gameplay = {
      checkinStreak: 3,
      totalCheckinDays: 3,
      recentRecords: [{ gameType: 'lottery' }],
    };

    expect(getAutomaticAchievementIds(data)).toEqual([
      'beginner', 'first_checkin', 'checkin_3', 'first_pot', 'lottery_player',
    ]);
    delete data.achievementStats;
    expect(getAutomaticAchievementIds(data)).toContain('lottery_player');
  });

  it('keeps persisted awards unlocked and equipped after progress decreases', () => {
    const data = emptyOverview();
    const now = 10000;
    data.achievements = {
      equippedId: 'farm_owner',
      grants: [
        { id: 'farm_owner', source: 'auto', grantedAt: 1000, expiresAt: null },
        { id: 'card_collector', source: 'auto', grantedAt: 1000 },
        { id: 'game_king', source: 'auto', grantedAt: 1000 },
        { id: 'contributor', source: 'admin', grantedAt: 1000 },
        { id: 'peak_first', source: 'ranking_monthly', grantedAt: 1000, expiresAt: now },
        { id: 'thief', source: 'auto', grantedAt: 1000, expiresAt: now - 1 },
      ],
    };

    const items = buildAchievements(data, now);
    expect(items.filter((item) => item.unlocked).map((item) => item.id)).toEqual([
      'beginner', 'card_collector', 'contributor', 'game_king', 'farm_owner',
    ]);
    expect(items.find((item) => item.id === 'farm_owner')).toMatchObject({
      unlocked: true,
      equipped: true,
      grantedAt: 1000,
      expiresAt: null,
    });
  });
});
