# 新功能交付路线图（2026-02-11）

> 目标：在不破坏现有稳定性的前提下，按可追踪节奏完成新功能建议。
>
> 范围来源：`plans/security_bug_tracker_20260210.md` 第 10 节。

## 1. 本期范围

### 1.1 纳入本期

- F1 站内通知系统
- F4 个人主页
- F5 全游戏排行榜
- F6 周期性排行榜
- F7 积分总榜
- F8 签到连续天数榜
- F9 管理员仪表盘
- F10 异常检测告警
- F12 公告管理

### 1.2 明确排除（按你的要求）

- F2 成就系统（本期不做）
- F3 邀请机制（本期不做）
- F11 活动系统（本期不做）

---

## 2. 现有能力复用清单（避免重复造轮子）

| 能力 | 已有实现 | 可复用点 |
|---|---|---|
| 用户鉴权 | `src/lib/auth.ts` | 所有新接口统一 `getAuthUser` |
| 管理鉴权 | `src/lib/api-guards.ts` | 管理端接口统一 `withAdmin` |
| 限流 | `src/lib/rate-limit.ts` | 站内通知、公告、排行榜统一限流 |
| 指标与告警 | `src/lib/metrics.ts` | F9/F10 直接基于现有计数器/告警模型 |
| 日志脱敏 | `src/lib/logging.ts` | 新日志统一脱敏输出 |
| 现有榜单 | `src/app/api/lottery/ranking/route.ts`、`src/app/api/games/slot/ranking/route.ts` | 扩展为统一榜单聚合层 |
| 游戏日统计 | `src/lib/daily-stats.ts` | F5/F8/F9 作为核心数据源 |
| 反馈会话 | `src/lib/feedback.ts` | F1 反馈回复通知直接接入 |

---

## 3. 交付里程碑（可追踪）

## M6：通知中心 + 公告管理（F1 + F12）

- [x] D1. 新增通知领域模型与存储层（KV）
- [x] D2. 新增用户通知 API（列表/未读数/标记已读）
- [x] D3. 新增管理员公告 API（创建/更新/下线）
- [x] D4. 公告发布自动 fan-out 到通知收件箱
- [x] D5. 前端新增“通知中心”入口与列表页
- [x] D6. 回归：通知读写、公告发布、权限控制

### 目标 API（规划）

- `GET /api/notifications`
- `POST /api/notifications/read`
- `GET /api/notifications/unread-count`
- `GET /api/announcements`
- `POST /api/admin/announcements`
- `PATCH /api/admin/announcements/[id]`
- `DELETE /api/admin/announcements/[id]`

### 建议新增文件（规划）

- `src/lib/notifications.ts`
- `src/lib/announcements.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/notifications/read/route.ts`
- `src/app/api/notifications/unread-count/route.ts`
- `src/app/api/announcements/route.ts`
- `src/app/api/admin/announcements/route.ts`
- `src/app/api/admin/announcements/[id]/route.ts`
- `src/app/notifications/page.tsx`

---

## M7：统一排行榜（F5 + F7 + F8）

- [x] D1. 统一榜单聚合层（按 game/day/week/month）
- [x] D2. 接入四个游戏榜单（slot/linkgame/match3/pachinko）
- [x] D3. 新增积分总榜接口
- [x] D4. 新增签到连续天数榜接口
- [x] D5. 前端新增“排行榜中心”页面
- [x] D6. 回归：排序、并列、分页、空数据

### 目标 API（规划）

- `GET /api/rankings/games?period=daily|weekly|monthly`
- `GET /api/rankings/points?period=all|monthly`
- `GET /api/rankings/checkin-streak?period=all|monthly`

### 建议新增文件（规划）

- `src/lib/rankings.ts`
- `src/app/api/rankings/games/route.ts`
- `src/app/api/rankings/points/route.ts`
- `src/app/api/rankings/checkin-streak/route.ts`
- `src/app/rankings/page.tsx`

---

## M8：周期榜结算与奖励（F6）

- [x] D1. 周榜/月榜结算任务（手动触发 + 可自动化）
- [x] D2. 奖励发放流水与幂等控制
- [x] D3. 结算结果写入历史归档
- [x] D4. 用户通知联动（发奖结果）
- [x] D5. 回归：重复结算保护、失败重试、补偿

### 目标 API（规划）

- `POST /api/admin/rankings/settle`
- `GET /api/rankings/history?period=weekly|monthly`

### 建议新增文件（规划）

- `src/lib/ranking-settlement.ts`
- `src/app/api/admin/rankings/settle/route.ts`
- `src/app/api/rankings/history/route.ts`

---

## M9：个人主页 + 管理仪表盘 + 异常告警（F4 + F9 + F10）

- [x] D1. 个人主页聚合接口（卡牌收藏、游戏记录、近期通知）
- [x] D2. 管理仪表盘接口（DAU/MAU、兑换量、积分流转）
- [x] D3. 异常检测规则（积分暴涨/短时高频抽奖）
- [x] D4. 告警面板与告警确认
- [x] D5. 回归：权限隔离、性能、误报率

### 目标 API（规划）

- `GET /api/profile/overview`
- `GET /api/admin/dashboard`
- `GET /api/admin/alerts`
- `POST /api/admin/alerts/[id]/resolve`

### 建议新增文件（规划）

- `src/lib/profile.ts`
- `src/lib/anomaly-detector.ts`
- `src/app/api/profile/overview/route.ts`
- `src/app/api/admin/dashboard/route.ts`
- `src/app/api/admin/alerts/route.ts`
- `src/app/api/admin/alerts/[id]/resolve/route.ts`
- `src/app/profile/page.tsx`
- `src/app/admin/dashboard/page.tsx`

---

## 4. 功能级进度追踪表（本期）

| 功能 | 里程碑 | 当前状态 | 负责人 | 验收标准（DoD） |
|---|---|---|---|---|
| F1 站内通知系统 | M6 | ✅ 已完成（首版） | Codex | 用户可查看未读数、列表、已读状态 |
| F4 个人主页 | M9 | ✅ 已完成（首版） | Codex | 聚合展示用户核心资产与近期记录 |
| F5 全游戏排行榜 | M7 | ✅ 已完成（首版） | Codex | 四类游戏统一榜单入口 |
| F6 周期性排行榜 | M8 | ✅ 已完成（首版） | Codex | 周/月结算可追溯且可重试 |
| F7 积分总榜 | M7 | ✅ 已完成（首版） | Codex | 支持周期筛选与分页 |
| F8 签到连续天数榜 | M7 | ✅ 已完成（首版） | Codex | 连续天数正确统计与排序 |
| F9 管理员仪表盘 | M9 | ✅ 已完成（首版） | Codex | DAU/MAU/兑换量/积分流转可视化 |
| F10 异常检测告警 | M9 | ✅ 已完成（首版） | Codex | 告警触发、查询、确认闭环 |
| F12 公告管理 | M6 | ✅ 已完成（首版） | Codex | 公告 CRUD + 通知联动 |

---

## 5. 执行顺序（最小风险）

1. 先做 M6（通知+公告）作为用户侧基础设施。
2. 再做 M7（统一榜单）沉淀聚合层。
3. 接着做 M8（周期结算）避免后续奖励口径不一致。
4. 最后做 M9（个人主页+仪表盘+异常告警）完成运营闭环。

---

## 6. 测试与验收策略

- 单元测试：新增 `src/lib/__tests__/notifications.test.ts`、`rankings.test.ts`、`ranking-settlement.test.ts`。
- 接口测试：新增 `src/__tests__/api/notifications-api.test.ts`、`dashboard-api.test.ts`。
- 回归命令：`npm run lint`、`npm test`。
- 每个里程碑完成后，必须回写 `security_bug_tracker_20260210.md` 的 F 状态与变更日志。

---

## 7. 本文档更新日志

| 日期 | 操作人 | 变更 |
|---|---|---|
| 2026-02-11 | Codex | 创建新功能交付路线图（排除 F2/F3/F11） |
| 2026-02-11 | Codex | 完成 M6 首版开发与回归（F1+F12：通知中心、公告管理、中奖/反馈通知） |
| 2026-02-11 | Codex | 完成 M7 首版开发与回归（F5/F7/F8：统一排行榜中心 + 三类榜单 API），并通过全量 `npm test` |
| 2026-02-11 | Codex | 完成 M8 首版开发与回归（F6：周期榜结算、奖励发放、历史归档、失败重试），并通过全量 `npm test` |
| 2026-02-11 | Codex | 完成 M9 首版开发与回归（F4/F9/F10：个人主页、管理仪表盘、异常检测告警），并通过 `npm run lint` + 全量 `npm test` |

