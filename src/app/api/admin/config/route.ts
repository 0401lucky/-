// src/app/api/admin/config/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { getSystemConfig, updateSystemConfig } from '@/lib/config';

// GET - 获取系统配置
export async function GET() {
  const user = await getAuthUser();
  
  if (!user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const config = await getSystemConfig();
    
    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('Get config error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// PUT - 更新系统配置
export async function PUT(request: NextRequest) {
  const user = await getAuthUser();
  
  if (!user?.isAdmin) {
    return NextResponse.json({ error: '无权限' }, { status: 403 });
  }

  try {
    const body = await request.json();
    
    // 验证参数
    const updates: Record<string, unknown> = {};
    
    if (body.dailyPointsLimit !== undefined) {
      const limit = Number(body.dailyPointsLimit);
      if (!Number.isInteger(limit) || limit < 100 || limit > 100000) {
        return NextResponse.json({
          success: false,
          message: '每日积分上限必须在 100 - 100000 之间',
        }, { status: 400 });
      }
      updates.dailyPointsLimit = limit;
    }
    
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({
        success: false,
        message: '没有可更新的配置',
      }, { status: 400 });
    }
    
    const config = await updateSystemConfig(updates, user.username);
    
    return NextResponse.json({
      success: true,
      config,
      message: '配置已更新',
    });
  } catch (error) {
    console.error('Update config error:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
