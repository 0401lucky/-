// src/app/api/admin/points/route.ts
// 管理员积分调整 API

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isAdmin } from '@/lib/auth';
import { addPoints, deductPoints, getUserPoints, getPointsLogs } from '@/lib/points';

// 统一响应格式
function jsonResponse(
  data: { success: boolean; data?: unknown; message?: string },
  status = 200
) {
  return NextResponse.json(data, { status });
}

// 验证管理员权限
async function checkAdmin() {
  const user = await getAuthUser();
  if (!user) {
    return { authorized: false, response: jsonResponse({ success: false, message: '未登录' }, 401) };
  }
  if (!isAdmin(user)) {
    return { authorized: false, response: jsonResponse({ success: false, message: '无管理员权限' }, 403) };
  }
  return { authorized: true, user };
}

/**
 * GET - 查询用户积分和流水
 * Query params: userId
 */
export async function GET(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const userIdStr = searchParams.get('userId');

  if (!userIdStr) {
    return jsonResponse({ success: false, message: '缺少 userId 参数' }, 400);
  }

  const userId = parseInt(userIdStr, 10);
  if (!Number.isFinite(userId) || userId <= 0) {
    return jsonResponse({ success: false, message: 'userId 必须是正整数' }, 400);
  }

  try {
    const [balance, logs] = await Promise.all([
      getUserPoints(userId),
      // 与 points.ts 的流水保留上限对齐：最多返回最近100条
      getPointsLogs(userId, 100),
    ]);

    return jsonResponse({
      success: true,
      data: { userId, balance, logs },
    });
  } catch (error) {
    console.error('Get user points error:', error);
    return jsonResponse({ success: false, message: '获取积分信息失败' }, 500);
  }
}

/**
 * POST - 调整用户积分
 * Body: { userId: number, amount: number, description: string }
 * amount 为正数时增加，为负数时扣除
 */
export async function POST(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    const { amount, description } = body;
    // 兼容前端/第三方可能把 userId 以字符串传递的情况
    const rawUserId: unknown = body?.userId;
    const userId =
      typeof rawUserId === 'number'
        ? rawUserId
        : typeof rawUserId === 'string'
          ? Number(rawUserId)
          : NaN;

    // 验证 userId
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return jsonResponse({ success: false, message: 'userId 必须是正整数' }, 400);
    }

    // 验证 amount（必须是整数，非零，且在安全范围内）
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount === 0) {
      return jsonResponse({ success: false, message: 'amount 必须是非零整数' }, 400);
    }
    // 限制单次调整上限，防止误操作（可选：最大100万积分）
    if (Math.abs(amount) > 1000000) {
      return jsonResponse({ success: false, message: '单次调整不能超过 1,000,000 积分' }, 400);
    }

    // 验证 description
    if (typeof description !== 'string' || description.trim() === '') {
      return jsonResponse({ success: false, message: '请提供调整原因' }, 400);
    }

    const trimmedDesc = description.trim();
    const adminUser = auth.user!;
    const fullDescription = `[管理员:${adminUser.username}] ${trimmedDesc}`;

    let result: { success: boolean; balance: number; message?: string };

    if (amount > 0) {
      // 增加积分
      const addResult = await addPoints(userId, amount, 'admin_adjust', fullDescription);
      result = { success: true, balance: addResult.balance };
    } else {
      // 扣除积分 (amount 是负数，取绝对值)
      result = await deductPoints(userId, Math.abs(amount), 'admin_adjust', fullDescription);
    }

    if (!result.success) {
      return jsonResponse({ success: false, message: result.message || '操作失败' }, 400);
    }

    return jsonResponse({
      success: true,
      message: amount > 0 ? `已增加 ${amount} 积分` : `已扣除 ${Math.abs(amount)} 积分`,
      data: {
        userId,
        adjustment: amount,
        newBalance: result.balance,
      },
    });
  } catch (error) {
    console.error('Adjust points error:', error);
    return jsonResponse({ success: false, message: '积分调整失败' }, 500);
  }
}
