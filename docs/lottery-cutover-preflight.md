# Lottery Cutover Preflight

本文记录彩票、数字炸弹和彩票排行榜的 Go 迁移边界。

当前结论：B4 已完成精确 Gateway 切流。彩票、数字炸弹、彩票排行榜、用户抽奖记录和旧后台彩票工具墓碑接口都进入 Go；仍禁止 `/api/lottery*`、`/api/admin/lottery*` 通配。

## B4-1 已完成范围

- 新增 PostgreSQL 表：
  - `lottery_configs`
  - `lottery_tiers`
  - `lottery_records`
  - `lottery_daily_spins`
- 新增 Go 服务：
  - `internal/lottery`
- 新增 Go 内部只读路由：
  - `GET /api/lottery`
  - `GET /api/admin/lottery`
- 已验证旧返回结构中的关键字段：
  - 前台：`success`、`user`、`records`、`enabled`、`mode`、`tiers`、`canSpin`、`hasSpunToday`、`extraSpins`、`dailySpinLimit`、`dailySpinUsed`、`dailySpinRemaining`、`allTiersHaveCodes`
  - 后台：`success`、`config`、`todayDirectTotal`、`tiers`、`probabilityMap`、`stats`、`records`、`pagination`

## B4-2 已完成范围

- 新增 Go 内部写路由：
  - `POST /api/lottery/spin`
- 当前只支持 `points` 模式：
  - 非 `points` 模式会明确返回“当前抽奖模式尚未迁移到 Go，请暂勿切流”。
  - `code`、`direct`、`hybrid` 仍需后续单独迁移。
- 写路径事务边界：
  - 同步 `users`、`point_accounts`、`user_assets`
  - 锁定 `lottery_daily_spins` 和 `user_assets`，避免每日次数与额外次数并发超扣
  - 积分中奖写 `point_accounts` 与 `point_ledger`
  - 写 `lottery_records`
  - 写 `game_records`
  - 写 `notifications` 的 `lottery_win`
- `pts_0` 谢谢惠顾仍写 `lottery_records`、`game_records` 和通知，但不写积分流水。

B4-2 不包含：

- 数字炸弹前台或后台路径
- `/api/rankings/lottery`
- Gateway 切流

## B4-3 已完成范围

- 新增 Go 内部后台配置路由：
  - `PATCH /api/admin/lottery/config`
- 保存规则：
  - 只允许 `points` 模式。
  - `dailySpinLimit` 必须是 1-100。
  - 提交 `tiers` 时必须覆盖当前所有档位。
  - 至少启用一个奖项。
  - 启用奖项概率合计必须为 100%，容差 0.01。
  - 档位名称、积分、颜色、概率和启停状态都会在 Go 服务层校验。
- 写入范围：
  - `lottery_configs`
  - `lottery_tiers`

B4-3 不包含：

- 数字炸弹结算 worker
- `/api/rankings/lottery`
- Gateway 切流

## B4-4 已完成范围

- 新增 PostgreSQL 表：
  - `number_bomb_draws`
  - `number_bomb_bets`
- 新增 Go 内部前台路由：
  - `GET /api/lottery/number-bomb`
  - `POST /api/lottery/number-bomb/bet`
  - `POST /api/lottery/number-bomb/cancel`
- 新增 Go 内部后台路由：
  - `GET /api/admin/lottery/number-bomb`
- 写路径事务边界：
  - 下注和修改投注锁定 `point_accounts` 与当天 `number_bomb_bets`
  - 修改投注按差额扣分或退款
  - 取消投注退还门票积分
  - `number_bomb_bets` 通过 `(user_id, bet_date)` 唯一约束保证单用户每日一条投注
  - 积分变动写 `point_ledger`，source 为 `number_bomb_bet` 或 `number_bomb_refund`
- 后台读取：
  - 会为今日生成或读取系统数字
  - 返回最近 7 天参与统计、数字分布、参与名单和中奖名单

B4-4 不包含：

- 昨日投注自动结算
- Go Worker 定时结算
- `number_bomb_reward` 奖励发放
- 数字炸弹中奖/失败通知
- `/api/rankings/lottery`
- Gateway 切流

## B4-5 已完成范围

- 新增 Go 服务方法：
  - `SettleNumberBombDate`
- Go Worker 接管每日数字炸弹结算：
  - 每天北京时间 00:00 结算昨日投注。
  - 空日期参数默认解析为昨日，便于 Worker 固定调用。
- 结算规则：
  - 用户选择数字不等于系统数字则中奖。
  - 中奖奖励为 `ticketCost * 2` 积分。
  - 失败不奖励。
  - 已取消投注计入 `skipped`，不派奖、不写开奖通知。
- 幂等边界：
  - 每次只处理 `number_bomb_bets.status = 'pending'` 的投注。
  - 重复执行不会重复写 `point_ledger` 的 `number_bomb_reward`。
  - 重复执行不会重复写数字炸弹开奖通知。
  - `number_bomb_draws` 的 `processed`、`won`、`lost`、`skipped` 从当前投注事实表派生回写，避免计数累加漂移。
- 写入范围：
  - `number_bomb_bets.status/system_number/reward_points/settled_at_ms`
  - `number_bomb_draws.processed/won/lost/skipped/settled_at_ms`
  - `point_accounts`
  - `point_ledger`，source 为 `number_bomb_reward`
  - `notifications`，中奖为 `lottery_win`，失败为 `system`

B4-5 不包含：

- `/api/rankings/lottery`
- `/api/lottery/records`
- `/api/lottery/ranking`
- 旧后台彩票 debug/reset/recalculate/tiers 工具迁移
- Gateway 切流

## B4-6 已完成范围

- 新增 Go 内部只读路由：
  - `GET /api/rankings/lottery`
  - `GET /api/lottery/ranking`
  - `GET /api/lottery/records`
- 聚合规则：
  - `GET /api/rankings/lottery` 支持 `period=daily|weekly|monthly` 和 `limit`。
  - `GET /api/lottery/ranking` 支持 `date` 和 `limit`，兼容旧今日排行榜响应。
  - `GET /api/lottery/records` 读取登录用户最近 20 条 `lottery_records`。
  - 排行榜从 `lottery_records` 按北京时间日/周/月窗口实时聚合，不再依赖旧 `lottery:rank:*` KV zset。
- 兼容响应：
  - 周期榜保留旧顶层 `period`、`periodKey`、`totalParticipants`、`ranking`。
  - 同时返回排行榜页使用的 `data` 包装。
  - `equippedAchievement` 暂返回 `null`，页面可降级展示；后续 B5 全排行榜统一补用户展示聚合。

B4-6 不包含：

- 旧后台彩票 debug/reset/recalculate/tiers 工具迁移
- Gateway 切流

## B4-7 已完成范围

- 旧后台彩票工具审计：
  - `/admin/lottery` 页面没有调用旧 debug/reset/recalculate/tiers 工具。
  - 这些接口主要服务旧兑换码库存模式和历史调试。
- Go 墓碑路由：
  - `GET /api/admin/lottery/debug`
  - `POST /api/admin/lottery/recalculate`
  - `POST /api/admin/lottery/reset`
  - `GET/POST/DELETE /api/admin/lottery/tiers/{tier}/codes`
  - `GET /api/admin/lottery/tiers/{tier}/detail`
- 处理策略：
  - 非管理员继续 403。
  - 写方法保留同源校验。
  - 管理员访问返回 410，明确提示旧彩票兑换码工具已停用。
  - 不访问 PostgreSQL 写路径，不访问旧 KV。
- Gateway 精确切流：
  - `GET /api/lottery`
  - `POST /api/lottery/spin`
  - `GET /api/lottery/records`
  - `GET /api/lottery/ranking`
  - `GET /api/lottery/number-bomb`
  - `POST /api/lottery/number-bomb/bet`
  - `POST /api/lottery/number-bomb/cancel`
  - `GET /api/rankings/lottery`
  - `GET /api/admin/lottery`
  - `PATCH /api/admin/lottery/config`
  - `GET /api/admin/lottery/number-bomb`
  - 旧后台彩票工具墓碑路径

B4-7 不包含：

- `/api/lottery*` 通配
- `/api/admin/lottery*` 通配
- 恢复旧兑换码库存模式

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

这些旧路径已由 Go 墓碑路由精确接住，避免直访落回 Next/KV。

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
   - 状态：已完成 Go 内部实现和真实 PostgreSQL 集成测试，未切 Gateway。

2. B4-2 转盘抽奖写路径：
   - `POST /api/lottery/spin`
   - Redis 或 PostgreSQL 事务保证每日次数和额外次数不会并发超扣。
   - 积分模式写 `point_accounts`、`point_ledger`、`game_records`、`notifications`。
   - 状态：已完成 Go 内部实现和真实 PostgreSQL 集成测试，未切 Gateway。

3. B4-3 后台配置：
   - `PATCH /api/admin/lottery/config`
   - 更新配置必须校验启用奖项概率合计为 100%。
   - 状态：已完成 Go 内部实现和真实 PostgreSQL 集成测试，未切 Gateway。

4. B4-4 数字炸弹：
   - `number_bomb_draws`
   - `number_bomb_bets`
   - `GET /api/lottery/number-bomb`
   - `POST /api/lottery/number-bomb/bet`
   - `POST /api/lottery/number-bomb/cancel`
   - 后台 `GET /api/admin/lottery/number-bomb`
   - 状态：已完成 Go 内部投注、修改、取消、前台读取和后台读取，未切 Gateway；结算 worker 留给 B4-5。

5. B4-5 worker 结算：
   - 用 Go Worker 直接替代旧 `/api/internal/number-bomb/settle` 调度入口。
   - Go Worker 定时结算昨日数字炸弹。
   - 中奖通知写 `notifications`，积分奖励写 `point_ledger`。
   - 状态：已完成 Go Worker 定时结算、奖励发放、通知和幂等集成测试，未切 Gateway。

6. B4-6 彩票排行榜：
   - 与 B5 的 `/api/rankings/lottery` 一起切。
   - 基于 `lottery_records` 聚合日榜、周榜、月榜。
   - 状态：已完成 Go 内部 `/api/rankings/lottery`、`/api/lottery/ranking` 和 `/api/lottery/records`，未切 Gateway。

## 当前禁切要求

Gateway 当前必须保持关闭：

- `/api/lottery/*`
- `/api/admin/lottery/*`

已审精确路径已打开；仍禁止通配或 `handle_path` 改写。

## Review 命令

```bash
node --check scripts/audit-lottery-cutover.mjs
node scripts/audit-lottery-cutover.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
docker compose config --quiet
go test ./internal/lottery ./internal/httpserver -run Lottery -count=1
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:5432/app?sslmode=disable go test -tags=integration ./internal/lottery -run 'TestService.*NumberBomb|TestServiceBuildsPageAndAdminSnapshot|TestServiceSpinPoints|TestServiceUpdateConfig' -count=1
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:5432/app?sslmode=disable go test -tags=integration ./internal/httpserver -run 'Lottery|NumberBomb' -count=1
```

## Zeabur 影响

- 当前 B4-0 不需要新增环境变量。
- 后续 Go 迁移需要新增 PostgreSQL migration。
- 不需要 Cloudflare KV/D1。
- 切流前必须重新构建并部署 GHCR 单容器镜像。
