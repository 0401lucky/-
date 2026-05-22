import { NextResponse } from 'next/server';
import { getProfileOverview } from '@/lib/profile';
import { isAchievementId, type AchievementId } from '@/lib/profile-achievements';
import { setEquippedAchievement } from '@/lib/user-achievements';
import { withUserRateLimit } from '@/lib/rate-limit';
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';

export const dynamic = 'force-dynamic';

export const PUT = withUserRateLimit(
  'profile:overview',
  async (request, user) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, message: '请求体格式无效' },
        { status: 400 }
      );
    }

    const payload = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const achievementId = payload.achievementId ?? null;
    if (achievementId !== null && !isAchievementId(achievementId)) {
      return NextResponse.json(
        { success: false, message: '未知成就' },
        { status: 400 }
      );
    }
    const safeAchievementId: AchievementId | null = achievementId === null ? null : achievementId;

    try {
      const overview = await getProfileOverview({
        id: user.id,
        username: user.username,
      });
      const equipped = await setEquippedAchievement(
        user.id,
        safeAchievementId,
        overview.achievements.items
      );

      return NextResponse.json({
        success: true,
        data: {
          equippedId: equipped?.id ?? null,
          equipped,
        },
      });
    } catch (error) {
      console.error('Equip profile achievement error:', error);
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload('成就服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: error instanceof Error ? error.message : '佩戴成就失败',
        },
        { status: 400 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
