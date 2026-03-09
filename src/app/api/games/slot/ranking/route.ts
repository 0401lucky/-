import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/d1-kv';
import { getTodayDateString } from '@/lib/time';

const PUBLIC_RANKING_CACHE_CONTROL = 'public, max-age=15, stale-while-revalidate=45';

const SLOT_RANK_DAILY_KEY = (date: string) => `slot:rank:daily:${date}`;

interface LeaderboardEntry {
  userId: number;
  username: string;
  score: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get('limit') ?? 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.trunc(limitRaw))) : 10;

    const date = searchParams.get('date') || getTodayDateString();

    const raw = await kv.zrange<string | number>(
      SLOT_RANK_DAILY_KEY(date),
      0,
      limit - 1,
      { rev: true, withScores: true }
    );

    const pairs: Array<{ userId: number; score: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      const member = raw[i];
      const score = raw[i + 1];
      if (member === undefined || score === undefined) continue;

      const memberStr = typeof member === 'string' ? member : String(member);
      const match = memberStr.match(/^u:(\d+)$/);
      const userId = match ? Number(match[1]) : Number(memberStr);
      const scoreNum = typeof score === 'number' ? score : Number(score);

      if (!Number.isFinite(userId) || !Number.isFinite(scoreNum)) continue;
      pairs.push({ userId, score: scoreNum });
    }

    const users = await Promise.all(
      pairs.map(async ({ userId, score }) => {
        const u = await kv.get<{ id: number; username: string }>(`user:${userId}`);
        const username = u?.username || `#${userId}`;
        return { userId, username, score };
      })
    );

    const leaderboard: LeaderboardEntry[] = users;

    const response = NextResponse.json({
      success: true,
      data: {
        date,
        leaderboard,
      },
    });
    response.headers.set('Cache-Control', PUBLIC_RANKING_CACHE_CONTROL);
    return response;
  } catch (error) {
    console.error('Get slot ranking error:', error);
    return NextResponse.json({ success: false, message: '获取排行榜失败' }, { status: 500 });
  }
}

