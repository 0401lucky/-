// src/app/api/admin/store/reset/route.ts
// 临时 API：重置商店商品为默认配置

import { NextResponse } from 'next/server';
import { kv } from '@/lib/d1-kv';
import { withAdmin } from '@/lib/api-guards';
import { getRuntimeEnvValue, sanitizeRuntimeEnvValue } from '@/lib/runtime-env';

const STORE_ITEMS_KEY = 'store:items';

function isStoreResetEnabled(): boolean {
  return sanitizeRuntimeEnvValue(getRuntimeEnvValue('ENABLE_ADMIN_STORE_RESET')) === 'true';
}

export const POST = withAdmin(
  async () => {
    if (!isStoreResetEnabled()) {
      return NextResponse.json(
        { success: false, message: '此接口已禁用。请设置环境变量 ENABLE_ADMIN_STORE_RESET=true 启用。' },
        { status: 403 }
      );
    }

    // 删除现有商品数据
    await kv.del(STORE_ITEMS_KEY);

    return NextResponse.json({ 
      success: true, 
      message: '商店商品已重置，下次访问商店将自动初始化新配置' 
    });
  },
  { forbiddenMessage: '无权限' }
);
