// src/app/api/admin/store/reset/route.ts
// 临时 API：重置商店商品为默认配置

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { withAdmin } from '@/lib/api-guards';

const STORE_ITEMS_KEY = 'store:items';

export const POST = withAdmin(
  async () => {
    // 删除现有商品数据
    await kv.del(STORE_ITEMS_KEY);

    return NextResponse.json({ 
      success: true, 
      message: '商店商品已重置，下次访问商店将自动初始化新配置' 
    });
  },
  { forbiddenMessage: '无权限' }
);
