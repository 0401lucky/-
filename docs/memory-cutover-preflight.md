# Memory 精确切流前置审计

本文记录记忆游戏 `/api/games/memory/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 5 条记忆游戏路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/memory*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-memory-cutover.mjs
```

当前脚本会确认记忆游戏页面只依赖以下 5 条 API：

- `GET /api/games/memory/status`
- `POST /api/games/memory/start`
- `POST /api/games/memory/flip`
- `POST /api/games/memory/submit`
- `POST /api/games/memory/cancel`

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限和活跃会话。
- `start`：校验难度、冷却、活跃会话，创建服务端权威布局。
- `flip`：服务端翻牌，响应只暴露已翻开/已匹配卡片。
- `submit`：服务端按 `moveLog` 复算结果，写积分、每日统计、游戏记录和冷却。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 完整卡片布局只保存在 PostgreSQL `game_sessions.payload`。
- 开局响应中的 `cardLayout` 全部为 `__hidden__`。
- 提交时会校验前端 moves 和服务端 `moveLog` 一致。
- 结算后删除 active session，同一局重复提交会被拒绝，避免重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-memory-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/memory/status` 返回 401。
- 未登录 `POST /api/games/memory/start` 返回 401。
- 登录 `GET /api/games/memory/status` 返回兼容状态字段。
- 登录 `POST /api/games/memory/start` 创建 easy 会话，且响应不泄露真实布局。
- 登录 `POST /api/games/memory/cancel` 清理活跃会话。
- 再次开始 easy 会话后，根据数据库权威布局完成全部配对翻牌。
- `POST /api/games/memory/submit` 结算 220 分和 24 积分。
- 同一 `sessionId` 重复提交返回 400。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/memory/status {
	reverse_proxy api:8080
}
handle /api/games/memory/start {
	reverse_proxy api:8080
}
handle /api/games/memory/flip {
	reverse_proxy api:8080
}
handle /api/games/memory/submit {
	reverse_proxy api:8080
}
handle /api/games/memory/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/memory* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-memory-cutover.mjs
node --check scripts/smoke-memory-go-api.mjs
node scripts/audit-memory-cutover.mjs
node scripts/smoke-memory-go-api.mjs
go test ./internal/memory ./internal/httpserver -run 'Memory' -count=1
go test -tags integration ./internal/httpserver -run 'Memory' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后记忆游戏开局、翻牌、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 5 条 `/api/games/memory/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-memory-cutover.mjs`，确认 Gateway 记忆游戏规则状态与预期一致。
