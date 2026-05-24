import { NextResponse } from 'next/server';
import { withAuthenticatedUser } from '@/lib/rate-limit';
import { getUserPoints } from '@/lib/points';
import { getDailyStats } from '@/lib/daily-stats';
import { getMatch3Records } from '@/lib/match3';
import { MATCH3_WIN_SCORE } from '@/lib/match3-engine';
import { getMinesweeperRecords } from '@/lib/minesweeper';
import { getMemoryRecords } from '@/lib/memory';
import { getWhackMoleRecords } from '@/lib/whack-mole';
import { getWhackMoleDifficultyConfig, normalizeWhackMoleDifficulty } from '@/lib/whack-mole-engine';
import { getRogueliteRecords } from '@/lib/roguelite';
import { getLinkGameRecords } from '@/lib/linkgame-server';

type GameKey = 'roguelite' | 'minesweeper' | 'whack-mole' | 'memory' | 'match3' | 'linkgame';

interface GameProgress {
  totalPlays: number;
  bestScore: number;
  totalPointsEarned: number;
  /** 是否有 win/completed 维度 */
  hasWinFlag: boolean;
  wins: number;
  /** 最长连胜场数（在 hasWinFlag 的游戏里有效） */
  bestWinStreak: number;
}

interface ProfileResponse {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  totalGamesPlayed: number;
  /** 历史最高单局分数（跨所有游戏） */
  peakScore: number;
  peakGame: GameKey | null;
  /** 玩得最多的游戏 */
  favoriteGame: GameKey | null;
  /** 胜利场数最多的游戏 */
  mostWinsGame: GameKey | null;
  mostWinsCount: number;
  /** 连胜最多的游戏 */
  bestStreakGame: GameKey | null;
  bestStreak: number;
  /** 胜率：在有 win/completed 标志的游戏里 wins / plays */
  winRate: number;
  perGame: Record<GameKey, GameProgress>;
}

const RECORD_FETCH_LIMIT = 50;

function computeBestStreak<T>(records: readonly T[], isWin: (record: T) => boolean): number {
  let best = 0;
  let current = 0;
  for (const record of records) {
    if (isWin(record)) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

async function getLinkGameProgress(userId: number): Promise<GameProgress> {
  const records = await getLinkGameRecords(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => r.completed;
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

async function getMatch3Progress(userId: number): Promise<GameProgress> {
  const records = await getMatch3Records(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => r.score >= MATCH3_WIN_SCORE;
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

async function getMemoryProgress(userId: number): Promise<GameProgress> {
  const records = await getMemoryRecords(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => r.completed;
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

async function getMinesweeperProgress(userId: number): Promise<GameProgress> {
  const records = await getMinesweeperRecords(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => r.won;
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

async function getRogueliteProgress(userId: number): Promise<GameProgress> {
  const records = await getRogueliteRecords(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => r.won;
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

async function getWhackMoleProgress(userId: number): Promise<GameProgress> {
  const records = await getWhackMoleRecords(userId, RECORD_FETCH_LIMIT);
  const isWin = (r: (typeof records)[number]) => {
    const difficulty = normalizeWhackMoleDifficulty(r.difficulty);
    return r.score >= getWhackMoleDifficultyConfig(difficulty).winScore;
  };
  return {
    totalPlays: records.length,
    bestScore: records.reduce((m, r) => Math.max(m, r.score), 0),
    totalPointsEarned: records.reduce((s, r) => s + r.pointsEarned, 0),
    hasWinFlag: true,
    wins: records.filter(isWin).length,
    bestWinStreak: computeBestStreak(records, isWin),
  };
}

export const GET = withAuthenticatedUser(
  async (_request, user) => {
    try {
      const [
        balance,
        dailyStats,
        linkgameP,
        match3P,
        memoryP,
        minesweeperP,
        rogueliteP,
        whackMoleP,
      ] = await Promise.all([
        getUserPoints(user.id),
        getDailyStats(user.id),
        getLinkGameProgress(user.id),
        getMatch3Progress(user.id),
        getMemoryProgress(user.id),
        getMinesweeperProgress(user.id),
        getRogueliteProgress(user.id),
        getWhackMoleProgress(user.id),
      ]);

      const perGame: Record<GameKey, GameProgress> = {
        linkgame: linkgameP,
        match3: match3P,
        memory: memoryP,
        minesweeper: minesweeperP,
        roguelite: rogueliteP,
        'whack-mole': whackMoleP,
      };

      let peakScore = 0;
      let peakGame: GameKey | null = null;
      let mostPlays = 0;
      let favoriteGame: GameKey | null = null;
      let mostWinsCount = 0;
      let mostWinsGame: GameKey | null = null;
      let bestStreak = 0;
      let bestStreakGame: GameKey | null = null;
      let totalPlays = 0;
      let weightedPlaysForWin = 0;
      let weightedWins = 0;

      (Object.keys(perGame) as GameKey[]).forEach((key) => {
        const p = perGame[key];
        totalPlays += p.totalPlays;
        if (p.bestScore > peakScore) {
          peakScore = p.bestScore;
          peakGame = key;
        }
        if (p.totalPlays > mostPlays) {
          mostPlays = p.totalPlays;
          favoriteGame = key;
        }
        if (p.hasWinFlag) {
          weightedPlaysForWin += p.totalPlays;
          weightedWins += p.wins;
          if (p.wins > mostWinsCount) {
            mostWinsCount = p.wins;
            mostWinsGame = key;
          }
          if (p.bestWinStreak > bestStreak) {
            bestStreak = p.bestWinStreak;
            bestStreakGame = key;
          }
        }
      });

      const winRate = weightedPlaysForWin > 0 ? weightedWins / weightedPlaysForWin : 0;

      const data: ProfileResponse = {
        balance,
        dailyStats: {
          gamesPlayed: dailyStats.gamesPlayed,
          pointsEarned: dailyStats.pointsEarned,
        },
        totalGamesPlayed: totalPlays,
        peakScore,
        peakGame,
        favoriteGame,
        mostWinsGame,
        mostWinsCount,
        bestStreakGame,
        bestStreak,
        winRate,
        perGame,
      };

      return NextResponse.json({ success: true, data });
    } catch (error) {
      console.error('Get games profile error:', error);
      return NextResponse.json(
        { success: false, message: '获取个人战绩失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '未登录' }
);
