import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { cookies } from 'next/headers';
import { ALBUMS } from '@/lib/cards/config';

const ALBUM_REWARDS_KEY = 'cards:album_rewards';

interface User {
  id: number;
  username: string;
  isAdmin: boolean;
}

async function getUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('session_id')?.value;
  if (!sessionId) return null;
  return kv.get<User>(`session:${sessionId}`);
}

// GET: 获取所有卡册及其奖励
export async function GET() {
  const user = await getUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
  }

  try {
    // 从Redis获取自定义奖励
    const customRewards = await kv.get<Record<string, number>>(ALBUM_REWARDS_KEY) || {};

    // 合并默认奖励和自定义奖励
    const albums = ALBUMS.map(album => ({
      id: album.id,
      name: album.name,
      description: album.description,
      season: album.season,
      defaultReward: album.reward,
      currentReward: customRewards[album.id] ?? album.reward,
    }));

    return NextResponse.json({ success: true, albums });
  } catch (error) {
    console.error('Get albums error:', error);
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 });
  }
}

// POST: 更新卡册奖励
export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user?.isAdmin) {
    return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
  }

  try {
    const { albumId, reward } = await request.json();

    // 验证参数
    if (!albumId || typeof reward !== 'number' || reward < 0) {
      return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
    }

    // 验证卡册存在
    const album = ALBUMS.find(a => a.id === albumId);
    if (!album) {
      return NextResponse.json({ success: false, message: '卡册不存在' }, { status: 404 });
    }

    // 获取现有自定义奖励
    const customRewards = await kv.get<Record<string, number>>(ALBUM_REWARDS_KEY) || {};

    // 更新奖励
    customRewards[albumId] = reward;

    // 保存到Redis
    await kv.set(ALBUM_REWARDS_KEY, customRewards);

    return NextResponse.json({
      success: true,
      message: '更新成功',
      data: { albumId, reward }
    });
  } catch (error) {
    console.error('Update album reward error:', error);
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 });
  }
}
