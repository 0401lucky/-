# Match3 精确切流前置审计

本文记录消消乐 `/api/games/match3/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 4 条消消乐路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/match3*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-match3-cutover.mjs
```

当前脚本会确认消消乐页面只依赖以下 4 条 API：

- `GET /api/games/match3/status`
- `POST /api/games/match3/start`
- `POST /api/games/match3/submit`
- `POST /api/games/match3/cancel`

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限、历史记录和活跃会话。
- `start`：校验冷却、活跃会话，创建服务端记录的 seed、配置和有效期。
- `submit`：服务端按 `seed + config + moves` 重放消消乐引擎，不信任客户端分数，写积分、每日统计、游戏记录和冷却。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 会话保存在 PostgreSQL `game_sessions.payload`。
- 开局只返回前端需要的 `sessionId`、`seed`、`config`、`timeLimitMs` 和时间戳。
- 提交时由 Go 侧 `SimulateGame` 重放 moves，积分由 `CalculatePointReward` 计算。
- 结算后删除 active session，同一局重复提交会被拒绝，避免重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-match3-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/match3/status` 返回 401。
- 未登录 `POST /api/games/match3/start` 返回 401。
- 登录 `GET /api/games/match3/status` 返回兼容状态字段。
- 登录 `POST /api/games/match3/start` 创建 8x8、6 类型会话。
- 登录 `POST /api/games/match3/cancel` 清理活跃会话。
- 再次开始会话后，将测试会话 seed 固定为 `seed-for-test`，用已知合法交换 `{ from: 4, to: 12 }` 触发结算。
- `POST /api/games/match3/submit` 结算 27 分和 2 积分，返回 1 步、2 次连锁、清除 6 个方块。
- 同一 `sessionId` 重复提交返回 400。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/match3/status {
	reverse_proxy api:8080
}
handle /api/games/match3/start {
	reverse_proxy api:8080
}
handle /api/games/match3/submit {
	reverse_proxy api:8080
}
handle /api/games/match3/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/match3* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-match3-cutover.mjs
node --check scripts/smoke-match3-go-api.mjs
node scripts/audit-match3-cutover.mjs
node scripts/smoke-match3-go-api.mjs
go test ./internal/match3 ./internal/httpserver -run 'Match3' -count=1
go test -tags integration ./internal/httpserver -run 'Match3' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后消消乐开局、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 4 条 `/api/games/match3/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-match3-cutover.mjs`，确认 Gateway 消消乐规则状态与预期一致。
