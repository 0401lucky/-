import { NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import {
  getCustomUserProfile,
  updateCustomUserProfile,
  validateAvatarValue,
  validateDisplayName,
  validateQqEmail,
} from '@/lib/user-profile';
import { getEquippedAchievementForUser } from '@/lib/user-achievements';
import {
  buildKvUnavailablePayload,
  getKvErrorInsight,
  KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
} from '@/lib/kv';
import type { PublicAchievement } from '@/lib/profile-achievements';

export const dynamic = 'force-dynamic';

// 复用 profile:overview 的限流配置（每分钟 30 次）
export const GET = withUserRateLimit(
  'profile:overview',
  async (_request, user) => {
    try {
      const [profileResult, achievementResult] = await Promise.allSettled([
        getCustomUserProfile(user.id),
        getEquippedAchievementForUser(user.id),
      ]);
      if (profileResult.status === 'rejected') {
        throw profileResult.reason;
      }
      if (achievementResult.status === 'rejected') {
        console.error('Get equipped achievement for profile settings error:', achievementResult.reason);
      }

      const profile = profileResult.value;
      const equippedAchievement: PublicAchievement | null =
        achievementResult.status === 'fulfilled' ? achievementResult.value : null;

      return NextResponse.json({
        success: true,
        data: {
          displayName: profile.displayName ?? null,
          avatarUrl: profile.avatarUrl ?? null,
          qqEmail: profile.qqEmail ?? null,
          equippedAchievement,
          updatedAt: profile.updatedAt ?? null,
        },
      });
    } catch (error) {
      console.error('Get user profile settings error:', error);
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload('个人资料服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }
      return NextResponse.json(
        { success: false, message: '获取个人资料失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);

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

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, message: '请求体格式无效' },
        { status: 400 }
      );
    }

    const payload = body as Record<string, unknown>;
    const patch: { displayName?: string | null; avatarUrl?: string | null; qqEmail?: string | null } = {};

    if ('displayName' in payload) {
      const result = validateDisplayName(payload.displayName);
      if (!result.valid) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }
      patch.displayName = result.value;
    }

    if ('avatarUrl' in payload) {
      const result = validateAvatarValue(payload.avatarUrl);
      if (!result.valid) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }
      patch.avatarUrl = result.value;
    }

    if ('qqEmail' in payload) {
      const result = validateQqEmail(payload.qqEmail);
      if (!result.valid) {
        return NextResponse.json(
          { success: false, message: result.message },
          { status: 400 }
        );
      }
      patch.qqEmail = result.value;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { success: false, message: '未提供任何可更新字段' },
        { status: 400 }
      );
    }

    try {
      const updated = await updateCustomUserProfile(user.id, patch);
      return NextResponse.json({
        success: true,
        data: {
          displayName: updated.displayName ?? null,
          avatarUrl: updated.avatarUrl ?? null,
          qqEmail: updated.qqEmail ?? null,
          updatedAt: updated.updatedAt ?? null,
        },
      });
    } catch (error) {
      console.error('Update user profile settings error:', error);
      const kvInsight = getKvErrorInsight(error);
      if (kvInsight.isUnavailable) {
        return NextResponse.json(
          buildKvUnavailablePayload('个人资料服务暂时不可用，请稍后重试'),
          {
            status: 503,
            headers: {
              'Retry-After': KV_UNAVAILABLE_RETRY_AFTER_SECONDS.toString(),
            },
          }
        );
      }
      return NextResponse.json(
        { success: false, message: '更新个人资料失败' },
        { status: 500 }
      );
    }
  },
  { unauthorizedMessage: '请先登录' }
);
