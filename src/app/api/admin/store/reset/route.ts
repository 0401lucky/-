// src/app/api/admin/store/reset/route.ts
// 临时 API：重置商店商品为默认配置

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { getAuthUser, isAdmin } from '@/lib/auth';

const STORE_ITEMS_KEY = 'store:items';

export async function POST() {
  // 验证管理员权限
  const user = await getAuthUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  // 删除现有商品数据
  await kv.del(STORE_ITEMS_KEY);

  return NextResponse.json({ 
    success: true, 
    message: '商店商品已重置，下次访问商店将自动初始化新配置' 
  });
}
