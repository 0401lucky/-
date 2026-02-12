import { kv } from '@vercel/kv';
import { ALBUMS, CARDS } from './cards/config';
import { getUserCardData } from './cards/draw';
import { getPointsLogs, getUserPoints } from './points';
import { getCheckinStreak } from './rankings';
import { listUserNotifications } from './notifications';

type ProfileGameType = 'slot' | 'linkgame' | 'match3' | 'memory' | 'pachinko' | 'tower' | 'lottery';

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
}

const GAME_RECORD_KEYS: Array<{ type: ProfileGameType; key: (userId: number) => string }> = [
  { type: 'slot', key: (userId) => `slot:records:${userId}` },
  { type: 'linkgame', key: (userId) => `linkgame:records:${userId}` },
  { type: 'match3', key: (userId) => `match3:records:${userId}` },
  { type: 'memory', key: (userId) => `memory:records:${userId}` },
  { type: 'pachinko', key: (userId) => `game:records:${userId}` },
  { type: 'tower', key: (userId) => `tower:records:${userId}` },
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
  const rows: ProfileRecentRecord[] = [];

  for (const item of GAME_RECORD_KEYS) {
    const records = await kv.lrange<unknown[]>(item.key(userId), 0, readSize - 1);
    for (const raw of records ?? []) {
      const row = mapRecentRecord(item.type, raw);
      if (row) {
        rows.push(row);
      }
    }
  }

  return rows
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
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
    recentRecords,
    notificationResult,
  ] = await Promise.all([
    getUserPoints(user.id),
    getPointsLogs(user.id, 10),
    getUserCardData(String(user.id)),
    getCheckinStreak(user.id, 'all'),
    getRecentRecords(user.id, 10),
    listUserNotifications(user.id, { page: 1, limit: 5 }),
  ]);

  const albums = buildAlbumProgress(cardData.inventory);
  const totalCards = CARDS.length;
  const ownedCards = new Set(cardData.inventory).size;
  const completionRate = totalCards > 0 ? Math.min(100, Math.round((ownedCards / totalCards) * 10000) / 100) : 0;

  return {
    user: {
      id: user.id,
      username: user.username,
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
  };
}
