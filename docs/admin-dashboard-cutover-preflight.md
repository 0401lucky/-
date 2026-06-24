# Admin Dashboard 内部迁移前置审计

本文记录 PR #9 后台运营仪表盘接口 `/api/admin/dashboard` 的 Go 迁移证据。

当前结论：Go 内部 API 已覆盖后台仪表盘只读概览；Gateway 已精确切流 `/api/admin/dashboard`，仍禁止 `/api/admin/*` 通配。

## Go 覆盖范围

- `GET /api/admin/dashboard`
  - 参数：`detect`、`refresh`。
  - 返回 `data.dashboard`、`data.alerts`、`data.detection`。
  - 用户总数来自 `users`。
  - DAU/MAU 来自 `point_ledger`、`exchange_logs`、`game_records`、`raffle_entries` 的活跃用户聚合。
  - 今日兑换量来自 `exchange_logs`。
  - 今日抽奖次数来自 `raffle_entries`。
  - 今日积分流入/流出来自 `point_ledger`。
  - 今日游戏参与率来自 `game_records`。
  - Go 告警存储尚未迁移，`alerts` 当前显式返回空列表和 0 计数。
  - `detect=1` 当前返回扫描用户数和 `triggeredAlerts=0`，不伪造旧 D1/KV 告警逻辑。

## Review 命令

```bash
node --check scripts/audit-admin-dashboard-cutover.mjs
node --check scripts/smoke-admin-dashboard-go-api.mjs
node scripts/audit-admin-dashboard-cutover.mjs
go test ./internal/admindashboard ./internal/httpserver -run AdminDashboard -count=1
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/httpserver -run AdminDashboard -count=1
node scripts/smoke-admin-dashboard-go-api.mjs
```

## Gateway 状态

允许保留：

```caddyfile
handle /api/admin/dashboard {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

部署测试阶段只允许保留精确切流 `/api/admin/dashboard`，禁止新增 `/api/admin/*`。

## 回滚步骤

如后台仪表盘异常：

1. 临时移除 Gateway 中 `/api/admin/dashboard` 精确规则，让该路径回到 Web/Next。
2. 回退 Go `server.go` 中 `/api/admin/dashboard` 内部路由。
3. 复跑 `node scripts/audit-admin-dashboard-cutover.mjs`，确认 Gateway 仍未打开该路径。
