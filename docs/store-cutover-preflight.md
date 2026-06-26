# Store 精确切流前置审计

本文记录商城核心路径从 Next 切到 Go 后的复核证据。
当前结论：`/api/store`、`/api/store/exchange`、`/api/store/topup`、`/api/store/withdraw` 和 `/api/store/admin` 已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；`/api/store*` 通配仍禁止打开。

## 当前前端依赖

运行：

```bash
node scripts/audit-store-cutover.mjs
```

当前脚本会确认商城相关页面只依赖以下已知路径：

- `GET /api/store`
- `POST /api/store/exchange`
- `GET /api/store/topup`
- `POST /api/store/topup`
- `POST /api/store/withdraw`
- `/api/store/admin` 的 GET/POST/PUT/PATCH/DELETE

其中当前允许走 Go Gateway 的只有：

- `GET /api/store`
- `POST /api/store/exchange`
- `GET /api/store/topup`
- `POST /api/store/topup`
- `POST /api/store/withdraw`
- `/api/store/admin`

钱包路径的生产 new-api 真实冒烟仍由 `docs/wallet-cutover-preflight.md` 单独管理。

## Go 覆盖范围

Go 当前覆盖商城核心响应字段：

- `items`
- `categories`
- `balance`
- `recentExchanges`
- `dailyLimit`
- `dailyEarned`

兑换写路径覆盖：

- 登录校验。
- 可信来源校验。
- `store:exchange` 60 秒 20 次限流。
- PostgreSQL 事务扣分。
- 每日限购。
- 库存计数。
- `exchange_logs` 兑换日志。
- `user_assets` 奖励资产。
- `idempotency_keys` 幂等键，避免同一请求重复扣分。

商城后台覆盖：

- 管理员鉴权。
- 商品列表和分类列表。
- 商品创建、更新、删除。
- 分类保存。
- 农场商品 override 配置读取和保存。

相关 PostgreSQL 迁移：

- `0002_store.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-store-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户、管理员、分类和商品。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/store` 返回 401。
- 未登录 `POST /api/store/exchange` 返回 401。
- 登录 `GET /api/store` 返回商城核心字段，并包含测试分类和商品。
- 登录 `POST /api/store/exchange` 成功兑换补签卡。
- 使用相同 `idempotencyKey` 重复兑换不会重复扣分、重复写兑换日志或重复增加资产。
- 数据库中余额、兑换日志、积分流水、资产、每日限购和商品购买次数一致。
- 未登录 `GET /api/store/admin` 返回 401。
- 非管理员 `GET /api/store/admin` 返回 403。
- 管理员 `GET /api/store/admin` 返回商品、分类和农场商品配置。
- 最后自动清理测试用户、积分、兑换日志、资产、限购计数、测试商品、测试分类和幂等键。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/store {
	reverse_proxy api:8080
}
handle /api/store/exchange {
	reverse_proxy api:8080
}
handle /api/store/topup {
	reverse_proxy api:8080
}
handle /api/store/withdraw {
	reverse_proxy api:8080
}
handle /api/store/admin {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/store* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-store-cutover.mjs
node --check scripts/smoke-store-go-api.mjs
node scripts/audit-store-cutover.mjs
node scripts/smoke-store-go-api.mjs
go test ./internal/economy ./internal/httpserver -run 'Store|Exchange' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后商城列表、兑换或后台配置异常：

1. 从 `gateway/Caddyfile` 移除 `/api/store`、`/api/store/exchange`、`/api/store/admin` 三条精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 商城相关表，根据 `point_accounts`、`point_ledger`、`exchange_logs`、`user_assets` 和 `store_daily_purchases` 做人工对账。
5. 复跑 `node scripts/audit-store-cutover.mjs`，确认 Gateway 商城规则状态与预期一致。
