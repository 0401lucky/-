import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { dispatchPet, getFarmStatus } from '@/lib/farm-v2';
import type { PetTask } from '@/lib/types/farm-v2';

const ALLOWED: Exclude<PetTask, null>[] = ['water', 'guard', 'chase_crow', 'harvest', 'plant'];

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { task?: Exclude<PetTask, null> } | null;
      if (!body || !ALLOWED.includes(body.task as Exclude<PetTask, null>)) {
        return NextResponse.json({ success: false, message: '任务参数无效' }, { status: 400 });
      }
      const r = await dispatchPet(user.id, body.task as Exclude<PetTask, null>);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, message: r.msg });
    } catch (e) {
      console.error('farm v2 pet dispatch error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
