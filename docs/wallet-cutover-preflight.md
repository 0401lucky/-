# Wallet 精确切流审计

本文记录 `/store` 页面中的账户额度充值和提现 API 从 Next 精确切到 Go 的复核证据。
当前结论：`/api/store/topup` 与 `/api/store/withdraw` 已在 Gateway 精确切到 Go；本地已验证未登录边界、缺 new-api 配置安全失败、无错误写账和 Caddy 配置有效。生产仍需要 Zeabur 配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID` 后，用真实账号做余额、充值和提现冒烟。

## 当前前端依赖

运行：

```bash
npm run audit:wallet-cutover
```

当前脚本会确认前端钱包功能只依赖以下 API：

- `GET /api/store/topup`
- `POST /api/store/topup`
- `POST /api/store/withdraw`

调用位置：

- `/store` 页面打开充值弹层时读取 new-api 账户额度。
- `/store` 页面提交充值时用账户额度兑换积分。
- `/store` 页面提交提现时将积分兑换为账户额度。

注意：`/api/store`、`/api/store/exchange`、`/api/store/topup`、`/api/store/withdraw` 和 `/api/store/admin` 均已按精确路径切到 Go。

## Go 覆盖范围

Go 当前已覆盖旧前端需要的响应字段和行为：

- 余额查询：`newApiQuota`、`newApiUsedQuota`、`newApiBalanceDollars`、`newApiBalanceWholeDollars`、`quotaPerDollar`
- 充值：`success`、`message`、`uncertain`、`newBalance`、`pointsGained`、`newApiBalanceDollars`、`newApiBalanceWholeDollars`
- 提现：`success`、`message`、`uncertain`、`newBalance`、`dollars`、`feePoints`
- 未配置 new-api 管理端时返回 `503` 与 `code: "NEW_API_NOT_CONFIGURED"`，避免静默失败。
- Redis 钱包操作锁不可用时返回 `503` 与 `code: "WALLET_LOCK_UNAVAILABLE"`，避免并发写入失控。

写接口已接入：

- 登录校验。
- 可信来源校验。
- `store:exchange` 60 秒 20 次限流。
- `wallet_transactions` 审计表。
- 充值/提现结果不确定时的 `uncertain` 状态记录。

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-wallet-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，同时静态确认 Gateway 已打开钱包精确切流规则。

脚本会检查：

- `/readyz` 返回 200，且 PostgreSQL 与 Redis 均 ready。
- 未登录访问 `GET /api/store/topup` 返回 401。
- 未登录访问 `POST /api/store/topup` 返回 401。
- 未登录访问 `POST /api/store/withdraw` 返回 401。
- `gateway/Caddyfile` 包含且仅包含 `/api/store/topup`、`/api/store/withdraw` 两条钱包精确切流规则，不包含 `/api/store*` 通配。

真实登录账号可用后，使用登录态只读复验：

```bash
WALLET_GO_API_COOKIE="..." node scripts/smoke-wallet-go-api.mjs
```

Zeabur new-api 管理端配置完成后，必须要求余额接口真实可用：

```bash
WALLET_GO_API_COOKIE="..." WALLET_GO_API_EXPECT_NEW_API=1 node scripts/smoke-wallet-go-api.mjs
```

带 Cookie 模式只检查 `GET /api/store/topup` 只读余额接口，不触发充值或提现写操作。

## 缺配置写路径安全门禁

运行：

```bash
node scripts/smoke-wallet-write-missing-newapi-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
在本地未配置 new-api 管理端时，它会验证：

- 认证 `GET /api/store/topup` 返回 `503` 与 `code: "NEW_API_NOT_CONFIGURED"`。
- 认证 `POST /api/store/topup` 返回 `503` 与 `code: "NEW_API_NOT_CONFIGURED"`。
- 认证 `POST /api/store/withdraw` 返回 `503` 与 `code: "NEW_API_NOT_CONFIGURED"`。
- 不写入 `wallet_transactions`。
- 不写入 `point_ledger`。
- 不改变测试用户 `point_accounts.balance`。
- 最后自动清理测试用户、积分账户、钱包交易和积分流水。

该脚本只验证本地缺配置失败边界，不替代真实 new-api 配置后的充值/提现小金额冒烟。

## 必需环境变量

Zeabur API 服务必须配置：

```bash
NEW_API_URL=...
NEW_API_ADMIN_ACCESS_TOKEN=...
NEW_API_ADMIN_USER_ID=...
```

缺少任意一项时，Go API 可以启动，但钱包相关接口会返回 `503`。

## 精确 Gateway 规则

当前允许以下精确规则，不打开 `/api/store*` 通配：

```caddyfile
handle /api/store/topup {
	reverse_proxy api:8080
}
handle /api/store/withdraw {
	reverse_proxy api:8080
}
```

## 已验证项

1. `npm run audit:wallet-cutover` 通过。
2. `node scripts/smoke-wallet-go-api.mjs` 通过。
3. `node scripts/smoke-wallet-write-missing-newapi-go-api.mjs` 通过，确认缺配置时不写账。
4. `go test ./internal/economy ./internal/httpserver` 通过。
5. `docker run ... caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` 通过。
6. 本地 Gateway `GET /api/store/topup`、`POST /api/store/topup`、`POST /api/store/withdraw` 未登录均返回 401，且 API 日志显示请求进入 Go。

## 生产冒烟清单

1. Zeabur 已配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID`。
2. 带真实账号 Cookie 复跑 `WALLET_GO_API_COOKIE="..." WALLET_GO_API_EXPECT_NEW_API=1 node scripts/smoke-wallet-go-api.mjs` 通过。
3. 使用真实登录账号完成经 Gateway 的 `/store` 页面充值弹层余额读取冒烟。
4. 使用小金额完成一次真实充值冒烟，并核对：
   - new-api 额度被扣减。
   - PostgreSQL 积分余额增加。
   - `wallet_transactions` 写入 `topup/success` 或可解释的 `uncertain`。
5. 使用小积分完成一次真实提现冒烟，并核对：
   - PostgreSQL 积分余额扣减。
   - new-api 额度增加。
   - `wallet_transactions` 写入 `withdraw/success` 或可解释的 `uncertain`。
6. 充值和提现失败路径必须能在页面显示明确错误，不出现“结算失败但余额已变化”的不可解释状态。

## 回滚步骤

若切流后发现账户额度、积分余额或钱包审计记录异常：

1. 从 `gateway/Caddyfile` 移除上面两个 `handle /api/store/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验 `/api/store/topup` 和 `/api/store/withdraw` 回落到 Next。
4. 保留 PostgreSQL 写入记录，根据 `wallet_transactions`、`point_ledger` 和 new-api 用户额度做人工对账。
5. 回滚后需要临时调整 `scripts/audit-wallet-cutover.mjs` 或记录回滚豁免，因为当前审计期望钱包路径已精确切到 Go。
