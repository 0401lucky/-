// src/app/api/games/farm/shop/admin/route.ts - 管理员道具CRUD
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, isAdmin } from '@/lib/auth';
import {
  getAllFarmShopItems,
  getFarmShopItem,
  createFarmShopItem,
  updateFarmShopItem,
  deleteFarmShopItem,
  getFarmShopPurchaseCounts,
} from '@/lib/farm-shop';
import { enforceTrustedApiRequest } from '@/lib/request-security';
import type { FarmItemEffectType, FarmItemMode, FarmShopItem } from '@/lib/types/farm-shop';

function jsonResponse(
  data: { success: boolean; data?: unknown; message?: string },
  status = 200
) {
  return NextResponse.json(data, { status });
}

async function checkAdmin() {
  const user = await getAuthUser();
  if (!user) {
    return { authorized: false as const, response: jsonResponse({ success: false, message: '未登录' }, 401) };
  }
  if (!isAdmin(user)) {
    return { authorized: false as const, response: jsonResponse({ success: false, message: '无管理员权限' }, 403) };
  }
  return { authorized: true as const, user };
}

const VALID_EFFECTS: FarmItemEffectType[] = [
  'auto_water', 'auto_harvest', 'pest_shield', 'weather_shield',
  'yield_bonus', 'growth_speed', 'growth_boost', 'plot_growth_boost',
  'pest_clear', 'random_plant',
];

const VALID_MODES: FarmItemMode[] = ['buff', 'instant'];
const BUFF_EFFECTS: FarmItemEffectType[] = [
  'auto_water',
  'auto_harvest',
  'pest_shield',
  'weather_shield',
  'yield_bonus',
  'growth_speed',
];
const INSTANT_EFFECTS: FarmItemEffectType[] = [
  'growth_boost',
  'plot_growth_boost',
  'pest_clear',
  'random_plant',
];

function isValidEffect(v: unknown): v is FarmItemEffectType {
  return typeof v === 'string' && VALID_EFFECTS.includes(v as FarmItemEffectType);
}

function isValidMode(v: unknown): v is FarmItemMode {
  return typeof v === 'string' && VALID_MODES.includes(v as FarmItemMode);
}

function isSafeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

function validateItemBusinessRules(item: Pick<FarmShopItem, 'effect' | 'mode' | 'durationMs' | 'effectValue' | 'instantValue' | 'maxStack'>): string | null {
  if (item.mode === 'buff' && !BUFF_EFFECTS.includes(item.effect)) {
    return 'Buff 模式不能使用该效果类型';
  }
  if (item.mode === 'instant' && !INSTANT_EFFECTS.includes(item.effect)) {
    return '即时模式不能使用该效果类型';
  }

  if (item.mode === 'buff') {
    if (!isSafeInteger(item.durationMs) || item.durationMs <= 0) {
      return 'Buff 道具持续时间必须是正整数毫秒';
    }
  }

  if (item.maxStack !== undefined && (!isSafeInteger(item.maxStack) || item.maxStack < 1)) {
    return '最大叠加层数必须是大于等于 1 的整数';
  }

  if (item.effect === 'pest_shield' && item.effectValue !== undefined) {
    if (typeof item.effectValue !== 'number' || item.effectValue < 0 || item.effectValue > 1) {
      return '害虫减免比例必须在 0 到 1 之间';
    }
  }

  if (item.effect === 'yield_bonus' && item.effectValue !== undefined) {
    if (typeof item.effectValue !== 'number' || item.effectValue < 0) {
      return '产量加成必须大于等于 0';
    }
  }

  if (item.effect === 'growth_speed' && item.effectValue !== undefined) {
    if (typeof item.effectValue !== 'number' || item.effectValue <= 1) {
      return '生长加速倍率必须大于 1';
    }
  }

  if (
    (item.effect === 'growth_boost' || item.effect === 'plot_growth_boost' || item.effect === 'pest_clear')
    && item.instantValue !== undefined
  ) {
    if (!isSafeInteger(item.instantValue) || item.instantValue <= 0) {
      return '即时数值必须是正整数毫秒';
    }
  }

  return null;
}

/**
 * GET - 获取全部道具 + 购买统计
 */
export async function GET() {
  const auth = await checkAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const items = await getAllFarmShopItems();
    const purchaseCounts = await getFarmShopPurchaseCounts(items.map(i => i.id));

    const itemsWithStats = items.map(item => ({
      ...item,
      purchaseCount: purchaseCounts[item.id] ?? 0,
    }));

    return jsonResponse({ success: true, data: { items: itemsWithStats } });
  } catch (error) {
    console.error('Farm shop admin GET error:', error);
    return jsonResponse({ success: false, message: '获取道具列表失败' }, 500);
  }
}

/**
 * POST - 创建道具
 */
export async function POST(request: NextRequest) {
  const blocked = enforceTrustedApiRequest(request);
  if (blocked) {
    return blocked;
  }

  const auth = await checkAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { name, icon, description, effect, mode, pointsCost, sortOrder, enabled } = body;

    if (typeof name !== 'string' || !name.trim()) {
      return jsonResponse({ success: false, message: '名称不能为空' }, 400);
    }
    if (typeof icon !== 'string' || !icon.trim()) {
      return jsonResponse({ success: false, message: '图标不能为空' }, 400);
    }
    if (typeof description !== 'string') {
      return jsonResponse({ success: false, message: '描述不能为空' }, 400);
    }
    if (!isValidEffect(effect)) {
      return jsonResponse({ success: false, message: '无效的效果类型' }, 400);
    }
    if (!isValidMode(mode)) {
      return jsonResponse({ success: false, message: '无效的道具模式' }, 400);
    }
    if (typeof pointsCost !== 'number' || !Number.isSafeInteger(pointsCost) || pointsCost < 1) {
      return jsonResponse({ success: false, message: '价格必须是正整数' }, 400);
    }
    if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
      return jsonResponse({ success: false, message: '排序权重必须是数字' }, 400);
    }
    if (typeof enabled !== 'boolean') {
      return jsonResponse({ success: false, message: '状态必须是布尔值' }, 400);
    }

    const durationMs = body.durationMs;
    if (durationMs !== undefined && (!isSafeInteger(durationMs) || durationMs <= 0)) {
      return jsonResponse({ success: false, message: '持续时间必须是正整数毫秒' }, 400);
    }

    const effectValue = body.effectValue;
    if (effectValue !== undefined && (typeof effectValue !== 'number' || !Number.isFinite(effectValue))) {
      return jsonResponse({ success: false, message: '效果值必须是数字' }, 400);
    }

    const instantValue = body.instantValue;
    if (instantValue !== undefined && (!isSafeInteger(instantValue) || instantValue <= 0)) {
      return jsonResponse({ success: false, message: '即时值必须是正整数毫秒' }, 400);
    }

    const dailyLimit = body.dailyLimit;
    if (dailyLimit !== undefined && (!isSafeInteger(dailyLimit) || dailyLimit < 1)) {
      return jsonResponse({ success: false, message: '每日限购必须是正整数' }, 400);
    }

    const maxStack = body.maxStack;
    if (maxStack !== undefined && (!isSafeInteger(maxStack) || maxStack < 1)) {
      return jsonResponse({ success: false, message: '最大叠加层数必须是正整数' }, 400);
    }

    const unlockLevel = body.unlockLevel;
    if (unlockLevel !== undefined && (!isSafeInteger(unlockLevel) || unlockLevel < 1 || unlockLevel > 5)) {
      return jsonResponse({ success: false, message: '解锁等级必须是 1-5 的整数' }, 400);
    }

    const ruleError = validateItemBusinessRules({
      effect,
      mode,
      durationMs: durationMs ?? undefined,
      effectValue: effectValue ?? undefined,
      instantValue: instantValue ?? undefined,
      maxStack: maxStack ?? undefined,
    });
    if (ruleError) {
      return jsonResponse({ success: false, message: ruleError }, 400);
    }

    const item = await createFarmShopItem({
      name: name.trim(),
      icon: icon.trim(),
      description: description.trim(),
      effect,
      mode,
      pointsCost,
      durationMs: durationMs ?? undefined,
      effectValue: effectValue ?? undefined,
      instantValue: instantValue ?? undefined,
      dailyLimit: dailyLimit ?? undefined,
      maxStack: maxStack ?? undefined,
      unlockLevel: unlockLevel ?? undefined,
      sortOrder: Math.floor(sortOrder),
      enabled,
    });

    return jsonResponse({ success: true, data: { item }, message: '道具创建成功' });
  } catch (error) {
    console.error('Farm shop admin POST error:', error);
    return jsonResponse({ success: false, message: '创建道具失败' }, 500);
  }
}

/**
 * PUT - 更新道具
 */
export async function PUT(request: NextRequest) {
  const blocked = enforceTrustedApiRequest(request);
  if (blocked) {
    return blocked;
  }

  const auth = await checkAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id } = body;
    if (typeof id !== 'string' || !id.trim()) {
      return jsonResponse({ success: false, message: 'ID 不能为空' }, 400);
    }

    const existing = await getFarmShopItem(id);
    if (!existing) {
      return jsonResponse({ success: false, message: '道具不存在' }, 404);
    }

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return jsonResponse({ success: false, message: '名称不能为空' }, 400);
      }
      updates.name = body.name.trim();
    }
    if (body.icon !== undefined) {
      if (typeof body.icon !== 'string' || !body.icon.trim()) {
        return jsonResponse({ success: false, message: '图标不能为空' }, 400);
      }
      updates.icon = body.icon.trim();
    }
    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return jsonResponse({ success: false, message: '描述必须是字符串' }, 400);
      }
      updates.description = body.description.trim();
    }
    if (body.effect !== undefined) {
      if (!isValidEffect(body.effect)) return jsonResponse({ success: false, message: '无效的效果类型' }, 400);
      updates.effect = body.effect;
    }
    if (body.mode !== undefined) {
      if (!isValidMode(body.mode)) return jsonResponse({ success: false, message: '无效的道具模式' }, 400);
      updates.mode = body.mode;
    }
    if (body.pointsCost !== undefined) {
      if (!isSafeInteger(body.pointsCost) || body.pointsCost < 1) {
        return jsonResponse({ success: false, message: '价格必须是正整数' }, 400);
      }
      updates.pointsCost = body.pointsCost;
    }
    if (body.sortOrder !== undefined) {
      if (typeof body.sortOrder !== 'number' || !Number.isFinite(body.sortOrder)) {
        return jsonResponse({ success: false, message: '排序权重必须是数字' }, 400);
      }
      updates.sortOrder = Math.floor(body.sortOrder);
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return jsonResponse({ success: false, message: '状态必须是布尔值' }, 400);
      }
      updates.enabled = body.enabled;
    }
    if (body.durationMs !== undefined) {
      if (body.durationMs === null) {
        updates.durationMs = undefined;
      } else if (!isSafeInteger(body.durationMs) || body.durationMs <= 0) {
        return jsonResponse({ success: false, message: '持续时间必须是正整数毫秒' }, 400);
      } else {
        updates.durationMs = body.durationMs;
      }
    }
    if (body.effectValue !== undefined) {
      if (body.effectValue === null) {
        updates.effectValue = undefined;
      } else if (typeof body.effectValue !== 'number' || !Number.isFinite(body.effectValue)) {
        return jsonResponse({ success: false, message: '效果值必须是数字' }, 400);
      } else {
        updates.effectValue = body.effectValue;
      }
    }
    if (body.instantValue !== undefined) {
      if (body.instantValue === null) {
        updates.instantValue = undefined;
      } else if (!isSafeInteger(body.instantValue) || body.instantValue <= 0) {
        return jsonResponse({ success: false, message: '即时值必须是正整数毫秒' }, 400);
      } else {
        updates.instantValue = body.instantValue;
      }
    }
    if (body.dailyLimit !== undefined) {
      if (body.dailyLimit === null) {
        updates.dailyLimit = undefined;
      } else if (!isSafeInteger(body.dailyLimit) || body.dailyLimit < 1) {
        return jsonResponse({ success: false, message: '每日限购必须是正整数' }, 400);
      } else {
        updates.dailyLimit = body.dailyLimit;
      }
    }
    if (body.maxStack !== undefined) {
      if (body.maxStack === null) {
        updates.maxStack = undefined;
      } else if (!isSafeInteger(body.maxStack) || body.maxStack < 1) {
        return jsonResponse({ success: false, message: '最大叠加层数必须是正整数' }, 400);
      } else {
        updates.maxStack = body.maxStack;
      }
    }
    if (body.unlockLevel !== undefined) {
      if (body.unlockLevel === null) {
        updates.unlockLevel = undefined;
      } else if (!isSafeInteger(body.unlockLevel) || body.unlockLevel < 1 || body.unlockLevel > 5) {
        return jsonResponse({ success: false, message: '解锁等级必须是 1-5 的整数' }, 400);
      } else {
        updates.unlockLevel = body.unlockLevel;
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ success: false, message: '没有提供更新字段' }, 400);
    }

    const merged = { ...existing, ...updates } as FarmShopItem;
    const ruleError = validateItemBusinessRules({
      effect: merged.effect,
      mode: merged.mode,
      durationMs: merged.durationMs,
      effectValue: merged.effectValue,
      instantValue: merged.instantValue,
      maxStack: merged.maxStack,
    });
    if (ruleError) {
      return jsonResponse({ success: false, message: ruleError }, 400);
    }

    const item = await updateFarmShopItem(id, updates);
    if (!item) {
      return jsonResponse({ success: false, message: '道具不存在' }, 404);
    }
    return jsonResponse({ success: true, data: { item }, message: '道具更新成功' });
  } catch (error) {
    console.error('Farm shop admin PUT error:', error);
    return jsonResponse({ success: false, message: '更新道具失败' }, 500);
  }
}

/**
 * DELETE - 删除道具
 */
export async function DELETE(request: NextRequest) {
  const blocked = enforceTrustedApiRequest(request);
  if (blocked) {
    return blocked;
  }

  const auth = await checkAdmin();
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id } = body;
    if (typeof id !== 'string' || !id.trim()) {
      return jsonResponse({ success: false, message: 'ID 不能为空' }, 400);
    }

    const deleted = await deleteFarmShopItem(id);
    if (!deleted.success) {
      return jsonResponse({ success: false, message: '道具不存在' }, 404);
    }

    return jsonResponse({
      success: true,
      message: deleted.archived
        ? '该道具有历史购买记录，已自动下架归档'
        : '道具删除成功',
    });
  } catch (error) {
    console.error('Farm shop admin DELETE error:', error);
    return jsonResponse({ success: false, message: '删除道具失败' }, 500);
  }
}
