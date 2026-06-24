# Wallet 精确切流前置审计

本文记录 `/store` 页面中的账户额度充值和提现 API 从 Next 切到 Go 前必须复核的证据。
当前结论：Go 内部路由、服务层、限流、缺配置降级、直连 Go API 容器冒烟和本地缺 new-api 配置写路径安全门禁已完成，但缺少 Zeabur new-api 管理端配置与真实认证冒烟前不做生产切流结论。

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

注意：`/api/store`、`/api/store/exchange` 和 `/api/store/admin` 已经按精确路径切到 Go，不属于本次钱包切流范围。

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

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，避免误走 Gateway。

脚本会检查：

- `/readyz` 返回 200，且 PostgreSQL 与 Redis 均 ready。
- 未登录访问 `GET /api/store/topup` 返回 401。
- 未登录访问 `POST /api/store/topup` 返回 401。
- 未登录访问 `POST /api/store/withdraw` 返回 401。
- `gateway/Caddyfile` 不包含活跃 `/api/store/topup`、`/api/store/withdraw` 或 `/api/store*` 切流规则。

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

## 精确 Gateway 草案

只允许评估以下精确规则，不打开 `/api/store*` 通配：

```caddyfile
handle /api/store/topup {
	reverse_proxy api:8080
}
handle /api/store/withdraw {
	reverse_proxy api:8080
}
```

## 切流前置条件

1. Zeabur 已配置 `NEW_API_URL`、`NEW_API_ADMIN_ACCESS_TOKEN`、`NEW_API_ADMIN_USER_ID`。
2. `npm run audit:wallet-cutover` 通过。
3. `node scripts/smoke-wallet-go-api.mjs` 通过。
4. `node scripts/smoke-wallet-write-missing-newapi-go-api.mjs` 通过，确认缺配置时不写账。
5. 带真实账号 Cookie 复跑 `WALLET_GO_API_COOKIE="..." WALLET_GO_API_EXPECT_NEW_API=1 node scripts/smoke-wallet-go-api.mjs` 通过。
6. `go test ./internal/economy ./internal/httpserver` 通过。
7. `docker compose config --quiet` 通过。
8. 使用真实登录账号完成经 Gateway 的 `/store` 页面充值弹层余额读取冒烟。
9. 使用小金额完成一次真实充值冒烟，并核对：
   - new-api 额度被扣减。
   - PostgreSQL 积分余额增加。
   - `wallet_transactions` 写入 `topup/success` 或可解释的 `uncertain`。
10. 使用小积分完成一次真实提现冒烟，并核对：
   - PostgreSQL 积分余额扣减。
   - new-api 额度增加。
   - `wallet_transactions` 写入 `withdraw/success` 或可解释的 `uncertain`。
11. 充值和提现失败路径必须能在页面显示明确错误，不出现“结算失败但余额已变化”的不可解释状态。

## 回滚步骤

若切流后发现账户额度、积分余额或钱包审计记录异常：

1. 从 `gateway/Caddyfile` 移除上面两个 `handle /api/store/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验 `/api/store/topup` 和 `/api/store/withdraw` 回落到 Next。
4. 保留 PostgreSQL 写入记录，根据 `wallet_transactions`、`point_ledger` 和 new-api 用户额度做人工对账。
5. 复跑 `npm run audit:wallet-cutover`，确认 Gateway wallet 规则已清除。

## 当前不切流原因

- 本地和仓库内没有可用的生产 new-api 管理端配置。
- 直连 Go API 冒烟目前已完成未登录边界和本地缺配置写路径安全门禁；带真实 Cookie 且要求 new-api 可用的只读余额冒烟仍待 Zeabur 配置后执行。
- 尚未在 Zeabur 环境用真实登录账号完成余额读取、充值和提现冒烟。
- Gateway 当前没有活跃 `/api/store/topup`、`/api/store/withdraw` 或 `/api/store*` 规则，保持 Next 回落更稳妥。
