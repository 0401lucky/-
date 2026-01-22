// src/app/api/store/admin/route.ts
// 商品管理 API（管理员）

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isAdmin } from '@/lib/auth';
import {
  getAllStoreItems,
  createStoreItem,
  updateStoreItem,
  deleteStoreItem,
} from '@/lib/store';
import type { StoreItemType } from '@/lib/types/store';

// 统一响应格式
function jsonResponse(
  data: { success: boolean; data?: unknown; message?: string },
  status = 200
) {
  return NextResponse.json(data, { status });
}

// 验证管理员权限
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

// 验证商品类型
function isValidItemType(type: unknown): type is StoreItemType {
  return type === 'lottery_spin' || type === 'quota_direct';
}

/**
 * GET - 获取所有商品（含下架）
 */
export async function GET() {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const items = await getAllStoreItems();
    return jsonResponse({ success: true, data: { items } });
  } catch (error) {
    console.error('Get all store items error:', error);
    return jsonResponse({ success: false, message: '获取商品列表失败' }, 500);
  }
}

/**
 * POST - 创建商品
 */
export async function POST(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    
    // 验证必填字段
    const { name, description, type, pointsCost, value, sortOrder, enabled } = body;
    
    if (typeof name !== 'string' || name.trim() === '') {
      return jsonResponse({ success: false, message: '商品名称不能为空' }, 400);
    }
    if (typeof description !== 'string') {
      return jsonResponse({ success: false, message: '商品描述不能为空' }, 400);
    }
    if (!isValidItemType(type)) {
      return jsonResponse({ success: false, message: '商品类型无效，必须是 lottery_spin 或 quota_direct' }, 400);
    }
    if (typeof pointsCost !== 'number' || !Number.isSafeInteger(pointsCost) || pointsCost < 1) {
      return jsonResponse({ success: false, message: '积分价格必须是正整数（≥1）' }, 400);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return jsonResponse({ success: false, message: '获得数值必须是正数' }, 400);
    }
    if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
      return jsonResponse({ success: false, message: '排序权重必须是数字' }, 400);
    }
    if (typeof enabled !== 'boolean') {
      return jsonResponse({ success: false, message: '上架状态必须是布尔值' }, 400);
    }

    // 可选字段验证
    let dailyLimit: number | undefined;
    if (body.dailyLimit !== undefined) {
      if (typeof body.dailyLimit !== 'number' || !Number.isFinite(body.dailyLimit) || body.dailyLimit < 0) {
        return jsonResponse({ success: false, message: '每日限购必须是非负整数' }, 400);
      }
      dailyLimit = body.dailyLimit > 0 ? body.dailyLimit : undefined;
    }

    const item = await createStoreItem({
      name: name.trim(),
      description: description.trim(),
      type,
      pointsCost: pointsCost,
      value,
      sortOrder: Math.floor(sortOrder),
      enabled,
      dailyLimit,
    });

    return jsonResponse({ success: true, data: { item }, message: '商品创建成功' });
  } catch (error) {
    console.error('Create store item error:', error);
    return jsonResponse({ success: false, message: '创建商品失败' }, 500);
  }
}

/**
 * PUT - 更新商品
 */
export async function PUT(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    
    // 验证 id
    const { id } = body;
    if (typeof id !== 'string' || id.trim() === '') {
      return jsonResponse({ success: false, message: '商品 ID 不能为空' }, 400);
    }

    // 构建更新对象，只包含提供的字段
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return jsonResponse({ success: false, message: '商品名称不能为空' }, 400);
      }
      updates.name = body.name.trim();
    }

    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return jsonResponse({ success: false, message: '商品描述必须是字符串' }, 400);
      }
      updates.description = body.description.trim();
    }

    if (body.type !== undefined) {
      if (!isValidItemType(body.type)) {
        return jsonResponse({ success: false, message: '商品类型无效' }, 400);
      }
      updates.type = body.type;
    }

    if (body.pointsCost !== undefined) {
      if (typeof body.pointsCost !== 'number' || !Number.isSafeInteger(body.pointsCost) || body.pointsCost < 1) {
        return jsonResponse({ success: false, message: '积分价格必须是正整数（≥1）' }, 400);
      }
      updates.pointsCost = body.pointsCost;
    }

    if (body.value !== undefined) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value <= 0) {
        return jsonResponse({ success: false, message: '获得数值必须是正数' }, 400);
      }
      updates.value = body.value;
    }

    if (body.sortOrder !== undefined) {
      if (typeof body.sortOrder !== 'number' || !Number.isFinite(body.sortOrder)) {
        return jsonResponse({ success: false, message: '排序权重必须是数字' }, 400);
      }
      updates.sortOrder = Math.floor(body.sortOrder);
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return jsonResponse({ success: false, message: '上架状态必须是布尔值' }, 400);
      }
      updates.enabled = body.enabled;
    }

    if (body.dailyLimit !== undefined) {
      if (body.dailyLimit === null || body.dailyLimit === 0) {
        updates.dailyLimit = undefined;
      } else if (typeof body.dailyLimit !== 'number' || !Number.isFinite(body.dailyLimit) || body.dailyLimit < 0) {
        return jsonResponse({ success: false, message: '每日限购必须是非负整数' }, 400);
      } else {
        updates.dailyLimit = body.dailyLimit;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, message: '没有提供更新字段' }, 400);
    }

    const item = await updateStoreItem(id, updates);
    if (!item) {
      return jsonResponse({ success: false, message: '商品不存在' }, 404);
    }

    return jsonResponse({ success: true, data: { item }, message: '商品更新成功' });
  } catch (error) {
    console.error('Update store item error:', error);
    return jsonResponse({ success: false, message: '更新商品失败' }, 500);
  }
}

/**
 * DELETE - 删除商品
 */
export async function DELETE(request: NextRequest) {
  const auth = await checkAdmin();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    const body = await request.json();
    
    const { id } = body;
    if (typeof id !== 'string' || id.trim() === '') {
      return jsonResponse({ success: false, message: '商品 ID 不能为空' }, 400);
    }

    const deleted = await deleteStoreItem(id);
    if (!deleted) {
      return jsonResponse({ success: false, message: '商品不存在' }, 404);
    }

    return jsonResponse({ success: true, message: '商品删除成功' });
  } catch (error) {
    console.error('Delete store item error:', error);
    return jsonResponse({ success: false, message: '删除商品失败' }, 500);
  }
}
