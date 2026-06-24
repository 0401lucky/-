# Admin Points 内部迁移前置审计

本文记录 PR #9 管理员积分接口 `/api/admin/points` 的 Go 迁移证据。

当前结论：Go 内部 API 已覆盖积分查询和管理员加减积分；Gateway 已精确切流 `/api/admin/points`，仍禁止 `/api/admin/*` 通配。

## Go 覆盖范围

- `GET /api/admin/points`
  - 参数：`userId`、`page`、`limit`。
  - 返回目标用户当前积分、分页流水和分页信息。
  - 目标用户不存在时返回余额 `0` 和空流水，不创建用户。
- `POST /api/admin/points`
  - 参数：`userId`、`amount`、`description`。
  - `amount > 0` 增加积分，`amount < 0` 扣除积分。
  - 单次调整限制为 `1,000,000` 积分。
  - 说明会写入 `[管理员:{username}]` 前缀。
  - 积分不足时返回业务失败，不写入负余额。

## Review 命令

```bash
node --check scripts/audit-admin-points-cutover.mjs
node --check scripts/smoke-admin-points-go-api.mjs
node scripts/audit-admin-points-cutover.mjs
go test ./internal/economy ./internal/httpserver -run 'Admin|Points' -count=1
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/economy -run AdminPoints -count=1
node scripts/smoke-admin-points-go-api.mjs
```

## Gateway 状态

允许保留：

```caddyfile
handle /api/admin/points {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

部署测试阶段只允许保留精确切流 `/api/admin/points`，禁止新增 `/api/admin/*`。

## 回滚步骤

如管理员积分调整异常：

1. 临时移除 Gateway 中 `/api/admin/points` 精确规则，让该路径回到 Web/Next。
2. 回退 Go `server.go` 中 `/api/admin/points` 内部路由。
3. 根据 `point_ledger` 和 `point_accounts` 对相关用户做人工核对。
4. 复跑 `node scripts/audit-admin-points-cutover.mjs`，确认 Gateway 仍未打开该路径。
