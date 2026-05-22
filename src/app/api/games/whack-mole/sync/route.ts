import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { buildWhackMoleSessionView, getActiveWhackMoleSession } from '@/lib/whack-mole';

export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }

  try {
    const activeSession = await getActiveWhackMoleSession(user.id);
    return NextResponse.json({
      success: true,
      data: activeSession ? buildWhackMoleSessionView(activeSession) : null,
    });
  } catch (error) {
    console.error('Sync whack mole session error:', error);
    return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
  }
}
