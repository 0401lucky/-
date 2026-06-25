# 后台工具 Go 切流预检

本文记录阶段 5 B6 剩余后台工具的 Go 迁移边界。

当前结论：B6-3 已完成剩余后台工具收口。`GET/PUT /api/admin/config` 已精确切到 Go，并写入 PostgreSQL `system_config`。Go 游戏结算和游戏中心/商城展示均读取同一 `daily_points_limit`。`GET /api/admin/alerts`、`POST /api/admin/alerts/{id}/resolve` 与后台仪表盘告警列表已切到 Go + PostgreSQL `admin_alerts`。`sync-users`、`fix-codes-count`、`migrate-*` 属于一次性迁移/修复工具，生产环境已由 Go 精确墓碑化，返回 410，不再回落 Next/KV。

## 页面依赖

- `/admin/settings` 调用 `GET /api/admin/config` 与 `PUT /api/admin/config`
- `/admin/dashboard` 调用 `GET /api/admin/dashboard` 与 `POST /api/admin/alerts/{id}/resolve`
- `/admin/users` 不再展示 `同步历史用户` 与 `迁移新人资格` 按钮，避免线上误触旧 Cloudflare/KV 工具。

## 处理决策

- `GET/PUT /api/admin/config`：已迁到 Go + PostgreSQL，Go 游戏读取同一每日积分上限。
- `GET /api/admin/alerts`、`POST /api/admin/alerts/{id}/resolve`：已迁到 Go + PostgreSQL，后台仪表盘从 `admin_alerts` 读取 active/history，处理告警会真实更新 `resolved`、`resolved_at_ms`、`resolved_by`。
- `POST /api/admin/sync-users`：生产 Go 墓碑化，返回 410。用户数据依赖登录/会话同步，不再手动扫旧 KV。
- `POST /api/admin/fix-codes-count`：生产 Go 墓碑化，返回 410；如仍需要，改离线 SQL/CLI。
- `POST /api/admin/migrate-native-hot-data`：生产 Go 墓碑化，返回 410；Cloudflare/D1 历史迁移不放在线上 API。
- `POST /api/admin/migrate-new-user-eligibility`：生产 Go 墓碑化，返回 410；页面入口已移除，如仍需要，改受控离线任务。

## Gateway 边界

已允许精确切流：

```caddyfile
handle /api/admin/config {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/alerts {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/alerts/* {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/sync-users {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/fix-codes-count {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/migrate-native-hot-data {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/migrate-new-user-eligibility {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
```

仍禁止打开：

```caddyfile
handle /api/admin/*
handle /api/admin*
```

## 验证命令

```bash
go test ./internal/systemconfig ./internal/httpserver ./internal/memory ./internal/match3 ./internal/game2048 ./internal/whackmole ./internal/minesweeper ./internal/linkgame ./internal/roguelite ./internal/gamesummary ./internal/economy -count=1
TEST_DATABASE_URL='postgres://app:app@localhost:5432/app?sslmode=disable' go test -tags=integration ./internal/systemconfig -run TestServiceUpdatesDailyPointsLimitAndTxReaderUsesPostgres -count=1
go test ./internal/admindashboard ./internal/httpserver -run 'AdminDashboard|AdminAlerts|AdminAlert' -count=1
go test ./internal/httpserver -run 'AdminUsers|AdminLegacyTools' -count=1
TEST_DATABASE_URL='postgres://app:app@localhost:5432/app?sslmode=disable' go test -tags=integration ./internal/httpserver -run AdminDashboard -count=1
node --check scripts/audit-admin-config-cutover.mjs
node scripts/audit-admin-config-cutover.mjs
node --check scripts/audit-admin-alerts-cutover.mjs
node scripts/audit-admin-alerts-cutover.mjs
node --check scripts/audit-admin-tools-cutover.mjs
node scripts/audit-admin-tools-cutover.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
```

## 下一小块

下一小块进入阶段 C 前置复核：确认 Next 旧 API 中仍会触发 `KV backend not configured` 的生产路径，按模块决定删除、墓碑化或继续精确切到 Go。继续禁止 `/api/admin/*` 通配。
