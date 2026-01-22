# 弹珠机游戏设计文档

> 版本: 1.0  
> 更新日期: 2026-01-21

---

## 一、概述

### 1.1 功能简介

福利站新增 **弹珠机小游戏**，用户通过游玩获得积分，积分可在积分商店兑换抽奖次数或直充额度。

### 1.2 核心参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 每局弹珠数 | 5 颗 | 用户手动逐颗发射 |
| 发射方式 | 手动控制 | 调整角度 + 力度 |
| 每日积分上限 | 1000 | 防刷核心限制 |
| 局间冷却 | 5 秒 | 隐藏式，用户无感知 |
| 单局最短时长 | 10 秒 | 防脚本校验 |

### 1.3 积分经济

| 兑换项 | 积分消耗 | 说明 |
|--------|----------|------|
| 抽奖次数 ×1 | 100 积分 | 每日可赚 10 次 |
| 额度 $1 | 500 积分 | 每日可赚 $2 |

---

## 二、游戏规则

### 2.1 游戏界面布局

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     剩余弹珠: ● ● ● ○ ○           今日积分: 425/1000        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         ●  ← 待发射弹珠                      │
│                        ╱╲                                   │
│                       ╱  ╲ ← 瞄准线                         │
│                      ╱    ╲                                 │
│     ┌─────────────────────────────────────────────────┐     │
│     │                                                 │     │
│     │    ·    ·    ·    ·    ·    ·    ·    ·    ·    │     │ ← 钉子层 1
│     │      ·    ·    ·    ·    ·    ·    ·    ·       │     │ ← 钉子层 2
│     │    ·    ·    ·    ·    ·    ·    ·    ·    ·    │     │ ← 钉子层 3
│     │      ·    ·    ·    ·    ·    ·    ·    ·       │     │ ← 钉子层 4
│     │    ·    ·    ·    ·    ·    ·    ·    ·    ·    │     │ ← 钉子层 5
│     │      ·    ·    ·    ·    ·    ·    ·    ·       │     │ ← 钉子层 6
│     │    ·    ·    ·    ·    ·    ·    ·    ·    ·    │     │ ← 钉子层 7
│     │      ·    ·    ·    ·    ·    ·    ·    ·       │     │ ← 钉子层 8
│     │                                                 │     │
│     ├──┬──┬──┬──┬──┬──┬──┬──┬──┤     │
│     │5 │10│20│40│80│40│20│10│5 │     │ ← 得分槽位
│     └──┴──┴──┴──┴──┴──┴──┴──┴──┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
│                                                             │
│    ◀════════════●════════════▶   力度: ████████░░ 80%       │
│              [发射]                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 槽位分值设计

```
位置:    1    2    3    4    5    4    3    2    1
分值:   [5]  [10] [20] [40] [80] [40] [20] [10] [5]
         ↑                   ↑                   ↑
       边缘                 中心                边缘
       (易)                (难)                (易)
```

**得分预估（5颗弹珠）：**

| 情况 | 分数 | 概率 |
|------|------|------|
| 最低 | 25 分 | 极低（5×5，全边缘） |
| 较低 | 40-60 分 | 约 20% |
| 平均 | 80-120 分 | 约 50% |
| 较高 | 150-200 分 | 约 25% |
| 最高 | 400 分 | 极低（5×80，全中心） |

**设计理念：**
- 中心槽位分值最高（80），但弹珠经过多层钉子后落入中心的概率较低
- 边缘槽位分值低（5），但更容易落入
- 玩家可通过调整发射角度和力度，尝试控制弹珠轨迹

### 2.3 手动发射交互

**操作方式：**

| 操作 | 效果 | 范围 |
|------|------|------|
| 左右滑动/拖动 | 调整发射角度 | -30° ~ +30° |
| 上下滑动/长按 | 调整发射力度 | 50% ~ 100% |
| 点击发射按钮 | 发射弹珠 | - |
| 松手（可选） | 自动发射 | - |

**交互细节：**

```typescript
interface LaunchParams {
  angle: number;    // -30 到 +30 度，0 为垂直向下
  power: number;    // 0.5 到 1.0，影响初始速度
}

// 发射角度影响弹珠初始水平速度
// 发射力度影响弹珠初始垂直速度
```

### 2.4 游戏流程

```
1. 用户进入游戏页面
   ↓
2. 点击「开始游戏」
   ↓
3. 请求服务端创建游戏会话 → 返回 sessionId + seed
   ↓
4. 前端初始化物理引擎（使用 seed）
   ↓
5. 用户发射第 1 颗弹珠
   ├── 调整角度/力度
   ├── 点击发射
   ├── 弹珠物理模拟
   └── 落入槽位，记录得分
   ↓
6. 重复步骤 5，共发射 5 颗弹珠
   ↓
7. 游戏结束，展示结算画面
   ↓
8. 提交结果到服务端验证
   ↓
9. 验证通过 → 发放积分
   ↓
10. 展示结算动画（隐藏冷却）
    ↓
11. 用户可选择「再来一局」
```

---

## 三、隐藏式冷却设计

### 3.1 设计理念

用户不应感受到"被限制"，冷却时间通过自然的结算流程消化。

### 3.2 结算画面时间线

```
时间轴（秒）
0s ────────── 1.5s ────────── 2.5s ────────── 4s ────────── 5s
│              │               │              │             │
│   结算弹窗   │   积分动画    │   进度条     │  按钮出现   │
│   淡入显示   │   飞入效果    │   填充动画   │  可点击     │
│              │               │              │             │
└──────────────┴───────────────┴──────────────┴─────────────┘
                        总计 5 秒（= 冷却时间）
```

### 3.3 结算画面设计

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                      🎉 游戏结束！                           │
│                                                             │
│     ┌─────────────────────────────────────────────────┐     │
│     │                                                 │     │
│     │   第1颗: 20 分    ●━━━━━━━▶ [20]              │     │
│     │   第2颗: 40 分    ●━━━━━━━▶ [40]              │     │
│     │   第3颗: 10 分    ●━━━━━━━▶ [10]              │     │
│     │   第4颗: 80 分    ●━━━━━━━▶ [80] ⭐           │     │
│     │   第5颗: 20 分    ●━━━━━━━▶ [20]              │     │
│     │                                                 │     │
│     │   ─────────────────────────────                 │     │
│     │   本局得分:  170 分                             │     │
│     │                                                 │     │
│     └─────────────────────────────────────────────────┘     │
│                                                             │
│              ⭐ +170 积分                                    │
│                 ↑↑↑ (积分飞入动画)                           │
│                                                             │
│     今日进度: ████████████████░░░░░░░░░░ 595/1000           │
│                                                             │
│                                                             │
│        [查看排行榜]              [再来一局]                  │
│                                 (5秒后可点击)                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 极速点击处理

如果用户在冷却未结束时点击「再来一局」：

```typescript
// 不显示倒计时，使用自然的加载提示
const messages = [
  "准备弹珠中...",
  "校准发射器...",
  "加载游戏场景...",
];

// 随机选择一个提示，等待剩余冷却时间
```

---

## 四、防作弊机制

### 4.1 多层防护架构

```
┌─────────────────────────────────────────────────────────────┐
│                    第一层：频率限制                          │
├─────────────────────────────────────────────────────────────┤
│ • 每局游戏最短时长 10 秒（5颗弹珠物理下落时间）               │
│ • 局间强制冷却 5 秒（通过结算动画隐藏）                       │
│ • 每日积分上限 1000，超过不再发放                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    第二层：会话绑定                          │
├─────────────────────────────────────────────────────────────┤
│ 1. 开始游戏 → 服务端生成 GameSession                        │
│    { id, oderId, seed, startedAt, expiresAt }               │
│ 2. 会话有效期 5 分钟，过期自动失效                           │
│ 3. 每个会话只能提交一次结果                                  │
│ 4. 用户同时只能有一个活跃会话                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    第三层：结果校验                          │
├─────────────────────────────────────────────────────────────┤
│ • 分数范围校验：0 ≤ score ≤ 400（5 × 80）                   │
│ • 弹珠数量校验：必须恰好 5 颗                                │
│ • 槽位分值校验：每颗必须是 [5,10,20,40,80] 之一              │
│ • 总分一致性：ballResults 之和 = score                      │
│ • 时长校验：duration ≥ 10000ms                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    第四层：行为分析（可选）                   │
├─────────────────────────────────────────────────────────────┤
│ • 异常模式检测：连续多局满分/高分                            │
│ • 发射参数分析：角度/力度分布是否合理                        │
│ • IP/设备指纹：同一来源大量请求                              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 确定性随机种子

使用服务端生成的 seed 初始化物理引擎，确保：
- 相同 seed = 相同的钉子微小位置偏移
- 可用于服务端重放验证（可选，成本高）

```typescript
import seedrandom from 'seedrandom';

function initPhysicsWorld(seed: string) {
  const rng = seedrandom(seed);
  
  // 钉子位置的微小随机偏移（±2px）
  pins.forEach(pin => {
    pin.x += (rng() - 0.5) * 4;
    pin.y += (rng() - 0.5) * 4;
  });
}
```

### 4.3 会话生命周期

```
创建会话                    提交结果                    过期
   │                           │                         │
   ▼                           ▼                         ▼
┌──────┐    游戏中      ┌──────────┐            ┌─────────┐
│ NEW  │ ──────────────▶│ PLAYING  │───────────▶│COMPLETED│
└──────┘                └──────────┘            └─────────┘
                              │
                              │ 5分钟未提交
                              ▼
                        ┌─────────┐
                        │ EXPIRED │
                        └─────────┘
```

---

## 五、数据模型

### 5.1 TypeScript 类型定义

```typescript
// src/lib/types/game.ts

/** 游戏类型 */
export type GameType = 'pachinko';

/** 游戏会话状态 */
export type GameSessionStatus = 'playing' | 'completed' | 'expired';

/** 游戏会话 */
export interface GameSession {
  id: string;
  oderId: number;
  gameType: GameType;
  seed: string;              // 随机种子
  startedAt: number;         // 开始时间戳
  expiresAt: number;         // 过期时间戳（5分钟后）
  status: GameSessionStatus;
}

/** 弹珠发射参数 */
export interface BallLaunch {
  angle: number;             // 发射角度 (-30 ~ +30)
  power: number;             // 发射力度 (0.5 ~ 1.0)
  slotScore: number;         // 落入槽位分数
  duration: number;          // 该弹珠从发射到落槽的时间(ms)
}

/** 游戏结果提交 */
export interface GameResultSubmit {
  sessionId: string;
  score: number;             // 总得分
  duration: number;          // 总游戏时长(ms)
  balls: BallLaunch[];       // 每颗弹珠的详细数据
}

/** 游戏记录 */
export interface GameRecord {
  id: string;
  oderId: number;
  sessionId: string;
  gameType: GameType;
  score: number;             // 游戏得分
  pointsEarned: number;      // 实际获得积分（可能因上限被截断）
  duration: number;          // 游戏时长
  balls: number[];           // 每颗弹珠得分 [20, 40, 10, 80, 20]
  createdAt: number;
}

/** 每日统计 */
export interface DailyGameStats {
  oderId: number;
  date: string;              // YYYY-MM-DD
  gamesPlayed: number;       // 今日游戏局数
  totalScore: number;        // 今日总得分
  pointsEarned: number;      // 今日已获积分
  lastGameAt: number;        // 最后一局时间戳
}
```

### 5.2 Vercel KV 键值设计

| Key Pattern | Value Type | 说明 | TTL |
|-------------|------------|------|-----|
| `game:session:{sessionId}` | `GameSession` | 游戏会话 | 5分钟 |
| `game:active:{oderId}` | `string` | 用户当前活跃会话ID | 5分钟 |
| `game:daily:{oderId}:{date}` | `DailyGameStats` | 每日统计 | 48小时 |
| `game:records:{oderId}` | `List<GameRecord>` | 游戏记录（最近50条） | - |
| `game:cooldown:{oderId}` | `1` | 冷却标记 | 5秒 |
| `game:leaderboard:daily:{date}` | `SortedSet` | 每日排行榜 | 48小时 |
| `game:leaderboard:total` | `SortedSet` | 总积分排行榜 | - |

---

## 六、核心服务

### 6.1 游戏服务 game.ts

```typescript
// src/lib/game.ts

import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import type {
  GameSession,
  GameResultSubmit,
  GameRecord,
  DailyGameStats,
} from './types/game';
import { addPoints } from './points';

// ============ 常量配置 ============
const DAILY_POINTS_LIMIT = 1000;
const SESSION_TTL = 5 * 60;        // 5分钟
const COOLDOWN_TTL = 5;            // 5秒
const MIN_GAME_DURATION = 10000;   // 10秒
const BALLS_PER_GAME = 5;
const VALID_SLOT_SCORES = [5, 10, 20, 40, 80];
const MAX_POSSIBLE_SCORE = BALLS_PER_GAME * 80; // 400

// ============ Key 生成器 ============
const SESSION_KEY = (id: string) => `game:session:${id}`;
const ACTIVE_KEY = (oderId: number) => `game:active:${oderId}`;
const DAILY_KEY = (oderId: number, date: string) => `game:daily:${oderId}:${date}`;
const RECORDS_KEY = (oderId: number) => `game:records:${oderId}`;
const COOLDOWN_KEY = (oderId: number) => `game:cooldown:${oderId}`;

// ============ 工具函数 ============
function getTodayDateString(): string {
  const now = new Date();
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 10);
}

function generateSeed(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ============ 会话管理 ============

/**
 * 开始新游戏
 */
export async function startGame(oderId: number): Promise<{
  success: boolean;
  session?: GameSession;
  error?: string;
}> {
  // 1. 检查冷却
  const cooldown = await kv.get(COOLDOWN_KEY(oderId));
  if (cooldown) {
    return { success: false, error: '请稍后再试' };
  }

  // 2. 检查是否有活跃会话
  const activeSessionId = await kv.get<string>(ACTIVE_KEY(oderId));
  if (activeSessionId) {
    // 将旧会话标记为过期
    await kv.del(SESSION_KEY(activeSessionId));
  }

  // 3. 检查每日积分上限
  const today = getTodayDateString();
  const dailyStats = await kv.get<DailyGameStats>(DAILY_KEY(oderId, today));
  if (dailyStats && dailyStats.pointsEarned >= DAILY_POINTS_LIMIT) {
    return { success: false, error: '今日积分已达上限' };
  }

  // 4. 创建新会话
  const now = Date.now();
  const session: GameSession = {
    id: nanoid(),
    oderId,
    gameType: 'pachinko',
    seed: generateSeed(),
    startedAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    status: 'playing',
  };

  // 5. 保存会话
  await kv.set(SESSION_KEY(session.id), session, { ex: SESSION_TTL });
  await kv.set(ACTIVE_KEY(oderId), session.id, { ex: SESSION_TTL });

  return { success: true, session };
}

/**
 * 提交游戏结果
 */
export async function submitGameResult(
  oderId: number,
  result: GameResultSubmit
): Promise<{
  success: boolean;
  pointsEarned?: number;
  dailyTotal?: number;
  dailyRemaining?: number;
  error?: string;
}> {
  // 1. 获取并验证会话
  const session = await kv.get<GameSession>(SESSION_KEY(result.sessionId));
  
  if (!session) {
    return { success: false, error: '游戏会话不存在或已过期' };
  }
  
  if (session.oderId !== oderId) {
    return { success: false, error: '会话不属于当前用户' };
  }
  
  if (session.status !== 'playing') {
    return { success: false, error: '游戏已结束' };
  }

  // 2. 验证游戏结果
  const validation = validateGameResult(result);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }

  // 3. 标记会话为已完成（原子操作防重复提交）
  const updated = await kv.set(
    SESSION_KEY(result.sessionId),
    { ...session, status: 'completed' },
    { ex: 60, xx: true } // XX: 只在 key 存在时设置
  );
  
  if (!updated) {
    return { success: false, error: '提交失败，请重试' };
  }

  // 4. 计算可获得积分
  const today = getTodayDateString();
  const dailyStats = await kv.get<DailyGameStats>(DAILY_KEY(oderId, today)) || {
    oderId,
    date: today,
    gamesPlayed: 0,
    totalScore: 0,
    pointsEarned: 0,
    lastGameAt: 0,
  };

  const remaining = DAILY_POINTS_LIMIT - dailyStats.pointsEarned;
  const pointsToEarn = Math.min(result.score, remaining);

  // 5. 发放积分
  if (pointsToEarn > 0) {
    await addPoints(
      oderId,
      pointsToEarn,
      'game_play',
      `弹珠机游戏: ${result.score}分`
    );
  }

  // 6. 更新每日统计
  const newDailyStats: DailyGameStats = {
    ...dailyStats,
    gamesPlayed: dailyStats.gamesPlayed + 1,
    totalScore: dailyStats.totalScore + result.score,
    pointsEarned: dailyStats.pointsEarned + pointsToEarn,
    lastGameAt: Date.now(),
  };
  await kv.set(DAILY_KEY(oderId, today), newDailyStats, { ex: 48 * 60 * 60 });

  // 7. 保存游戏记录
  const record: GameRecord = {
    id: nanoid(),
    oderId,
    sessionId: result.sessionId,
    gameType: 'pachinko',
    score: result.score,
    pointsEarned: pointsToEarn,
    duration: result.duration,
    balls: result.balls.map(b => b.slotScore),
    createdAt: Date.now(),
  };
  await kv.lpush(RECORDS_KEY(oderId), record);
  await kv.ltrim(RECORDS_KEY(oderId), 0, 49); // 保留最近50条

  // 8. 设置冷却
  await kv.set(COOLDOWN_KEY(oderId), 1, { ex: COOLDOWN_TTL });

  // 9. 清理活跃会话标记
  await kv.del(ACTIVE_KEY(oderId));

  return {
    success: true,
    pointsEarned: pointsToEarn,
    dailyTotal: newDailyStats.pointsEarned,
    dailyRemaining: DAILY_POINTS_LIMIT - newDailyStats.pointsEarned,
  };
}

/**
 * 验证游戏结果
 */
function validateGameResult(result: GameResultSubmit): {
  valid: boolean;
  reason?: string;
} {
  // 1. 时长校验
  if (result.duration < MIN_GAME_DURATION) {
    return { valid: false, reason: '游戏时间异常' };
  }

  // 2. 分数范围校验
  if (result.score < 0 || result.score > MAX_POSSIBLE_SCORE) {
    return { valid: false, reason: '分数异常' };
  }

  // 3. 弹珠数量校验
  if (result.balls.length !== BALLS_PER_GAME) {
    return { valid: false, reason: '弹珠数量异常' };
  }

  // 4. 每颗弹珠分数合法性
  for (const ball of result.balls) {
    if (!VALID_SLOT_SCORES.includes(ball.slotScore)) {
      return { valid: false, reason: '槽位分数异常' };
    }
    // 发射参数校验
    if (ball.angle < -30 || ball.angle > 30) {
      return { valid: false, reason: '发射角度异常' };
    }
    if (ball.power < 0.5 || ball.power > 1.0) {
      return { valid: false, reason: '发射力度异常' };
    }
  }

  // 5. 总分一致性
  const sum = result.balls.reduce((acc, b) => acc + b.slotScore, 0);
  if (sum !== result.score) {
    return { valid: false, reason: '分数计算异常' };
  }

  return { valid: true };
}

// ============ 查询接口 ============

/**
 * 获取用户今日游戏统计
 */
export async function getDailyStats(oderId: number): Promise<DailyGameStats | null> {
  const today = getTodayDateString();
  return await kv.get<DailyGameStats>(DAILY_KEY(oderId, today));
}

/**
 * 获取用户游戏记录
 */
export async function getGameRecords(
  oderId: number,
  limit = 20
): Promise<GameRecord[]> {
  return (await kv.lrange<GameRecord>(RECORDS_KEY(oderId), 0, limit - 1)) ?? [];
}

/**
 * 检查用户是否在冷却中
 */
export async function isInCooldown(oderId: number): Promise<boolean> {
  const cooldown = await kv.get(COOLDOWN_KEY(oderId));
  return !!cooldown;
}

/**
 * 获取冷却剩余时间（秒）
 */
export async function getCooldownRemaining(oderId: number): Promise<number> {
  const ttl = await kv.ttl(COOLDOWN_KEY(oderId));
  return ttl > 0 ? ttl : 0;
}
```

---

## 七、API 路由设计

### 7.1 路由总览

| 路由 | 方法 | 说明 | 权限 |
|------|------|------|------|
| `/api/games/pachinko/start` | POST | 开始游戏 | 用户 |
| `/api/games/pachinko/submit` | POST | 提交结果 | 用户 |
| `/api/games/pachinko/status` | GET | 获取状态 | 用户 |
| `/api/games/records` | GET | 获取记录 | 用户 |

### 7.2 API 详细说明

#### POST /api/games/pachinko/start

开始新游戏，获取会话ID和随机种子。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "sessionId": "abc123xyz",
    "seed": "a1b2c3d4e5f6...",
    "expiresAt": 1705826700000
  }
}
```

**错误响应：**
```json
{
  "success": false,
  "error": "今日积分已达上限"
}
```

#### POST /api/games/pachinko/submit

提交游戏结果。

**请求体：**
```json
{
  "sessionId": "abc123xyz",
  "score": 170,
  "duration": 45000,
  "balls": [
    { "angle": -5, "power": 0.8, "slotScore": 20, "duration": 3500 },
    { "angle": 10, "power": 0.9, "slotScore": 40, "duration": 4200 },
    { "angle": -15, "power": 0.7, "slotScore": 10, "duration": 3800 },
    { "angle": 0, "power": 1.0, "slotScore": 80, "duration": 5100 },
    { "angle": 5, "power": 0.85, "slotScore": 20, "duration": 4000 }
  ]
}
```

**成功响应：**
```json
{
  "success": true,
  "data": {
    "pointsEarned": 170,
    "dailyTotal": 595,
    "dailyRemaining": 405
  }
}
```

#### GET /api/games/pachinko/status

获取当前游戏状态。

**响应示例：**
```json
{
  "success": true,
  "data": {
    "dailyStats": {
      "gamesPlayed": 5,
      "totalScore": 520,
      "pointsEarned": 520,
      "remaining": 480
    },
    "cooldown": {
      "active": false,
      "remaining": 0
    },
    "canPlay": true
  }
}
```

#### GET /api/games/records

获取游戏记录。

**查询参数：**
- `limit`: 返回条数，默认 20

**响应示例：**
```json
{
  "success": true,
  "data": {
    "records": [
      {
        "id": "rec_001",
        "score": 170,
        "pointsEarned": 170,
        "balls": [20, 40, 10, 80, 20],
        "createdAt": 1705826400000
      }
    ]
  }
}
```

---

## 八、前端技术方案

### 8.1 技术栈

| 用途 | 技术 | 说明 |
|------|------|------|
| 物理引擎 | Matter.js | 轻量级 2D 物理 |
| 确定性随机 | seedrandom | 保证相同种子相同结果 |
| 动画 | Framer Motion | 结算动画 |
| 音效 | Howler.js | 可选 |

### 8.2 文件结构

```
src/app/games/
├── page.tsx                    # 游戏大厅
└── pachinko/
    ├── page.tsx                # 弹珠机页面
    ├── components/
    │   ├── GameBoard.tsx       # 游戏画布
    │   ├── LaunchControl.tsx   # 发射控制器
    │   ├── ScoreDisplay.tsx    # 分数显示
    │   ├── ResultModal.tsx     # 结算弹窗
    │   └── Ball.tsx            # 弹珠组件
    ├── hooks/
    │   ├── useGameEngine.ts    # 物理引擎 Hook
    │   └── useGameSession.ts   # 会话管理 Hook
    └── lib/
        ├── physics.ts          # 物理配置
        └── constants.ts        # 游戏常量
```

### 8.3 物理引擎配置

```typescript
// src/app/games/pachinko/lib/physics.ts

import Matter from 'matter-js';
import seedrandom from 'seedrandom';

export interface PhysicsConfig {
  width: number;
  height: number;
  seed: string;
}

export function createGameWorld(config: PhysicsConfig) {
  const { Engine, World, Bodies, Body } = Matter;
  const rng = seedrandom(config.seed);
  
  const engine = Engine.create();
  engine.gravity.y = 1; // 重力
  
  // 创建边界
  const walls = [
    Bodies.rectangle(config.width / 2, -10, config.width, 20, { isStatic: true }),
    Bodies.rectangle(config.width / 2, config.height + 10, config.width, 20, { isStatic: true }),
    Bodies.rectangle(-10, config.height / 2, 20, config.height, { isStatic: true }),
    Bodies.rectangle(config.width + 10, config.height / 2, 20, config.height, { isStatic: true }),
  ];
  
  // 创建钉子（8层，交错排列）
  const pins: Matter.Body[] = [];
  const pinRadius = 5;
  const startY = 100;
  const rowSpacing = 40;
  const colSpacing = 40;
  
  for (let row = 0; row < 8; row++) {
    const isOffset = row % 2 === 1;
    const cols = isOffset ? 8 : 9;
    const startX = isOffset ? colSpacing : colSpacing / 2;
    
    for (let col = 0; col < cols; col++) {
      // 使用 seed 生成微小偏移
      const offsetX = (rng() - 0.5) * 4;
      const offsetY = (rng() - 0.5) * 4;
      
      const pin = Bodies.circle(
        startX + col * colSpacing + offsetX,
        startY + row * rowSpacing + offsetY,
        pinRadius,
        { isStatic: true, restitution: 0.5, label: 'pin' }
      );
      pins.push(pin);
    }
  }
  
  // 创建槽位分隔板
  const slotDividers: Matter.Body[] = [];
  const slotScores = [5, 10, 20, 40, 80, 40, 20, 10, 5];
  const slotWidth = config.width / slotScores.length;
  const slotY = config.height - 30;
  
  for (let i = 0; i <= slotScores.length; i++) {
    const divider = Bodies.rectangle(
      i * slotWidth,
      slotY,
      4,
      60,
      { isStatic: true, label: 'divider' }
    );
    slotDividers.push(divider);
  }
  
  // 创建槽位传感器（用于检测弹珠落入）
  const slotSensors = slotScores.map((score, i) => {
    return Bodies.rectangle(
      i * slotWidth + slotWidth / 2,
      config.height - 10,
      slotWidth - 8,
      20,
      { 
        isStatic: true, 
        isSensor: true, 
        label: `slot_${score}`,
        // 自定义属性
        // @ts-ignore
        slotScore: score,
      }
    );
  });
  
  World.add(engine.world, [...walls, ...pins, ...slotDividers, ...slotSensors]);
  
  return {
    engine,
    slotScores,
    
    // 创建弹珠
    createBall: (x: number, angle: number, power: number) => {
      const ball = Bodies.circle(x, 30, 10, {
        restitution: 0.6,
        friction: 0.001,
        label: 'ball',
      });
      
      // 根据角度和力度设置初始速度
      const radians = (angle * Math.PI) / 180;
      const speed = 5 + power * 10; // 基础速度 + 力度加成
      
      Body.setVelocity(ball, {
        x: Math.sin(radians) * speed,
        y: Math.cos(radians) * speed,
      });
      
      World.add(engine.world, ball);
      return ball;
    },
    
    // 移除弹珠
    removeBall: (ball: Matter.Body) => {
      World.remove(engine.world, ball);
    },
  };
}
```

### 8.4 游戏核心 Hook

```typescript
// src/app/games/pachinko/hooks/useGameEngine.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { createGameWorld } from '../lib/physics';

interface BallResult {
  angle: number;
  power: number;
  slotScore: number;
  duration: number;
}

interface GameState {
  status: 'idle' | 'playing' | 'launching' | 'waiting' | 'finished';
  ballsRemaining: number;
  currentScore: number;
  ballResults: BallResult[];
  launchParams: { angle: number; power: number };
}

export function useGameEngine(seed: string | null) {
  const engineRef = useRef<ReturnType<typeof createGameWorld> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>({
    status: 'idle',
    ballsRemaining: 5,
    currentScore: 0,
    ballResults: [],
    launchParams: { angle: 0, power: 0.75 },
  });
  
  // 初始化引擎
  useEffect(() => {
    if (!seed || !canvasRef.current) return;
    
    const world = createGameWorld({
      width: canvasRef.current.width,
      height: canvasRef.current.height,
      seed,
    });
    
    engineRef.current = world;
    
    // 碰撞检测
    Matter.Events.on(world.engine, 'collisionStart', (event) => {
      event.pairs.forEach((pair) => {
        const { bodyA, bodyB } = pair;
        
        // 检测弹珠落入槽位
        if (bodyA.label === 'ball' && bodyB.label.startsWith('slot_')) {
          const score = (bodyB as any).slotScore;
          handleBallLanded(bodyA, score);
        }
        if (bodyB.label === 'ball' && bodyA.label.startsWith('slot_')) {
          const score = (bodyA as any).slotScore;
          handleBallLanded(bodyB, score);
        }
      });
    });
    
    // 渲染循环
    const render = () => {
      if (!canvasRef.current) return;
      Matter.Engine.update(world.engine, 1000 / 60);
      drawWorld(canvasRef.current, world);
      requestAnimationFrame(render);
    };
    render();
    
    return () => {
      Matter.Engine.clear(world.engine);
    };
  }, [seed]);
  
  // 处理弹珠落槽
  const handleBallLanded = useCallback((ball: Matter.Body, score: number) => {
    // 计算该弹珠的飞行时间
    const duration = Date.now() - launchTimeRef.current;
    
    setGameState(prev => {
      const newResult: BallResult = {
        angle: prev.launchParams.angle,
        power: prev.launchParams.power,
        slotScore: score,
        duration,
      };
      
      const newResults = [...prev.ballResults, newResult];
      const newScore = prev.currentScore + score;
      const newRemaining = prev.ballsRemaining - 1;
      
      return {
        ...prev,
        status: newRemaining > 0 ? 'waiting' : 'finished',
        ballsRemaining: newRemaining,
        currentScore: newScore,
        ballResults: newResults,
      };
    });
    
    // 移除弹珠
    if (engineRef.current) {
      engineRef.current.removeBall(ball);
    }
  }, []);
  
  const launchTimeRef = useRef<number>(0);
  
  // 发射弹珠
  const launchBall = useCallback(() => {
    if (!engineRef.current || gameState.status === 'launching') return;
    
    const { angle, power } = gameState.launchParams;
    const startX = canvasRef.current!.width / 2;
    
    launchTimeRef.current = Date.now();
    engineRef.current.createBall(startX, angle, power);
    
    setGameState(prev => ({ ...prev, status: 'launching' }));
  }, [gameState.launchParams, gameState.status]);
  
  // 更新发射参数
  const setLaunchParams = useCallback((params: Partial<{ angle: number; power: number }>) => {
    setGameState(prev => ({
      ...prev,
      launchParams: { ...prev.launchParams, ...params },
    }));
  }, []);
  
  // 开始游戏
  const startGame = useCallback(() => {
    setGameState({
      status: 'playing',
      ballsRemaining: 5,
      currentScore: 0,
      ballResults: [],
      launchParams: { angle: 0, power: 0.75 },
    });
  }, []);
  
  return {
    canvasRef,
    gameState,
    launchBall,
    setLaunchParams,
    startGame,
  };
}

// 绘制函数（简化版）
function drawWorld(canvas: HTMLCanvasElement, world: ReturnType<typeof createGameWorld>) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 绘制所有物体...
  const bodies = Matter.Composite.allBodies(world.engine.world);
  bodies.forEach(body => {
    // 根据 label 使用不同样式绘制
    // ...
  });
}
```

---

## 九、实施任务清单

### P0 - 核心功能

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 1 | 游戏类型定义 | `src/lib/types/game.ts` | 0.5h |
| 2 | 游戏服务 | `src/lib/game.ts` | 2h |
| 3 | 开始游戏 API | `src/app/api/games/pachinko/start/route.ts` | 0.5h |
| 4 | 提交结果 API | `src/app/api/games/pachinko/submit/route.ts` | 1h |
| 5 | 游戏状态 API | `src/app/api/games/pachinko/status/route.ts` | 0.5h |
| 6 | 物理引擎配置 | `src/app/games/pachinko/lib/physics.ts` | 2h |
| 7 | 游戏核心 Hook | `src/app/games/pachinko/hooks/useGameEngine.ts` | 2h |
| 8 | 游戏画布组件 | `src/app/games/pachinko/components/GameBoard.tsx` | 2h |
| 9 | 发射控制组件 | `src/app/games/pachinko/components/LaunchControl.tsx` | 1h |
| 10 | 弹珠机主页面 | `src/app/games/pachinko/page.tsx` | 2h |

### P1 - 体验优化

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 11 | 结算弹窗组件 | `src/app/games/pachinko/components/ResultModal.tsx` | 1.5h |
| 12 | 积分飞入动画 | 结算组件内 | 1h |
| 13 | 游戏大厅页面 | `src/app/games/page.tsx` | 1h |
| 14 | 游戏记录 API | `src/app/api/games/records/route.ts` | 0.5h |
| 15 | 首页入口整合 | `src/app/page.tsx` | 0.5h |

### P2 - 增强功能

| # | 任务 | 文件路径 | 预估 |
|---|------|----------|------|
| 16 | 音效系统 | - | 1h |
| 17 | 排行榜功能 | - | 2h |
| 18 | 成就系统（可选） | - | - |

---

## 十、附录

### A. Matter.js 安装

```bash
npm install matter-js
npm install -D @types/matter-js
npm install seedrandom
npm install -D @types/seedrandom
```

### B. 游戏常量配置

```typescript
// src/app/games/pachinko/lib/constants.ts

export const GAME_CONFIG = {
  // 游戏规则
  BALLS_PER_GAME: 5,
  DAILY_POINTS_LIMIT: 1000,
  MIN_GAME_DURATION: 10000, // 10秒
  SESSION_TTL: 300, // 5分钟
  COOLDOWN_TTL: 5, // 5秒
  
  // 槽位分值
  SLOT_SCORES: [5, 10, 20, 40, 80, 40, 20, 10, 5],
  
  // 发射参数范围
  ANGLE_RANGE: { min: -30, max: 30 },
  POWER_RANGE: { min: 0.5, max: 1.0 },
  
  // 画布尺寸
  CANVAS_WIDTH: 360,
  CANVAS_HEIGHT: 640,
  
  // 物理参数
  BALL_RADIUS: 10,
  PIN_RADIUS: 5,
  GRAVITY: 1,
  BALL_RESTITUTION: 0.6,
  PIN_RESTITUTION: 0.5,
};
```

### C. 与积分商店对接

弹珠机游戏通过 `addPoints()` 函数与积分系统对接：

```typescript
import { addPoints } from '@/lib/points';

// 游戏结束后发放积分
await addPoints(
  oderId,
  pointsToEarn,
  'game_play',           // 积分来源类型
  `弹珠机游戏: ${score}分` // 描述
);
```

积分来源类型 `game_play` 已在 `points-store-design.md` 中定义。

---

## 十一、更新日志

| 版本 | 日期 | 内容 |
|------|------|------|
| 1.0 | 2026-01-21 | 初始版本 |
