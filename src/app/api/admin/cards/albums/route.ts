import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getAuthUser, isAdmin } from '@/lib/auth';
import { ALBUMS } from '@/lib/cards/config';
import { COLLECTION_REWARDS } from '@/lib/cards/constants';
import { getAllTierRewards, setTierReward, RewardTier } from '@/lib/cards/albumRewards';

export const dynamic = 'force-dynamic';

const ALBUM_REWARDS_KEY = 'cards:album_rewards';

const TIER_NAMES: Record<RewardTier, string> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  legendary_rare: '传说稀有',
  full_set: '全套',
};

// GET: 获取所有卡册及其奖励，以及稀有度奖励
export async function GET() {
  const user = await getAuthUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
  }

  try {
    // 从Redis获取自定义卡册奖励
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

    // 获取稀有度奖励
    const tierRewards = await getAllTierRewards();
    const tiers = (['common', 'rare', 'epic', 'legendary', 'legendary_rare'] as RewardTier[]).map(tier => ({
      id: tier,
      name: TIER_NAMES[tier],
      defaultReward: COLLECTION_REWARDS[tier],
      currentReward: tierRewards[tier],
    }));

    return NextResponse.json({ success: true, albums, tiers });
  } catch (error) {
    console.error('Get albums error:', error);
    return NextResponse.json({ success: false, message: '获取失败' }, { status: 500 });
  }
}

// POST: 更新卡册奖励或稀有度奖励
export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ success: false, message: '无权限' }, { status: 403 });
  }

  try {
    const { albumId, tierId, reward } = await request.json();

    // 验证奖励值
    if (typeof reward !== 'number' || reward < 0) {
      return NextResponse.json({ success: false, message: '奖励值无效' }, { status: 400 });
    }

    // 更新稀有度奖励
    if (tierId) {
      const validTiers: RewardTier[] = ['common', 'rare', 'epic', 'legendary', 'legendary_rare'];
      if (!validTiers.includes(tierId)) {
        return NextResponse.json({ success: false, message: '稀有度类型无效' }, { status: 400 });
      }
      await setTierReward(tierId, reward);
      return NextResponse.json({
        success: true,
        message: '稀有度奖励更新成功',
        data: { tierId, reward }
      });
    }

    // 更新卡册奖励
    if (albumId) {
      const album = ALBUMS.find(a => a.id === albumId);
      if (!album) {
        return NextResponse.json({ success: false, message: '卡册不存在' }, { status: 404 });
      }

      const customRewards = await kv.get<Record<string, number>>(ALBUM_REWARDS_KEY) || {};
      customRewards[albumId] = reward;
      await kv.set(ALBUM_REWARDS_KEY, customRewards);

      return NextResponse.json({
        success: true,
        message: '卡册奖励更新成功',
        data: { albumId, reward }
      });
    }

    return NextResponse.json({ success: false, message: '缺少albumId或tierId参数' }, { status: 400 });
  } catch (error) {
    console.error('Update reward error:', error);
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 });
  }
}
