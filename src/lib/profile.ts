import { kv } from '@/lib/d1-kv';
import { ALBUMS, CARDS } from './cards/config';
import { getUserCardData } from './cards/draw';
import { getPointsLogs, getUserPoints } from './points';
import { getCheckinStreak, getTotalCheckinDays } from './rankings';
import { listUserNotifications } from './notifications';
import { getCustomUserProfile } from './user-profile';
import { getMatch3Records } from './match3';
import { MATCH3_WIN_SCORE } from './match3-engine';
import { getMinesweeperRecords } from './minesweeper';
import { getMemoryRecords } from './memory';
import { getWhackMoleRecords } from './whack-mole';
import { WHACK_MOLE_WIN_SCORE } from './whack-mole-engine';
import { getRogueliteRecords } from './roguelite';
import { getLinkGameRecords } from './linkgame-server';
import { getUserLotteryRecords } from './lottery';
import { FARM_V2_STATE_KEY } from './farm-v2/steal';
import { MAX_LAND_COUNT } from './farm-v2/config';
import type { FarmStateV2 } from './types/farm-v2';
import {
  buildUserAchievementSummary,
  type UserAchievementSummary,
} from './user-achievements';
import type { ProfileAchievementStats } from './profile-achievements';

type ProfileGameType = 'linkgame' | 'match3' | 'memory' | 'whack_mole' | 'roguelite' | 'minesweeper' | 'lottery';

export interface ProfileRecentRecord {
  gameType: ProfileGameType;
  score: number;
  pointsEarned: number;
  createdAt: number;
}

export interface ProfileOverview {
  user: {
    id: number;
    username: string;
    // 自定义昵称（未设置时为 null）
    customDisplayName: string | null;
    // 自定义头像 URL（未设置时为 null）
    customAvatarUrl: string | null;
    // QQ 邮箱（未设置时为 null）
    customQqEmail: string | null;
  };
  points: {
    balance: number;
    recentLogs: Array<{
      amount: number;
      source: string;
      description: string;
      createdAt: number;
    }>;
  };
  cards: {
    owned: number;
    total: number;
    fragments: number;
    drawsAvailable: number;
    completionRate: number;
    albums: Array<{
      id: string;
      name: string;
      owned: number;
      total: number;
      completionRate: number;
    }>;
  };
  gameplay: {
    checkinStreak: number;
    totalCheckinDays: number;
    recentRecords: ProfileRecentRecord[];
  };
  notifications: {
    unreadCount: number;
    recent: Array<{
      id: string;
      title: string;
      content: string;
      type: string;
      createdAt: number;
      isRead: boolean;
    }>;
  };
  achievementStats: ProfileAchievementStats;
  achievements: UserAchievementSummary;
}

const GAME_RECORD_KEYS: Array<{ type: ProfileGameType; key: (userId: number) => string }> = [
  { type: 'linkgame', key: (userId) => `linkgame:records:${userId}` },
  { type: 'match3', key: (userId) => `match3:records:${userId}` },
  { type: 'memory', key: (userId) => `memory:records:${userId}` },
  { type: 'whack_mole', key: (userId) => `whack_mole:records:${userId}` },
  { type: 'roguelite', key: (userId) => `roguelite:records:${userId}` },
  { type: 'minesweeper', key: (userId) => `minesweeper:records:${userId}` },
  { type: 'lottery', key: (userId) => `lottery:user:records:${userId}` },
];

function toFiniteNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function mapRecentRecord(gameType: ProfileGameType, raw: unknown): ProfileRecentRecord | null {
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const createdAt = toFiniteNumber(record.createdAt);
  if (createdAt <= 0) return null;

  const scoreRaw = gameType === 'lottery' ? record.tierValue : record.score;

  return {
    gameType,
    score: toFiniteNumber(scoreRaw),
    pointsEarned: toFiniteNumber(record.pointsEarned),
    createdAt,
  };
}

async function getRecentRecords(userId: number, limit = 10): Promise<ProfileRecentRecord[]> {
  const readSize = Math.max(limit * 2, 20);

  const allRecords = await Promise.all(
    GAME_RECORD_KEYS.map((item) => kv.lrange<unknown[]>(item.key(userId), 0, readSize - 1))
  );

  const rows: ProfileRecentRecord[] = [];
  for (let i = 0; i < GAME_RECORD_KEYS.length; i++) {
    for (const raw of allRecords[i] ?? []) {
      const row = mapRecentRecord(GAME_RECORD_KEYS[i].type, raw);
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

const ACHIEVEMENT_GAME_RECORD_LIMIT = 200;
const ACHIEVEMENT_LOTTERY_RECORD_LIMIT = 5000;

async function getGameWinAchievementStats(userId: number): Promise<Pick<ProfileAchievementStats, 'gameWinRate' | 'gameWinPlays'>> {
  const [
    linkgameRecords,
    match3Records,
    memoryRecords,
    minesweeperRecords,
    rogueliteRecords,
    whackMoleRecords,
  ] = await Promise.all([
    getLinkGameRecords(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
    getMatch3Records(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
    getMemoryRecords(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
    getMinesweeperRecords(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
    getRogueliteRecords(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
    getWhackMoleRecords(userId, ACHIEVEMENT_GAME_RECORD_LIMIT),
  ]);

  const plays =
    linkgameRecords.length +
    match3Records.length +
    memoryRecords.length +
    minesweeperRecords.length +
    rogueliteRecords.length +
    whackMoleRecords.length;

  const wins =
    linkgameRecords.filter((record) => record.completed).length +
    match3Records.filter((record) => record.score >= MATCH3_WIN_SCORE).length +
    memoryRecords.filter((record) => record.completed).length +
    minesweeperRecords.filter((record) => record.won).length +
    rogueliteRecords.filter((record) => record.won).length +
    whackMoleRecords.filter((record) => record.score >= WHACK_MOLE_WIN_SCORE).length;

  return {
    gameWinRate: plays > 0 ? wins / plays : 0,
    gameWinPlays: plays,
  };
}

async function getFarmUnlockedLandCount(userId: number): Promise<number> {
  const state = await kv.get<FarmStateV2>(FARM_V2_STATE_KEY(userId));
  if (!state || !Array.isArray(state.lands)) {
    return 0;
  }
  return Math.min(
    MAX_LAND_COUNT,
    state.lands.filter((land) => land && land.status !== 'locked').length
  );
}

async function getLotteryAchievementCounts(
  userId: number
): Promise<Pick<ProfileAchievementStats, 'lotteryOrangeCount' | 'lotteryHeartCount'>> {
  const records = await getUserLotteryRecords(userId, ACHIEVEMENT_LOTTERY_RECORD_LIMIT);
  return {
    lotteryOrangeCount: records.filter((record) => record.tierName.includes('橙子') || record.tierValue === 200).length,
    lotteryHeartCount: records.filter((record) => record.tierName.includes('谢谢惠顾') || record.tierValue === 0).length,
  };
}

async function getAchievementStats(userId: number): Promise<ProfileAchievementStats> {
  const [gameStats, farmUnlockedLands, lotteryCounts] = await Promise.all([
    getGameWinAchievementStats(userId),
    getFarmUnlockedLandCount(userId),
    getLotteryAchievementCounts(userId),
  ]);

  return {
    ...gameStats,
    farmUnlockedLands,
    ...lotteryCounts,
  };
}

function buildAlbumProgress(inventory: string[]): ProfileOverview['cards']['albums'] {
  const ownedSet = new Set(inventory);

  return ALBUMS.map((album) => {
    const albumCards = CARDS.filter((card) => card.albumId === album.id);
    const owned = albumCards.reduce((count, card) => {
      return ownedSet.has(card.id) ? count + 1 : count;
    }, 0);

    const total = albumCards.length;
    const completionRate = total > 0 ? Math.min(100, Math.round((owned / total) * 10000) / 100) : 0;

    return {
      id: album.id,
      name: album.name,
      owned,
      total,
      completionRate,
    };
  });
}

export async function getProfileOverview(
  user: { id: number; username: string }
): Promise<ProfileOverview> {
  const [
    pointsBalance,
    pointsLogs,
    cardData,
    checkinStreak,
    totalCheckinDays,
    recentRecords,
    notificationResult,
    customProfile,
    achievementStats,
  ] = await Promise.all([
    getUserPoints(user.id),
    getPointsLogs(user.id, 10),
    getUserCardData(String(user.id)),
    getCheckinStreak(user.id, 'all'),
    getTotalCheckinDays(user.id),
    getRecentRecords(user.id, 10),
    listUserNotifications(user.id, { page: 1, limit: 5 }),
    getCustomUserProfile(user.id),
    getAchievementStats(user.id),
  ]);

  const albums = buildAlbumProgress(cardData.inventory);
  const totalCards = CARDS.length;
  const ownedCards = new Set(cardData.inventory).size;
  const completionRate = totalCards > 0 ? Math.min(100, Math.round((ownedCards / totalCards) * 10000) / 100) : 0;

  const baseOverview = {
    user: {
      id: user.id,
      username: user.username,
      customDisplayName: customProfile.displayName ?? null,
      customAvatarUrl: customProfile.avatarUrl ?? null,
      customQqEmail: customProfile.qqEmail ?? null,
    },
    points: {
      balance: pointsBalance,
      recentLogs: pointsLogs.map((log) => ({
        amount: log.amount,
        source: log.source,
        description: log.description,
        createdAt: log.createdAt,
      })),
    },
    cards: {
      owned: ownedCards,
      total: totalCards,
      fragments: cardData.fragments,
      drawsAvailable: cardData.drawsAvailable,
      completionRate,
      albums,
    },
    gameplay: {
      checkinStreak,
      totalCheckinDays,
      recentRecords,
    },
    notifications: {
      unreadCount: notificationResult.unreadCount,
      recent: notificationResult.items.map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        type: item.type,
        createdAt: item.createdAt,
        isRead: item.isRead,
      })),
    },
    achievementStats,
  };

  const achievements = await buildUserAchievementSummary(user.id, baseOverview);

  return {
    ...baseOverview,
    achievements,
  };
}
