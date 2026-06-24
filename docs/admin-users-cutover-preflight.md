# Admin Users 内部迁移前置审计

本文记录 PR #9 后台用户管理接口 `/api/admin/users*` 的 Go 迁移证据。

当前结论：Go 内部 API 已覆盖后台用户列表、用户详情和“奉献者”成就颁发/撤销；Gateway 已精确切流 `/api/admin/users` 与 `/api/admin/users/*`，仍禁止 `/api/admin/*` 通配。

## Go 覆盖范围

- `GET /api/admin/users`
  - 参数：`page`、`limit`、`search`。
  - 返回用户列表、分页信息和第一页统计卡片。
  - `claimsCount` 当前基于 Go 侧 `exchange_logs` 聚合，作为 fresh Zeabur 新部署下的兑换记录统计。
  - `lotteryCount` 基于 `raffle_entries` 聚合。
- `GET /api/admin/users/{id}`
  - 返回兑换记录、抽奖参与记录和可管理成就列表。
  - 兑换记录当前读取 `exchange_logs`；旧 Cloudflare 项目码领取明细不再作为生产迁移前置条件。
  - 抽奖记录当前读取 `raffle_entries` + `raffles`。
- `POST /api/admin/users/{id}/achievements`
  - 仅允许手动操作 `contributor`。
  - `action=grant` 写入 `user_achievement_grants`。
  - `action=revoke` 删除授予记录，并在当前佩戴该成就时清理 `user_equipped_achievements`。

## Review 命令

```bash
node --check scripts/audit-admin-users-cutover.mjs
node --check scripts/smoke-admin-users-go-api.mjs
node scripts/audit-admin-users-cutover.mjs
go test ./internal/adminusers ./internal/httpserver -run AdminUser -count=1
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/httpserver -run AdminUser -count=1
node scripts/smoke-admin-users-go-api.mjs
```

## Gateway 状态

允许保留：

```caddyfile
handle /api/admin/users {
	reverse_proxy api:8080
}
handle /api/admin/users/* {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

部署测试阶段只允许保留精确切流 `/api/admin/users` 与 `/api/admin/users/*`，禁止新增 `/api/admin/*`。

## 回滚步骤

如后台用户管理异常：

1. 临时移除 Gateway 中 `/api/admin/users` 与 `/api/admin/users/*` 精确规则，让这些路径回到 Web/Next。
2. 回退 Go `server.go` 中 `/api/admin/users` 内部路由。
3. 对 `user_achievement_grants` 和 `user_equipped_achievements` 中相关用户的手动成就变更做人工核对。
4. 复跑 `node scripts/audit-admin-users-cutover.mjs`，确认 Gateway 仍未打开该路径。
