# Eco 精确切流前置审计

本文记录环保行动 `/api/games/eco/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 8 条环保路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/eco*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-eco-cutover.mjs
```

当前脚本会确认环保页面只依赖以下 8 条 API：

- `GET /api/games/eco/status`
- `POST /api/games/eco/collect`
- `POST /api/games/eco/buy`
- `POST /api/games/eco/claim-prize`
- `POST /api/games/eco/sell`
- `POST /api/games/eco/merchant-sell`
- `POST /api/games/eco/black-market-sell`
- `POST /api/games/eco/steal`

`/api/auth/me` 与 `/api/profile/settings` 属于登录和资料模块，不属于本文环保切流范围。

## Go 覆盖范围

Go 当前覆盖：

- `status`：重组旧前端兼容状态，包含积分、待回收、升级、道具、奖品、公开栏和可见奖品。
- `collect`：拖拽批量回收，事务内锁定用户环保状态，更新 `eco_states`、积分账户、积分流水、每日环保积分和 `eco_trash_rankings`。
- `buy`：升级和道具购买，事务内扣积分、写流水、更新升级等级或道具每日购买次数。
- `claim-prize`：从可见奖品领取到背包，可选同步写入公开栏。
- `sell`：普通出售可售奖品，入账积分并扣减库存/批次。
- `merchant-sell`：公开奖品到次日 6 点后商人收购，入账积分并清理公开条目。
- `black-market-sell`：偷来奖品躲过追查后黑市出售，入账积分并标记偷盗记录逃脱。
- `steal`：公开栏偷盗，锁定原主人和偷盗者状态，转移库存和批次，写入偷盗记录。

相关 PostgreSQL 迁移：

- `0010_eco_base.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-eco-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户和被偷盗用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/eco/status` 返回 401。
- 未登录 `POST /api/games/eco/collect` 返回 401。
- 登录 `GET /api/games/eco/status` 返回兼容状态字段。
- 登录 `POST /api/games/eco/collect` 回收 10 个垃圾，获得 1 积分，写入垃圾排行榜。
- 登录 `POST /api/games/eco/buy` 覆盖升级购买和道具购买。
- 登录 `POST /api/games/eco/claim-prize` 领取可见奖品并公开。
- 登录 `POST /api/games/eco/sell` 出售普通奖品。
- 登录 `POST /api/games/eco/merchant-sell` 商人收购公开奖品。
- 登录 `POST /api/games/eco/black-market-sell` 黑市出售偷来奖品，并标记偷盗记录 `escaped`。
- 登录 `POST /api/games/eco/steal` 从公开栏偷盗他人奖品。
- 数据库中 `eco_states`、`point_accounts`、`point_ledger`、`eco_user_upgrades`、`eco_item_purchases`、`eco_prize_inventory`、`eco_prize_lots`、`eco_public_prizes`、`eco_thefts` 和 `eco_trash_rankings` 写入结果一致。
- 最后自动清理测试用户和所有相关环保/积分数据。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/eco/status {
	reverse_proxy api:8080
}
handle /api/games/eco/collect {
	reverse_proxy api:8080
}
handle /api/games/eco/buy {
	reverse_proxy api:8080
}
handle /api/games/eco/claim-prize {
	reverse_proxy api:8080
}
handle /api/games/eco/sell {
	reverse_proxy api:8080
}
handle /api/games/eco/merchant-sell {
	reverse_proxy api:8080
}
handle /api/games/eco/black-market-sell {
	reverse_proxy api:8080
}
handle /api/games/eco/steal {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/eco* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-eco-cutover.mjs
node --check scripts/smoke-eco-go-api.mjs
node scripts/audit-eco-cutover.mjs
node scripts/smoke-eco-go-api.mjs
go test ./internal/eco ./internal/httpserver -run 'Eco|Collect|Prize|Steal|Buy' -count=1
go test -tags integration ./internal/eco ./internal/httpserver -run 'Eco|Collect|Prize|Steal|Buy' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后环保页面、拖拽结算、奖品或偷盗异常：

1. 从 `gateway/Caddyfile` 移除 8 条 `/api/games/eco/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 环保相关表，根据 `eco_states`、`point_accounts`、`point_ledger`、`eco_prize_inventory`、`eco_prize_lots`、`eco_public_prizes`、`eco_thefts` 和 `eco_trash_rankings` 做人工核对。
5. 复跑 `node scripts/audit-eco-cutover.mjs`，确认 Gateway 环保规则状态与预期一致。
