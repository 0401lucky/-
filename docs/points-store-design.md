# 积分商店 + 额度直充 设计文档

> 版本: 1.0  
> 更新日期: 2026-01-21

---

## 一、概述

### 1.1 功能简介

本功能为福利站新增 **积分商店** 模块，用户可通过积分兑换：

1. **抽奖次数** - 增加额外抽奖机会
2. **直充额度** - 直接充值到用户的 new-api 账户（无需兑换码）

### 1.2 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           前端页面                                   │
├──────────────────────────────┬──────────────────────────────────────┤
│         /store               │           /admin/store               │
│        积分商店               │           商品管理后台                │
└──────────────┬───────────────┴──────────────────┬───────────────────┘
               │                                   │
               ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           API Routes                                 │
├──────────────┬───────────────┬──────────────────┬───────────────────┤
│  /api/points │  /api/store   │ /api/store/admin │ /api/admin/points │
│   积分查询    │   商品列表     │    商品管理       │    积分调整       │
└──────┬───────┴───────┬───────┴────────┬─────────┴─────────┬─────────┘
       │               │                │                   │
       ▼               ▼                ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           核心服务层                                 │
├──────────────┬───────────────┬──────────────────┬───────────────────┤
│  points.ts   │   store.ts    │    new-api.ts    │      kv.ts        │
│   积分服务    │   商店服务     │   管理员API扩展   │    现有KV操作      │
└──────┬───────┴───────┬───────┴────────┬─────────┴─────────┬─────────┘
       │               │                │                   │
       ▼               ▼                ▼                   ▼
┌─────────────────────────────────┬───────────────────────────────────┐
│         Vercel KV               │            New-API                │
│   积分/商品配置/兑换记录          │        用户账户/额度               │
└─────────────────────────────────┴───────────────────────────────────┘
```

### 1.3 核心技术发现

通过分析 [new-api 源码](https://github.com/QuantumNous/new-api)，发现：

| API 端点 | 方法 | 用途 | 权限 |
|---------|------|------|------|
| `PUT /api/user/` | PUT | 直接修改用户 Quota | 管理员 (role >= 10) |
| `GET /api/user/:id` | GET | 获取用户详情 | 管理员 |

**关键信息：**
- Quota 单位：`1 美元 = 500000 quota`
- 认证方式：Cookie 中的 `session` 字段
- 修改 quota 会自动记录日志

---

## 二、数据模型

### 2.1 TypeScript 类型定义

```typescript
// src/lib/types/store.ts

/** 积分来源类型 */
export type PointsSource =
  | 'game_play'      // 游戏游玩
  | 'game_win'       // 游戏胜利
  | 'daily_login'    // 每日登录
  | 'checkin_bonus'  // 签到奖励
  | 'exchange'       // 商店兑换（扣除）
  | 'admin_adjust'   // 管理员调整

/** 积分流水记录 */
export interface PointsLog {
  id: string
  amount: number        // 正数增加，负数扣除
  source: PointsSource
  description: string
  balance: number       // 变动后余额
  createdAt: number     // 时间戳
}

/** 商店商品类型 */
export type StoreItemType =
  | 'lottery_spin'    // 抽奖次数
  | 'quota_direct'    // 直充额度

/** 商店商品 */
export interface StoreItem {
  id: string
  name: string
  description: string
  type: StoreItemType
  pointsCost: number    // 积分价格
  value: number         // 获得数值（次数或美元）
  dailyLimit?: number   // 每日限购（可选）
  totalStock?: number   // 总库存（可选）
  sortOrder: number     // 排序权重
  enabled: boolean      // 是否上架
  createdAt: number
  updatedAt: number
}

/** 兑换记录 */
export interface ExchangeLog {
  id: string
  userId: number
  itemId: string
  itemName: string
  pointsCost: number
  value: number
  type: StoreItemType
  createdAt: number
}
```

### 2.2 Vercel KV 键值设计

| Key Pattern | Value Type | 说明 | TTL |
|-------------|------------|------|-----|
| `points:{userId}` | `number` | 用户积分余额 | - |
| `points_log:{userId}` | `List<PointsLog>` | 积分流水（最近100条） | - |
| `store:items` | `StoreItem[]` | 所有商品配置 | - |
| `exchange_log:{userId}` | `List<ExchangeLog>` | 兑换记录（最近100条） | - |
| `exchange_limit:{userId}:{itemId}:{date}` | `number` | 每日兑换计数 | 48h |

---

## 三、核心模块

### 3.1 扩展 new-api.ts

```typescript
// src/lib/new-api.ts 新增内容

// ============ 环境变量 ============
const ADMIN_USERNAME = process.env.NEW_API_ADMIN_USERNAME
const ADMIN_PASSWORD = process.env.NEW_API_ADMIN_PASSWORD

// ============ 管理员 Session 缓存 ============
let adminSessionCache: { session: string; expiresAt: number } | null = null

/**
 * 获取管理员 Session（带缓存，4小时有效）
 */
async function getAdminSession(): Promise<string> {
  // 检查缓存
  if (adminSessionCache && adminSessionCache.expiresAt > Date.now()) {
    return adminSessionCache.session
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('Missing NEW_API_ADMIN_USERNAME or NEW_API_ADMIN_PASSWORD')
  }

  // 调用现有登录函数
  const { cookies } = await loginToNewApi(ADMIN_USERNAME, ADMIN_PASSWORD)

  // 解析 session
  const sessionMatch = cookies.match(/session=([^;]+)/)
  if (!sessionMatch) {
    throw new Error('Failed to get admin session from cookies')
  }

  const session = sessionMatch[1]

  // 缓存 4 小时
  adminSessionCache = {
    session,
    expiresAt: Date.now() + 4 * 60 * 60 * 1000,
  }

  return session
}

/**
 * 获取用户详情（管理员权限）
 */
export async function getNewApiUserById(userId: number): Promise<NewApiUser | null> {
  const session = await getAdminSession()

  const res = await fetch(`${NEW_API_URL}/api/user/${userId}`, {
    headers: { Cookie: `session=${session}` },
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.success ? data.data : null
}

/**
 * 充值额度到用户账户
 * @param userId 用户 ID
 * @param addQuota 增加的额度（quota 单位）
 */
export async function creditQuotaToUser(
  userId: number,
  addQuota: number
): Promise<{ success: boolean; newQuota?: number; error?: string }> {
  try {
    const session = await getAdminSession()

    // 1. 获取当前 quota
    const user = await getNewApiUserById(userId)
    if (!user) {
      return { success: false, error: '用户不存在' }
    }

    // 2. 计算新 quota
    const newQuota = user.quota + addQuota

    // 3. 调用更新 API
    const res = await fetch(`${NEW_API_URL}/api/user/`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${session}`,
      },
      body: JSON.stringify({ id: userId, quota: newQuota }),
    })

    const data = await res.json()
    if (!data.success) {
      return { success: false, error: data.message || '更新失败' }
    }

    return { success: true, newQuota }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

/**
 * 美元转 quota 单位
 * 1 美元 = 500000 quota
 */
export function dollarToQuota(dollars: number): number {
  return Math.floor(dollars * 500000)
}

/**
 * quota 单位转美元
 */
export function quotaToDollar(quota: number): number {
  return quota / 500000
}
```

### 3.2 积分服务 points.ts

```typescript
// src/lib/points.ts

import { kv } from '@vercel/kv'
import { nanoid } from 'nanoid'
import type { PointsLog, PointsSource } from './types/store'

// ============ Key 生成器 ============
const POINTS_KEY = (userId: number) => `points:${userId}`
const POINTS_LOG_KEY = (userId: number) => `points_log:${userId}`

/**
 * 获取用户积分余额
 */
export async function getUserPoints(userId: number): Promise<number> {
  return (await kv.get<number>(POINTS_KEY(userId))) ?? 0
}

/**
 * 增加积分（原子操作）
 */
export async function addPoints(
  userId: number,
  amount: number,
  source: PointsSource,
  description: string
): Promise<{ success: boolean; newBalance: number }> {
  // 原子性增加
  const newBalance = await kv.incrby(POINTS_KEY(userId), amount)

  // 记录流水
  const log: PointsLog = {
    id: nanoid(),
    amount,
    source,
    description,
    balance: newBalance,
    createdAt: Date.now(),
  }

  await kv.lpush(POINTS_LOG_KEY(userId), log)
  await kv.ltrim(POINTS_LOG_KEY(userId), 0, 99) // 只保留最近100条

  return { success: true, newBalance }
}

/**
 * 扣除积分（原子操作，带余额检查）
 * 使用 Lua 脚本保证原子性
 */
export async function deductPoints(
  userId: number,
  amount: number,
  source: PointsSource,
  description: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  // Lua 脚本：检查余额并扣除
  const script = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    if current < tonumber(ARGV[1]) then
      return -1
    end
    return redis.call('DECRBY', KEYS[1], ARGV[1])
  `

  const result = await kv.eval(script, [POINTS_KEY(userId)], [amount])

  if (result === -1) {
    return { success: false, error: '积分不足' }
  }

  const newBalance = result as number

  // 记录流水
  const log: PointsLog = {
    id: nanoid(),
    amount: -amount,
    source,
    description,
    balance: newBalance,
    createdAt: Date.now(),
  }

  await kv.lpush(POINTS_LOG_KEY(userId), log)
  await kv.ltrim(POINTS_LOG_KEY(userId), 0, 99)

  return { success: true, newBalance }
}

/**
 * 获取积分流水记录
 */
export async function getPointsLogs(
  userId: number,
  limit = 20
): Promise<PointsLog[]> {
  return (await kv.lrange<PointsLog>(POINTS_LOG_KEY(userId), 0, limit - 1)) ?? []
}
```

### 3.3 商店服务 store.ts

```typescript
// src/lib/store.ts

import { kv } from '@vercel/kv'
import { nanoid } from 'nanoid'
import type { StoreItem, ExchangeLog } from './types/store'
import { deductPoints, addPoints } from './points'
import { addExtraSpinCount } from './kv'
import { creditQuotaToUser, dollarToQuota } from './new-api'

// ============ Key 生成器 ============
const STORE_ITEMS_KEY = 'store:items'
const EXCHANGE_LOG_KEY = (userId: number) => `exchange_log:${userId}`
const DAILY_LIMIT_KEY = (userId: number, itemId: string, date: string) =>
  `exchange_limit:${userId}:${itemId}:${date}`

// ============ 商品管理（管理员） ============

/**
 * 获取所有商品（含下架）
 */
export async function getAllStoreItems(): Promise<StoreItem[]> {
  const items = await kv.get<StoreItem[]>(STORE_ITEMS_KEY)
  return items ?? []
}

/**
 * 获取上架商品（用户可见）
 */
export async function getAvailableStoreItems(): Promise<StoreItem[]> {
  const items = await getAllStoreItems()
  return items
    .filter(item => item.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * 创建商品
 */
export async function createStoreItem(
  item: Omit<StoreItem, 'id' | 'createdAt' | 'updatedAt'>
): Promise<StoreItem> {
  const items = await getAllStoreItems()
  
  const newItem: StoreItem = {
    ...item,
    id: nanoid(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  
  items.push(newItem)
  await kv.set(STORE_ITEMS_KEY, items)
  
  return newItem
}

/**
 * 更新商品
 */
export async function updateStoreItem(
  id: string,
  updates: Partial<Omit<StoreItem, 'id' | 'createdAt'>>
): Promise<StoreItem | null> {
  const items = await getAllStoreItems()
  const index = items.findIndex(item => item.id === id)
  
  if (index === -1) return null

  items[index] = {
    ...items[index],
    ...updates,
    updatedAt: Date.now(),
  }
  
  await kv.set(STORE_ITEMS_KEY, items)
  return items[index]
}

/**
 * 删除商品
 */
export async function deleteStoreItem(id: string): Promise<boolean> {
  const items = await getAllStoreItems()
  const filtered = items.filter(item => item.id !== id)
  
  if (filtered.length === items.length) return false
  
  await kv.set(STORE_ITEMS_KEY, filtered)
  return true
}

/**
 * 初始化默认商品（首次使用时调用）
 */
export async function initDefaultStoreItems(): Promise<void> {
  const existing = await getAllStoreItems()
  if (existing.length > 0) return // 已有商品，跳过

  const defaultItems: Omit<StoreItem, 'id' | 'createdAt' | 'updatedAt'>[] = [
    // 抽奖次数
    {
      name: '抽奖券 x1',
      description: '获得 1 次抽奖机会',
      type: 'lottery_spin',
      pointsCost: 100,
      value: 1,
      sortOrder: 1,
      enabled: true,
    },
    {
      name: '抽奖券 x5',
      description: '获得 5 次抽奖机会（9折）',
      type: 'lottery_spin',
      pointsCost: 450,
      value: 5,
      sortOrder: 2,
      enabled: true,
    },
    {
      name: '抽奖券 x10',
      description: '获得 10 次抽奖机会（8折）',
      type: 'lottery_spin',
      pointsCost: 800,
      value: 10,
      sortOrder: 3,
      enabled: true,
    },
    // 直充额度
    {
      name: '额度 $1',
      description: '直接充值 $1 到您的账户',
      type: 'quota_direct',
      pointsCost: 500,
      value: 1,
      dailyLimit: 5,
      sortOrder: 10,
      enabled: true,
    },
    {
      name: '额度 $5',
      description: '直接充值 $5 到您的账户（9折）',
      type: 'quota_direct',
      pointsCost: 2250,
      value: 5,
      dailyLimit: 2,
      sortOrder: 11,
      enabled: true,
    },
    {
      name: '额度 $10',
      description: '直接充值 $10 到您的账户（8折）',
      type: 'quota_direct',
      pointsCost: 4000,
      value: 10,
      dailyLimit: 1,
      sortOrder: 12,
      enabled: true,
    },
  ]

  for (const item of defaultItems) {
    await createStoreItem(item)
  }
}

// ============ 兑换逻辑 ============

/**
 * 检查每日限购
 */
async function checkDailyLimit(
  userId: number,
  item: StoreItem
): Promise<{ ok: boolean; used: number; limit: number }> {
  if (!item.dailyLimit) {
    return { ok: true, used: 0, limit: Infinity }
  }

  const today = new Date().toISOString().slice(0, 10)
  const key = DAILY_LIMIT_KEY(userId, item.id, today)
  const used = (await kv.get<number>(key)) ?? 0

  return {
    ok: used < item.dailyLimit,
    used,
    limit: item.dailyLimit,
  }
}

/**
 * 兑换商品
 */
export async function exchangeItem(
  userId: number,
  itemId: string
): Promise<{
  success: boolean
  message: string
  pointsBalance?: number
  log?: ExchangeLog
}> {
  // 1. 查找商品
  const items = await getAllStoreItems()
  const item = items.find(i => i.id === itemId)
  
  if (!item || !item.enabled) {
    return { success: false, message: '商品不存在或已下架' }
  }

  // 2. 检查限购
  const limitCheck = await checkDailyLimit(userId, item)
  if (!limitCheck.ok) {
    return {
      success: false,
      message: `今日已兑换 ${limitCheck.used}/${limitCheck.limit} 次，请明日再来`,
    }
  }

  // 3. 扣除积分
  const deduct = await deductPoints(
    userId,
    item.pointsCost,
    'exchange',
    `兑换: ${item.name}`
  )

  if (!deduct.success) {
    return { success: false, message: deduct.error ?? '积分不足' }
  }

  // 4. 发放奖励
  try {
    if (item.type === 'lottery_spin') {
      // 增加抽奖次数
      await addExtraSpinCount(userId, item.value)
    } else if (item.type === 'quota_direct') {
      // 直充额度
      const quota = dollarToQuota(item.value)
      const result = await creditQuotaToUser(userId, quota)

      if (!result.success) {
        // 充值失败，退还积分
        await addPoints(
          userId,
          item.pointsCost,
          'admin_adjust',
          `退款: ${item.name} 充值失败`
        )
        return {
          success: false,
          message: `额度充值失败: ${result.error}，积分已退还`,
        }
      }
    }
  } catch (error) {
    // 发放异常，退还积分
    await addPoints(
      userId,
      item.pointsCost,
      'admin_adjust',
      `退款: ${item.name} 发放异常`
    )
    return {
      success: false,
      message: `发放失败: ${error}，积分已退还`,
    }
  }

  // 5. 记录兑换日志
  const log: ExchangeLog = {
    id: nanoid(),
    userId,
    itemId: item.id,
    itemName: item.name,
    pointsCost: item.pointsCost,
    value: item.value,
    type: item.type,
    createdAt: Date.now(),
  }

  await kv.lpush(EXCHANGE_LOG_KEY(userId), log)
  await kv.ltrim(EXCHANGE_LOG_KEY(userId), 0, 99)

  // 6. 更新每日限购计数
  if (item.dailyLimit) {
    const today = new Date().toISOString().slice(0, 10)
    const key = DAILY_LIMIT_KEY(userId, item.id, today)
    await kv.incr(key)
    await kv.expire(key, 86400 * 2) // 48小时过期
  }

  return {
    success: true,
    message: `成功兑换 ${item.name}`,
    pointsBalance: deduct.newBalance,
    log,
  }
}

/**
 * 获取用户兑换记录
 */
export async function getExchangeLogs(
  userId: number,
  limit = 20
): Promise<ExchangeLog[]> {
  return (await kv.lrange<ExchangeLog>(EXCHANGE_LOG_KEY(userId), 0, limit - 1)) ?? []
}

/**
 * 获取用户某商品今日已兑换次数
 */
export async function getUserDailyExchangeCount(
  userId: number,
  itemId: string
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const key = DAILY_LIMIT_KEY(userId, itemId, today)
  return (await kv.get<number>(key)) ?? 0
}
```

---

## 四、API 路由设计

### 4.1 路由总览

| 路由 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/points` | GET | 获取积分余额和流水 | 用户 |
| `/api/store` | GET | 获取商品列表 | 用户 |
| `/api/store/exchange` | POST | 兑换商品 | 用户 |
| `/api/store/admin` | GET | 获取所有商品（含下架） | 管理员 |
| `/api/store/admin` | POST | 创建商品 | 管理员 |
| `/api/store/admin` | PUT | 更新商品 | 管理员 |
| `/api/store/admin` | DELETE | 删除商品 | 管理员 |
| `/api/admin/points` | POST | 调整用户积分 | 管理员 |

### 4.2 API 详细说明

#### GET /api/points

获取当前用户积分余额和流水记录。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "balance": 1250,
    "logs": [
      {
        "id": "abc123",
        "amount": 50,
        "source": "game_win",
        "description": "猜数字: 胜利",
        "balance": 1250,
        "createdAt": 1705826400000
      }
    ]
  }
}
```

#### GET /api/store

获取上架商品列表，包含用户每日兑换状态。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "item_001",
        "name": "抽奖券 x1",
        "description": "获得 1 次抽奖机会",
        "type": "lottery_spin",
        "pointsCost": 100,
        "value": 1,
        "dailyLimit": null,
        "dailyUsed": 0,
        "enabled": true
      },
      {
        "id": "item_004",
        "name": "额度 $1",
        "description": "直接充值 $1 到您的账户",
        "type": "quota_direct",
        "pointsCost": 500,
        "value": 1,
        "dailyLimit": 5,
        "dailyUsed": 2,
        "enabled": true
      }
    ],
    "userPoints": 1250
  }
}
```

#### POST /api/store/exchange

兑换商品。

**请求体：**
```json
{
  "itemId": "item_001"
}
```

**成功响应：**
```json
{
  "success": true,
  "message": "成功兑换 抽奖券 x1",
  "data": {
    "pointsBalance": 1150,
    "log": {
      "id": "exg_123",
      "itemName": "抽奖券 x1",
      "pointsCost": 100,
      "value": 1,
      "type": "lottery_spin",
      "createdAt": 1705826400000
    }
  }
}
```

**失败响应：**
```json
{
  "success": false,
  "message": "积分不足"
}
```

#### POST /api/store/admin

创建商品（管理员）。

**请求体：**
```json
{
  "name": "额度 $20",
  "description": "直接充值 $20 到您的账户（75折）",
  "type": "quota_direct",
  "pointsCost": 7500,
  "value": 20,
  "dailyLimit": 1,
  "sortOrder": 13,
  "enabled": true
}
```

#### PUT /api/store/admin

更新商品（管理员）。

**请求体：**
```json
{
  "id": "item_004",
  "pointsCost": 480,
  "dailyLimit": 10
}
```

#### POST /api/admin/points

管理员调整用户积分。

**请求体：**
```json
{
  "userId": 12345,
  "amount": 500,
  "description": "活动奖励"
}
```

---

## 五、前端页面

### 5.1 页面结构

```
src/app/
├── store/
│   └── page.tsx              # 积分商店页面
└── admin/
    └── store/
        └── page.tsx          # 商品管理后台
```

### 5.2 积分商店页面线框图

```
┌─────────────────────────────────────────────────────────────────────┐
│  [返回首页]                                                          │
│                                                                      │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  ⭐ 积分商店                                  我的积分: 1,250  ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                      │
│  ┌─ 抽奖券 ─────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │  🎫 x1      │  │  🎫 x5      │  │  🎫 x10     │           │   │
│  │  │             │  │   9折      │  │   8折      │           │   │
│  │  │  100 积分   │  │  450 积分   │  │  800 积分   │           │   │
│  │  │             │  │             │  │             │           │   │
│  │  │  [兑换]     │  │  [兑换]     │  │  [兑换]     │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ 直充额度 ───────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │   │
│  │  │  💰 $1      │  │  💰 $5      │  │  💰 $10     │           │   │
│  │  │  直充账户   │  │   9折      │  │   8折      │           │   │
│  │  │  500 积分   │  │  2250 积分  │  │  4000 积分  │           │   │
│  │  │             │  │             │  │             │           │   │
│  │  │ 今日 2/5    │  │ 今日 0/2    │  │ 今日 0/1    │           │   │
│  │  │  [兑换]     │  │  [兑换]     │  │  [兑换]     │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ 兑换记录 ───────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │  📋 2026-01-21 14:30   额度 $1      -500积分   ✅ 已到账     │   │
│  │  📋 2026-01-21 12:15   抽奖券 x5    -450积分   ✅ 已发放     │   │
│  │  📋 2026-01-20 18:00   额度 $5      -2250积分  ✅ 已到账     │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 商品管理后台线框图

```
┌─────────────────────────────────────────────────────────────────────┐
│  [返回管理后台]                                                      │
│                                                                      │
│  ╔═══════════════════════════════════════════════════════════════╗  │
│  ║  🛒 商品管理                                    [+ 新增商品]   ║  │
│  ╚═══════════════════════════════════════════════════════════════╝  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ 名称        │ 类型     │ 积分  │ 数值 │ 限购 │ 状态  │ 操作   │  │
│  ├─────────────┼──────────┼───────┼──────┼──────┼───────┼────────┤  │
│  │ 抽奖券 x1   │ 抽奖次数 │  100  │  1   │  -   │ ✅上架 │ 编辑   │  │
│  │ 抽奖券 x5   │ 抽奖次数 │  450  │  5   │  -   │ ✅上架 │ 编辑   │  │
│  │ 抽奖券 x10  │ 抽奖次数 │  800  │ 10   │  -   │ ✅上架 │ 编辑   │  │
│  │ 额度 $1     │ 直充额度 │  500  │  1   │ 5/日 │ ✅上架 │ 编辑   │  │
│  │ 额度 $5     │ 直充额度 │ 2250  │  5   │ 2/日 │ ✅上架 │ 编辑   │  │
│  │ 额度 $10    │ 直充额度 │ 4000  │ 10   │ 1/日 │ ✅上架 │ 编辑   │  │
│  │ 额度 $20    │ 直充额度 │ 7500  │ 20   │ 1/日 │ ⚫下架 │ 编辑   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 编辑商品 ────────────────────────────────────────────────────┐  │
│  │                                                               │   │
│  │  名称: [额度 $1                    ]                          │   │
│  │  描述: [直接充值 $1 到您的账户       ]                          │   │
│  │  类型: (●) 直充额度  ( ) 抽奖次数                              │   │
│  │  积分价格: [500    ]                                          │   │
│  │  获得数值: [1      ] (美元/次数)                               │   │
│  │  每日限购: [5      ] (留空=不限)                               │   │
│  │  排序权重: [10     ]                                          │   │
│  │  状态: [✓] 上架                                               │   │
│  │                                                               │   │
│  │  [取消]                                    [保存]             │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 六、默认商品配置

首次启动时自动初始化以下商品：

### 抽奖次数类

| 名称 | 积分价格 | 获得次数 | 每日限购 | 折扣 |
|------|----------|----------|----------|------|
| 抽奖券 x1 | 100 | 1 | - | 原价 |
| 抽奖券 x5 | 450 | 5 | - | 9折 |
| 抽奖券 x10 | 800 | 10 | - | 8折 |

### 直充额度类

| 名称 | 积分价格 | 获得额度 | 每日限购 | 折扣 |
|------|----------|----------|----------|------|
| 额度 $1 | 500 | $1 | 5次 | 原价 |
| 额度 $5 | 2250 | $5 | 2次 | 9折 |
| 额度 $10 | 4000 | $10 | 1次 | 8折 |

**兑换比例基准：** 500 积分 = $1（管理员可自由调整）

---

## 七、环境变量

在 `.env.local` 中新增：

```env
# New-API 管理员凭据（用于额度直充）
NEW_API_ADMIN_USERNAME=admin
NEW_API_ADMIN_PASSWORD=your_admin_password_here
```

**获取方式：**
1. 登录 new-api 管理后台
2. 使用管理员账号（role >= 10）
3. 将用户名和密码配置到环境变量

**注意事项：**
- 建议创建专用 API 操作员账号，而非使用主管理员账号
- 密码中如有特殊字符，需正确转义

---

## 八、安全考虑

### 8.1 凭据安全

- `NEW_API_ADMIN_USERNAME/PASSWORD` 仅在服务端使用
- 管理员 Session 缓存在内存中，不持久化
- 定期轮换管理员密码

### 8.2 并发安全

- 积分扣除使用 Lua 脚本保证原子性
- 每日限购计数使用 Redis INCR 原子操作
- 兑换流程采用「先扣后发」策略

### 8.3 失败处理

- 额度充值失败自动退还积分
- 记录完整审计日志（积分流水、兑换记录）
- new-api 侧自动记录额度变更日志

### 8.4 防刷机制

- 每日限购限制
- 可选：总库存限制
- 可选：添加频率限制（Rate Limiting）

---

## 九、实施任务清单

按优先级排列：

### P0 - 核心功能

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 1 | 类型定义 | `src/lib/types/store.ts` | 0.5h |
| 2 | 积分服务 | `src/lib/points.ts` | 1h |
| 3 | 扩展 new-api（管理员接口） | `src/lib/new-api.ts` | 1h |
| 4 | 商店服务 | `src/lib/store.ts` | 2h |
| 5 | 积分 API | `src/app/api/points/route.ts` | 0.5h |
| 6 | 商店列表 API | `src/app/api/store/route.ts` | 0.5h |
| 7 | 兑换 API | `src/app/api/store/exchange/route.ts` | 1h |
| 8 | 商店前端页面 | `src/app/store/page.tsx` | 2h |

### P1 - 管理功能

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 9 | 商品管理 API | `src/app/api/store/admin/route.ts` | 1h |
| 10 | 商品管理后台页面 | `src/app/admin/store/page.tsx` | 2h |
| 11 | 管理员积分调整 API | `src/app/api/admin/points/route.ts` | 0.5h |

### P2 - 优化增强

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 12 | 积分获取来源接入 | 根据游戏模块 | - |
| 13 | 兑换通知（可选） | - | - |
| 14 | 数据统计面板（可选） | - | - |

---

## 十、附录

### A. quota 单位换算

```typescript
// 1 美元 = 500000 quota 单位
const QUOTA_PER_DOLLAR = 500000

// 美元 → quota
function dollarToQuota(dollars: number): number {
  return Math.floor(dollars * QUOTA_PER_DOLLAR)
}

// quota → 美元
function quotaToDollar(quota: number): number {
  return quota / QUOTA_PER_DOLLAR
}
```

### B. 现有 kv.ts 需扩展的函数

```typescript
// 已存在，可直接使用
export async function addExtraSpinCount(userId: number, count: number): Promise<number>
```

### C. 现有 auth.ts 鉴权函数

```typescript
// 获取当前登录用户
export async function getAuthUser(): Promise<AuthUser | null>

// AuthUser 包含 isAdmin 字段用于权限判断
```
