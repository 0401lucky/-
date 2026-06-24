import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/api-guards';
import {
  getEcoAdminOverview,
  updateEcoPrizeRateSettings,
} from '@/lib/eco';

export const dynamic = 'force-dynamic';

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export const GET = withAdmin(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const trashPage = parsePage(searchParams.get('trashPage') ?? searchParams.get('page'));
    const data = await getEcoAdminOverview({ trashPage, trashLimit: 10 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Get eco admin overview error:', error);
    return NextResponse.json(
      { success: false, message: '获取环保管理数据失败' },
      { status: 500 },
    );
  }
});

export const PATCH = withAdmin(async (request: NextRequest) => {
  try {
    const body = (await request.json()) as { prizeRates?: unknown };
    const prizes = await updateEcoPrizeRateSettings(body?.prizeRates);
    return NextResponse.json({ success: true, data: { prizes } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存环保奖品概率失败';
    return NextResponse.json(
      { success: false, message },
      { status: 400 },
    );
  }
});
