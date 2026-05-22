import { NextRequest, NextResponse } from 'next/server';
import { withUserRateLimit } from '@/lib/rate-limit';
import { adoptPet, getFarmStatus } from '@/lib/farm-v2';
import type { PetType } from '@/lib/types/farm-v2';

const PET_TYPES: PetType[] = ['cat', 'dog', 'rabbit', 'red_panda'];

export const POST = withUserRateLimit(
  'farm:action',
  async (req: NextRequest, user) => {
    try {
      const body = await req.json().catch(() => null) as { type?: PetType; name?: string } | null;
      if (!body || !PET_TYPES.includes(body.type as PetType)) {
        return NextResponse.json({ success: false, message: '参数无效' }, { status: 400 });
      }
      const r = await adoptPet(user.id, body.type as PetType, body.name);
      if (!r.ok) return NextResponse.json({ success: false, message: r.msg }, { status: 400 });
      const data = await getFarmStatus(user.id);
      return NextResponse.json({ success: true, data, balance: r.balance });
    } catch (e) {
      console.error('farm v2 pet adopt error:', e);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  },
  { unauthorizedMessage: '请先登录' },
);
