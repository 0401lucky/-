# Whack Mole 精确切流前置审计

本文记录打地鼠 `/api/games/whack-mole/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 4 条打地鼠路径已精确切到 Go，Go/Gateway 额外保留只读 `sync` 精确路径，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/whack-mole*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-whack-mole-cutover.mjs
```

当前脚本会确认打地鼠页面只依赖以下 4 条 API：

- `GET /api/games/whack-mole/status`
- `POST /api/games/whack-mole/start`
- `POST /api/games/whack-mole/submit`
- `POST /api/games/whack-mole/cancel`

`GET /api/games/whack-mole/sync` 是 Go/Gateway 已审的只读会话同步路径，当前前端未直接调用，但仍按精确路径纳入门禁，避免后续恢复同步入口时误开通配。

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限、历史记录和活跃会话。
- `sync`：只读返回当前活跃会话视图，不写入游戏状态。
- `start`：校验难度、冷却和活跃会话，创建服务端记录的 seed、难度和有效期。
- `submit`：服务端按 `seed + difficulty + events` 重放打地鼠引擎，不信任客户端分数，写积分、每日统计、游戏记录和冷却。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 会话保存在 PostgreSQL `game_sessions.payload`。
- 提交时由 Go 侧 `ScoreEvents` 重放命中事件，积分由 `CalculatePointReward` 按难度计算。
- `ValidateEventsRate` 会限制异常命中频率。
- 结算后删除 active session，同一局重复提交会被拒绝，避免重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-whack-mole-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/whack-mole/status` 返回 401。
- 未登录 `GET /api/games/whack-mole/sync` 返回 401。
- 未登录 `POST /api/games/whack-mole/start` 返回 401。
- 登录 `GET /api/games/whack-mole/status` 返回兼容状态字段。
- 登录 `POST /api/games/whack-mole/start` 创建 normal 会话。
- 登录 `GET /api/games/whack-mole/sync` 返回当前会话视图。
- 登录 `POST /api/games/whack-mole/cancel` 清理活跃会话。
- 再次开始会话后，将测试会话 seed 固定为 `whack-test-seed-alpha`，用已知合法事件 `{ index: 2, elapsedMs: 10000 }` 触发结算。
- `POST /api/games/whack-mole/submit` 结算 10 分和 1 积分，返回 1 次命中、0 金色命中、0 失误、0 炸弹、最大连击 1。
- 同一 `sessionId` 重复提交返回 400。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/whack-mole/status {
	reverse_proxy api:8080
}
handle /api/games/whack-mole/sync {
	reverse_proxy api:8080
}
handle /api/games/whack-mole/start {
	reverse_proxy api:8080
}
handle /api/games/whack-mole/submit {
	reverse_proxy api:8080
}
handle /api/games/whack-mole/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/whack-mole* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-whack-mole-cutover.mjs
node --check scripts/smoke-whack-mole-go-api.mjs
node scripts/audit-whack-mole-cutover.mjs
node scripts/smoke-whack-mole-go-api.mjs
go test ./internal/whackmole ./internal/httpserver -run 'Whack' -count=1
go test -tags integration ./internal/httpserver -run 'Whack' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后打地鼠开局、同步、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 5 条 `/api/games/whack-mole/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-whack-mole-cutover.mjs`，确认 Gateway 打地鼠规则状态与预期一致。
