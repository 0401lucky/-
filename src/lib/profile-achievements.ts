export type AchievementId =
  | 'beginner'
  | 'first_checkin'
  | 'checkin_3'
  | 'checkin_7'
  | 'checkin_30'
  | 'first_pot'
  | 'small_success'
  | 'tycoon'
  | 'card_beginner'
  | 'card_collector'
  | 'collection_master'
  | 'lottery_player'
  | 'contributor'
  | 'peak_first'
  | 'game_king'
  | 'farm_owner'
  | 'lucky_star'
  | 'unlucky_star'
  | 'eco_ambassador'
  | 'gold_digger'
  | 'xiaoc_fan';

export type AchievementUnlockMode = 'auto' | 'admin' | 'periodic';

export interface AchievementDefinition {
  id: AchievementId;
  emoji: string;
  name: string;
  desc: string;
  unlockMode: AchievementUnlockMode;
  series?: string;
  shine?: boolean;
}

export interface PublicAchievement {
  id: AchievementId;
  emoji: string;
  name: string;
  desc: string;
  expiresAt?: number | null;
}

export interface UserAchievementGrant {
  id: AchievementId;
  source: 'auto' | 'admin' | 'ranking_monthly';
  grantedAt: number;
  expiresAt?: number | null;
  reason?: string;
  grantedBy?: {
    id: number;
    username: string;
  } | null;
  metadata?: Record<string, unknown>;
}

export interface AchievementDef extends PublicAchievement {
  unlocked: boolean;
  shine?: boolean;
  series?: string;
  unlockMode: AchievementUnlockMode;
  grantedAt?: number | null;
  equipped?: boolean;
}

export interface ProfileAchievementStats {
  gameWinRate: number;
  gameWinPlays: number;
  farmUnlockedLands: number;
  lotteryOrangeCount: number;
  lotteryHeartCount: number;
  ecoLifetimeCleared: number;
  ecoLifetimePrizeClaims: number;
  ecoLifetimePhotoClaims: number;
}

export interface ProfileAchievementOverviewData {
  points: {
    balance: number;
  };
  cards: {
    owned: number;
    completionRate: number;
  };
  gameplay: {
    checkinStreak: number;
    totalCheckinDays: number;
    recentRecords: Array<{
      gameType: string;
    }>;
  };
  achievementStats?: ProfileAchievementStats;
  achievements?: {
    grants?: UserAchievementGrant[];
    equippedId?: AchievementId | null;
  };
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: 'beginner',
    emoji: '🎯',
    name: '初心者',
    desc: '注册账户即解锁',
    unlockMode: 'auto',
    shine: true,
  },
  {
    id: 'first_checkin',
    emoji: '🌅',
    name: '首次签到',
    desc: '完成首次签到',
    unlockMode: 'auto',
  },
  {
    id: 'checkin_3',
    emoji: '🔥',
    name: '连签 3 天',
    desc: '连续签到 3 天',
    unlockMode: 'auto',
  },
  {
    id: 'checkin_7',
    emoji: '⚡',
    name: '连签 7 天',
    desc: '连续签到 7 天',
    unlockMode: 'auto',
  },
  {
    id: 'checkin_30',
    emoji: '💎',
    name: '连签 30 天',
    desc: '连续签到 30 天',
    unlockMode: 'auto',
  },
  {
    id: 'first_pot',
    emoji: '💰',
    name: '第一桶金',
    desc: '积分余额达到 1000',
    unlockMode: 'auto',
    series: '财富系列',
  },
  {
    id: 'small_success',
    emoji: '💵',
    name: '小有成绩',
    desc: '积分余额达到 5000',
    unlockMode: 'auto',
    series: '财富系列',
  },
  {
    id: 'tycoon',
    emoji: '🏦',
    name: '大富翁',
    desc: '积分余额达到 10000',
    unlockMode: 'auto',
    series: '财富系列',
    shine: true,
  },
  {
    id: 'card_beginner',
    emoji: '🎴',
    name: '卡牌入门',
    desc: '收集 10 张卡牌',
    unlockMode: 'auto',
  },
  {
    id: 'card_collector',
    emoji: '🃏',
    name: '图鉴收藏',
    desc: '收集 50 张卡牌',
    unlockMode: 'auto',
  },
  {
    id: 'collection_master',
    emoji: '👑',
    name: '收集大师',
    desc: '完成所有图鉴',
    unlockMode: 'auto',
    shine: true,
  },
  {
    id: 'lottery_player',
    emoji: '🎰',
    name: '抽奖玩家',
    desc: '参与过幸运抽奖',
    unlockMode: 'auto',
  },
  {
    id: 'contributor',
    emoji: '🤝',
    name: '奉献者',
    desc: '提出 10 条或以上有用反馈后，由管理员颁发',
    unlockMode: 'admin',
  },
  {
    id: 'peak_first',
    emoji: '🏔️',
    name: '巅峰第一',
    desc: '上个月风云榜月榜第一，结算后获得，30 天内有效',
    unlockMode: 'periodic',
    shine: true,
  },
  {
    id: 'game_king',
    emoji: '🎮',
    name: '游戏王',
    desc: '用户游戏胜率达到 75% 以上',
    unlockMode: 'auto',
  },
  {
    id: 'farm_owner',
    emoji: '🌾',
    name: '农场主',
    desc: '农场 8 块土地全部解锁',
    unlockMode: 'auto',
  },
  {
    id: 'lucky_star',
    emoji: '🍊',
    name: '幸运之星',
    desc: '累计在每日幸运抽奖中抽到 100 次橙子',
    unlockMode: 'auto',
  },
  {
    id: 'unlucky_star',
    emoji: '❤️',
    name: '倒霉之星',
    desc: '累计在每日幸运抽奖中抽到 100 次爱心',
    unlockMode: 'auto',
  },
  {
    id: 'eco_ambassador',
    emoji: '🌱',
    name: '环保大使',
    desc: '在环保行动中累计回收 10000 个普通垃圾，奖品不计入',
    unlockMode: 'auto',
    series: '环保行动',
    shine: true,
  },
  {
    id: 'gold_digger',
    emoji: '⛏️',
    name: '淘金者',
    desc: '在环保行动中累计拾取 10 个奖品',
    unlockMode: 'auto',
    series: '环保行动',
  },
  {
    id: 'xiaoc_fan',
    emoji: '📸',
    name: 'XiaoC忠实粉丝',
    desc: '在环保行动中累计拾取 5 张照片',
    unlockMode: 'auto',
    series: '环保行动',
    shine: true,
  },
];

export const ACHIEVEMENT_BY_ID = new Map(
  ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition])
);

export function isAchievementId(value: unknown): value is AchievementId {
  return typeof value === 'string' && ACHIEVEMENT_BY_ID.has(value as AchievementId);
}

export function isActiveAchievementGrant(
  grant: UserAchievementGrant | null | undefined,
  now = Date.now()
): grant is UserAchievementGrant {
  if (!grant || !isAchievementId(grant.id)) return false;
  return !grant.expiresAt || grant.expiresAt > now;
}

export function getPublicAchievementById(
  id: AchievementId,
  grant?: UserAchievementGrant | null
): PublicAchievement | null {
  const definition = ACHIEVEMENT_BY_ID.get(id);
  if (!definition) return null;
  return {
    id,
    emoji: definition.emoji,
    name: definition.name,
    desc: definition.desc,
    expiresAt: grant?.expiresAt ?? null,
  };
}

function buildGrantMap(grants: UserAchievementGrant[] = [], now = Date.now()): Map<AchievementId, UserAchievementGrant> {
  const map = new Map<AchievementId, UserAchievementGrant>();
  for (const grant of grants) {
    if (isActiveAchievementGrant(grant, now)) {
      map.set(grant.id, grant);
    }
  }
  return map;
}

export function getAutomaticAchievementIds(d: ProfileAchievementOverviewData): AchievementId[] {
  const balance = d.points.balance;
  const owned = d.cards.owned;
  const completion = d.cards.completionRate;
  const streak = d.gameplay.checkinStreak;
  const totalDays = d.gameplay.totalCheckinDays;
  const records = d.gameplay.recentRecords;
  const stats = d.achievementStats;

  const hasLottery = records.some((r) => r.gameType === 'lottery');
  const gameWinRate = stats?.gameWinRate ?? 0;
  const gameWinPlays = stats?.gameWinPlays ?? 0;
  const farmUnlockedLands = stats?.farmUnlockedLands ?? 0;
  const lotteryOrangeCount = stats?.lotteryOrangeCount ?? 0;
  const lotteryHeartCount = stats?.lotteryHeartCount ?? 0;
  const ecoLifetimeCleared = stats?.ecoLifetimeCleared ?? 0;
  const ecoLifetimePrizeClaims = stats?.ecoLifetimePrizeClaims ?? 0;
  const ecoLifetimePhotoClaims = stats?.ecoLifetimePhotoClaims ?? 0;

  const ids: AchievementId[] = ['beginner'];
  if (totalDays >= 1) ids.push('first_checkin');
  if (streak >= 3) ids.push('checkin_3');
  if (streak >= 7) ids.push('checkin_7');
  if (streak >= 30) ids.push('checkin_30');
  if (balance >= 1000) ids.push('first_pot');
  if (balance >= 5000) ids.push('small_success');
  if (balance >= 10000) ids.push('tycoon');
  if (owned >= 10) ids.push('card_beginner');
  if (owned >= 50) ids.push('card_collector');
  if (completion >= 100) ids.push('collection_master');
  if (hasLottery) ids.push('lottery_player');
  if (gameWinPlays > 0 && gameWinRate >= 0.75) ids.push('game_king');
  if (farmUnlockedLands >= 8) ids.push('farm_owner');
  if (lotteryOrangeCount >= 100) ids.push('lucky_star');
  if (lotteryHeartCount >= 100) ids.push('unlucky_star');
  if (ecoLifetimeCleared >= 10000) ids.push('eco_ambassador');
  if (ecoLifetimePrizeClaims >= 10) ids.push('gold_digger');
  if (ecoLifetimePhotoClaims >= 5) ids.push('xiaoc_fan');

  return ids;
}

// 成就规则：全部基于个人主页 API 已返回的真实字段和已颁发记录派生。
export function buildAchievements(d: ProfileAchievementOverviewData, now = Date.now()): AchievementDef[] {
  const activeGrants = buildGrantMap(d.achievements?.grants ?? [], now);
  const automaticIds = new Set<AchievementId>(getAutomaticAchievementIds(d));
  const equippedId = d.achievements?.equippedId ?? null;

  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const grant = activeGrants.get(definition.id) ?? null;
    const unlocked = automaticIds.has(definition.id) || grant !== null;
    return {
      id: definition.id,
      emoji: definition.emoji,
      name: definition.name,
      desc: definition.desc,
      series: definition.series,
      unlockMode: definition.unlockMode,
      unlocked,
      shine: Boolean(definition.shine && unlocked),
      grantedAt: grant?.grantedAt ?? null,
      expiresAt: grant?.expiresAt ?? null,
      equipped: unlocked && equippedId === definition.id,
    };
  });
}
