import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isAdmin } from '@/lib/auth';
import { getSlotConfig, updateSlotConfig } from '@/lib/slot-config';

function jsonResponse(
  data: { success: boolean; data?: unknown; message?: string },
  status = 200
) {
  return NextResponse.json(data, { status });
}

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

export async function GET() {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const config = await getSlotConfig();
    return jsonResponse({ success: true, data: { config } });
  } catch (error) {
    console.error('Get slot config error:', error);
    return jsonResponse({ success: false, message: '获取老虎机配置失败' }, 500);
  }
}

export async function PUT(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();

    const updates: Record<string, unknown> = {};

    if (body.betModeEnabled !== undefined) {
      if (typeof body.betModeEnabled !== 'boolean') {
        return jsonResponse({ success: false, message: 'betModeEnabled 必须是 boolean' }, 400);
      }
      updates.betModeEnabled = body.betModeEnabled;
    }

    if (body.betCost !== undefined) {
      const betCost = Number(body.betCost);
      if (!Number.isInteger(betCost) || betCost < 1 || betCost > 100000) {
        return jsonResponse({ success: false, message: 'betCost 必须在 1 - 100000 之间' }, 400);
      }
      updates.betCost = betCost;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, message: '没有可更新的配置' }, 400);
    }

    const user = auth.user!;
    const config = await updateSlotConfig(updates, user.username);
    return jsonResponse({ success: true, data: { config }, message: '配置已更新' });
  } catch (error) {
    console.error('Update slot config error:', error);
    return jsonResponse({ success: false, message: '更新老虎机配置失败' }, 500);
  }
}

