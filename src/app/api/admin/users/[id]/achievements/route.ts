import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import type { AuthUser } from '@/lib/auth';
import { grantUserAchievement, getAdminUserAchievementList, revokeUserAchievement } from '@/lib/user-achievements';
import { isAchievementId, type AchievementId } from '@/lib/profile-achievements';

export const dynamic = 'force-dynamic';

const ADMIN_GRANTABLE_ACHIEVEMENTS = new Set<AchievementId>(['contributor']);

function parseUserId(value: string): number | null {
  const userId = Number(value);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

export const POST = withAdmin(async (
  request: NextRequest,
  admin: AuthUser,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;
    const userId = parseUserId(id);
    if (userId === null) {
      return NextResponse.json(
        { success: false, message: '无效的用户ID' },
        { status: 400 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      achievementId?: unknown;
      action?: unknown;
      reason?: unknown;
    } | null;
    const action = body?.action === 'revoke' ? 'revoke' : 'grant';
    const achievementId = body?.achievementId;

    if (!isAchievementId(achievementId) || !ADMIN_GRANTABLE_ACHIEVEMENTS.has(achievementId)) {
      return NextResponse.json(
        { success: false, message: '该成就不支持手动颁发' },
        { status: 400 }
      );
    }

    if (action === 'grant') {
      await grantUserAchievement(userId, achievementId, {
        source: 'admin',
        grantedBy: {
          id: admin.id,
          username: admin.username,
        },
        reason: typeof body?.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : '管理员确认该用户提出 10 条或以上有用反馈',
      });
    } else {
      await revokeUserAchievement(userId, achievementId);
    }

    return NextResponse.json({
      success: true,
      message: action === 'grant' ? '成就颁发成功' : '成就已撤销',
      achievements: await getAdminUserAchievementList(userId),
    });
  } catch (error) {
    console.error('Update admin user achievement error:', error);
    return NextResponse.json(
      { success: false, message: '成就操作失败' },
      { status: 500 }
    );
  }
});
