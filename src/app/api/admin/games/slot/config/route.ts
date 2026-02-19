import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import { getSlotConfig, updateSlotConfig } from '@/lib/slot-config';
import { SLOT_BET_OPTIONS } from '@/lib/slot-constants';

function jsonResponse(
  data: { success: boolean; data?: unknown; message?: string },
  status = 200
) {
  return NextResponse.json(data, { status });
}

export const GET = withAdmin(async () => {
  try {
    const config = await getSlotConfig();
    return jsonResponse({ success: true, data: { config } });
  } catch (error) {
    console.error('Get slot config error:', error);
    return jsonResponse({ success: false, message: '获取老虎机配置失败' }, 500);
  }
});

export const PUT = withAdmin(async (request: NextRequest, user) => {
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
      if (!Number.isInteger(betCost) || !SLOT_BET_OPTIONS.includes(betCost as (typeof SLOT_BET_OPTIONS)[number])) {
        return jsonResponse(
          { success: false, message: `betCost 仅支持：${SLOT_BET_OPTIONS.join(' / ')}` },
          400
        );
      }
      updates.betCost = betCost;
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, message: '没有可更新的配置' }, 400);
    }

    const config = await updateSlotConfig(updates, user.username);
    return jsonResponse({ success: true, data: { config }, message: '配置已更新' });
  } catch (error) {
    console.error('Update slot config error:', error);
    return jsonResponse({ success: false, message: '更新老虎机配置失败' }, 500);
  }
});
