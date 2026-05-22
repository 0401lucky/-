import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_DEFINITIONS,
  buildAchievements,
  type ProfileAchievementOverviewData,
} from '../profile-achievements';

function makeOverview(
  overrides: {
    balance?: number;
    checkinStreak?: number;
    totalCheckinDays?: number;
    owned?: number;
    completionRate?: number;
    recentRecords?: ProfileAchievementOverviewData['gameplay']['recentRecords'];
    gameWinRate?: number;
    gameWinPlays?: number;
    farmUnlockedLands?: number;
    lotteryOrangeCount?: number;
    lotteryHeartCount?: number;
  } = {}
): ProfileAchievementOverviewData {
  return {
    points: {
      balance: overrides.balance ?? 0,
    },
    cards: {
      owned: overrides.owned ?? 0,
      completionRate: overrides.completionRate ?? 0,
    },
    gameplay: {
      checkinStreak: overrides.checkinStreak ?? 0,
      totalCheckinDays: overrides.totalCheckinDays ?? 0,
      recentRecords: overrides.recentRecords ?? [],
    },
    achievementStats: {
      gameWinRate: overrides.gameWinRate ?? 0,
      gameWinPlays: overrides.gameWinPlays ?? 0,
      farmUnlockedLands: overrides.farmUnlockedLands ?? 0,
      lotteryOrangeCount: overrides.lotteryOrangeCount ?? 0,
      lotteryHeartCount: overrides.lotteryHeartCount ?? 0,
    },
  };
}

function achievementMap(data: ProfileAchievementOverviewData) {
  return new Map(buildAchievements(data).map((item) => [item.name, item]));
}

describe('profile achievements', () => {
  it('将财富系列按第一桶金、小有成绩、大富翁连续排列并按积分解锁', () => {
    const wealthNames = ACHIEVEMENT_DEFINITIONS
      .filter((item) => item.series === '财富系列')
      .map((item) => item.name);
    expect(wealthNames).toEqual(['第一桶金', '小有成绩', '大富翁']);

    const underFirst = achievementMap(makeOverview({ balance: 999 }));
    expect(underFirst.get('第一桶金')?.unlocked).toBe(false);

    const first = achievementMap(makeOverview({ balance: 1000 }));
    expect(first.get('第一桶金')?.unlocked).toBe(true);
    expect(first.get('小有成绩')?.unlocked).toBe(false);

    const middle = achievementMap(makeOverview({ balance: 5000 }));
    expect(middle.get('小有成绩')?.unlocked).toBe(true);
    expect(middle.get('大富翁')?.unlocked).toBe(false);

    const rich = achievementMap(makeOverview({ balance: 10000 }));
    expect(rich.get('大富翁')?.unlocked).toBe(true);
    expect(rich.get('大富翁')?.shine).toBe(true);
  });

  it('去除了不再需要的旧趣味成就', () => {
    const names = ACHIEVEMENT_DEFINITIONS.map((item) => item.name);

    expect(names).not.toContain('胜利开张');
    expect(names).not.toContain('多面手');
    expect(names).not.toContain('碎片仓库');
    expect(names).not.toContain('清爽收件箱');
  });

  it('按真实统计字段解锁新增自动成就', () => {
    const achievements = achievementMap(
      makeOverview({
        gameWinPlays: 20,
        gameWinRate: 0.75,
        farmUnlockedLands: 8,
        lotteryOrangeCount: 100,
        lotteryHeartCount: 100,
      })
    );

    expect(achievements.get('游戏王')?.unlocked).toBe(true);
    expect(achievements.get('农场主')?.unlocked).toBe(true);
    expect(achievements.get('幸运之星')?.unlocked).toBe(true);
    expect(achievements.get('倒霉之星')?.unlocked).toBe(true);
  });

  it('管理员和周期成就只有存在有效颁发记录时解锁', () => {
    const now = Date.now();
    const achievements = achievementMap({
      ...makeOverview(),
      achievements: {
        grants: [
          {
            id: 'contributor',
            source: 'admin',
            grantedAt: now,
          },
          {
            id: 'peak_first',
            source: 'ranking_monthly',
            grantedAt: now,
            expiresAt: now + 1000,
          },
        ],
        equippedId: 'peak_first',
      },
    });

    expect(achievements.get('奉献者')?.unlocked).toBe(true);
    expect(achievements.get('巅峰第一')?.unlocked).toBe(true);
    expect(achievements.get('巅峰第一')?.equipped).toBe(true);

    const locked = achievementMap(makeOverview());
    expect(locked.get('奉献者')?.unlocked).toBe(false);
    expect(locked.get('巅峰第一')?.unlocked).toBe(false);
  });
});
