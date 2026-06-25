# Lottery Cutover Preflight

本文记录彩票、数字炸弹和彩票排行榜的 Go 迁移边界。

当前结论：B4 还未切 Gateway。现阶段只完成依赖审计和禁切门禁，后续必须按小块迁移并逐块 review。

## 前台彩票路径

- `GET /api/lottery`
- `POST /api/lottery/spin`
- `GET /api/lottery/number-bomb`
- `POST /api/lottery/number-bomb/bet`
- `POST /api/lottery/number-bomb/cancel`

历史上还存在：

- `GET /api/lottery/records`
- `GET /api/lottery/ranking`

当前前台彩票页未直接调用这两个路径，但个人主页、排行榜和后台统计仍依赖彩票记录数据，需要在 Go 数据模型里统一覆盖。

## 后台彩票路径

当前后台页面直接调用：

- `GET /api/admin/lottery`
- `PATCH /api/admin/lottery/config`
- `GET /api/admin/lottery/number-bomb`

旧后台 API 仍存在但当前页面未直接调用：

- `/api/admin/lottery/debug`
- `/api/admin/lottery/recalculate`
- `/api/admin/lottery/reset`
- `/api/admin/lottery/tiers/{tier}/codes`
- `/api/admin/lottery/tiers/{tier}/detail`

这些旧路径不能直接通配切到 Go，必须确认是否仍有入口或是否删除。

## 排行榜路径

- `GET /api/rankings/lottery`

该路径属于 B5 排行榜收口，但数据源依赖 B4 彩票记录表，所以 B4 需要先落 PostgreSQL 记录。

## 旧 KV 依赖

旧实现仍依赖以下 key 族：

- `lottery:config`
- `lottery:records`
- `lottery:user:records:{userId}`
- `lottery:daily_spin:{date}:user:{userId}`
- `lottery:rank:{period}:{periodKey}`
- `number-bomb:draw:{date}`
- `number-bomb:bet:{date}:user:{userId}`
- `number-bomb:bets:{date}`
- `number-bomb:user:records:{userId}`
- `number-bomb:settlement:{date}`

Zeabur fresh PostgreSQL 部署不配置 KV，所以这些必须迁到 PostgreSQL/Redis 后才能切 Gateway。

## 推荐拆分

1. B4-1 彩票基础表与配置读取：
   - `lottery_configs`
   - `lottery_tiers`
   - `lottery_records`
   - `lottery_daily_spins`
   - 先实现 `GET /api/lottery` 和 `GET /api/admin/lottery` 只读。

2. B4-2 转盘抽奖写路径：
   - `POST /api/lottery/spin`
   - Redis 或 PostgreSQL 事务保证每日次数和额外次数不会并发超扣。
   - 积分模式写 `point_accounts`、`point_ledger`、`game_records`、`notifications`。

3. B4-3 后台配置：
   - `PATCH /api/admin/lottery/config`
   - 更新配置必须校验启用奖项概率合计为 100%。

4. B4-4 数字炸弹：
   - `number_bomb_draws`
   - `number_bomb_bets`
   - `GET /api/lottery/number-bomb`
   - `POST /api/lottery/number-bomb/bet`
   - `POST /api/lottery/number-bomb/cancel`
   - 后台 `GET /api/admin/lottery/number-bomb`

5. B4-5 worker 结算：
   - 迁移 `/api/internal/number-bomb/settle`
   - Go Worker 定时结算昨日数字炸弹。
   - 中奖通知写 `notifications`，积分奖励写 `point_ledger`。

6. B4-6 彩票排行榜：
   - 与 B5 的 `/api/rankings/lottery` 一起切。
   - 基于 `lottery_records` 聚合日榜、周榜、月榜。

## 当前禁切要求

Gateway 当前必须保持关闭：

- `/api/lottery`
- `/api/lottery/*`
- `/api/admin/lottery`
- `/api/admin/lottery/*`

只允许在对应 Go 服务、测试、审计和 smoke 完成后逐条精确打开。

## Review 命令

```bash
node --check scripts/audit-lottery-cutover.mjs
node scripts/audit-lottery-cutover.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
docker compose config --quiet
```

## Zeabur 影响

- 当前 B4-0 不需要新增环境变量。
- 后续 Go 迁移需要新增 PostgreSQL migration。
- 不需要 Cloudflare KV/D1。
- 切流前必须重新构建并部署 GHCR 单容器镜像。
