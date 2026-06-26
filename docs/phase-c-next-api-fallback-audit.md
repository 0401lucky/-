# 阶段 C：Next API 回落风险审计

## 目标

阶段 C 的目标不是继续盲目扩大 Gateway 通配切流，而是先把仍可能落回
Next.js API 与旧 KV/D1 兼容层的路径列清楚，再按小块迁移或墓碑化。

审计脚本：

```bash
node scripts/audit-next-api-fallback-risk.mjs
```

脚本会同时检查：

1. `src/app/api/**/route.ts` 中仍存在的 Next API 文件。
2. `gateway/Caddyfile` 中已经转发到 Go API 的精确路径。
3. 前端页面和组件中直接调用的 `/api/...` 路径。
4. Next API 文件直接或间接引用旧 KV/D1 能力的风险。

## 当前审计结果

截至农场成熟/浇水邮件提醒迁入 Go Worker，且全部旧 internal cron
入口显式 410 后：

- Next API 文件总数：154
- Gateway 已处理规则数：149
- Gateway 已切到 Go 的规则数：145
- Gateway 直接返回 410 的旧入口规则数：4
- 已由 Go 接管的 Next API 路径：142
- 已墓碑化的旧工具/旧 internal 入口路径：10
- 仍需迁移或墓碑化：0
- 因外部配置暂缓：0
- 内部定时入口待 Worker 对齐：0

## 本轮已收口

1. `/api/admin/rewards`
   - Go 已实现后台奖励批次列表与创建发放。
   - 发放时写入 PostgreSQL `reward_batches`、`reward_claims`、`notifications`。
   - 用户领取仍走已有 Go `/api/notifications/claim`，最终写 `point_accounts` 与 `point_ledger`。

2. `/api/admin/rewards/*`
   - Go 已实现批次详情读取。
   - Gateway 仅精确打开 `/api/admin/rewards` 与 `/api/admin/rewards/*`，继续禁止 `/api/admin/*` 通配。

3. `/api/admin/store/reset`
   - 旧临时接口只会删除 Cloudflare D1/KV 的 `store:items`。
   - Go 已用 `410 ADMIN_STORE_RESET_DISABLED` 墓碑化。
   - Gateway 仅精确打开 `/api/admin/store/reset` 到 Go，不执行任何 PostgreSQL 商品删除或重置。

4. `/api/games/overview`
   - Go 已实现游戏中心概览聚合，从 PostgreSQL `point_accounts`、`game_daily_stats` 读取余额、今日统计和每日上限状态。
   - Gateway 已精确打开 `/api/games/overview` 到 Go。
   - 继续禁止 `/api/games/*` 通配。

5. `/api/cards/purchase`
   - 当前无前台直接调用，实际购买抽卡次数入口是商城 `card_draw` 商品。
   - Go 已用 `410 CARD_PURCHASE_DISABLED` 墓碑化旧直购接口。
   - Gateway 仅精确打开 `/api/cards/purchase` 到 Go，继续禁止 `/api/cards*` 通配。

6. `/api/farm/shop`
   - 当前无前台直接调用，但旧接口是只读商店列表。
   - Go 已实现兼容响应，返回 `items`、`inventory`、`balance`、`scarecrowUntil`、`bellUntil`。
   - Gateway 仅精确打开 `/api/farm/shop` 到 Go，继续禁止 `/api/farm*` 通配。

7. `/api/internal/eco/theft-investigation`
   - Go Worker 已每 10 分钟调用 `ProcessTheftInvestigations`。
   - Gateway 对旧 Next internal cron 入口直接返回 410，避免 Zeabur 继续落回 Next。

8. `/api/internal/number-bomb/settle`
   - Go Worker 已每天 16:00 调用 `SettleNumberBombDate`。
   - Gateway 对旧 Next internal cron 入口直接返回 410，避免 Zeabur 继续落回 Next。

9. `/api/internal/raffle/delivery`
   - Go Worker 已每 10 秒调用 `ProcessRaffleDeliveryQueue`。
   - Gateway 对旧 Next internal cron 入口直接返回 410，避免 Zeabur 继续落回 Next。

10. `/api/internal/farm/maturity-email`
   - Go Worker 已每 5 分钟扫描农场成熟和浇水提醒。
   - 邮件发送使用 Resend 配置；未配置时跳过发送，不影响 Worker 主循环。
   - 发送去重落在 PostgreSQL `farm_maturity_email_dedupes` 与 `farm_water_email_dedupes`。
   - Gateway 对旧 Next internal cron 入口直接返回 410，避免 Zeabur 继续落回 Next。

## 仍需迁移或墓碑化

当前为 0。

## 已处理的钱包外部依赖路径

以下路径和 new-api 外部账号额度有关，已精确切到 Go，但生产仍需要 Zeabur 配置 new-api 后做真实余额、充值和提现冒烟：

- `/api/store/topup`
- `/api/store/withdraw`

当前复核结论：

- Go 已实现钱包 HTTP 路由、服务层、可信来源校验、限流、Redis 钱包操作锁、
  `wallet_transactions` 审计和 `uncertain` 补偿状态。
- Gateway 当前已精确打开 `/api/store/topup`、`/api/store/withdraw`，仍禁止
  `/api/store*` 钱包通配规则。
- 本地缺 new-api 配置时，认证余额、充值和提现都会返回
  `NEW_API_NOT_CONFIGURED`，且不写钱包交易、积分流水或余额。

生产验证需要确认：

1. Zeabur 生产环境是否配置了 new-api 地址和凭据。
2. 充值、提现是否继续开放。
3. Go 侧是否需要保留“不确定状态”补偿语义。

## 内部入口

当前为 0。

已确认 4 个旧 internal cron 入口都由 Go Worker 接管，并已在 Gateway 层显式
410：

- `/api/internal/eco/theft-investigation`
- `/api/internal/number-bomb/settle`
- `/api/internal/raffle/delivery`
- `/api/internal/farm/maturity-email`

## 下一步执行顺序

1. 外部 new-api 配置就绪后，用真实账号执行只读余额冒烟。
2. 用小额真实账号执行充值/提现写路径补偿冒烟。

阶段 C 的完成标准：

```text
mustMigrateOrTombstone = 0
blockedByExternalConfig = 0
internalOnly 均有 Go Worker 对齐证据
默认 Zeabur 预检通过
```
