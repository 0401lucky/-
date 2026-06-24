# Minesweeper 精确切流前置审计

本文记录扫雷 `/api/games/minesweeper/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 5 条扫雷路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/minesweeper*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-minesweeper-cutover.mjs
```

当前脚本会确认扫雷页面只依赖以下 5 条 API：

- `GET /api/games/minesweeper/status`
- `POST /api/games/minesweeper/start`
- `POST /api/games/minesweeper/step`
- `POST /api/games/minesweeper/submit`
- `POST /api/games/minesweeper/cancel`

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限、难度配置、历史记录和活跃会话。
- `start`：校验难度、冷却和活跃会话，创建服务端权威棋盘状态。
- `step`：服务端推进 reveal、flag、chord 操作，更新 `game_sessions.payload`。
- `submit`：只允许已完成或失败的会话结算，写积分、每日统计、游戏记录和冷却。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 完整棋盘和地雷状态保存在 PostgreSQL `game_sessions.payload`。
- 首次点击后服务端生成地雷，保证安全区无雷。
- `step` 只接受合法操作，批量操作有数量上限。
- `submit` 使用服务端状态计算分数和积分，不信任客户端分数。
- 结算后删除 active session；重复 `submit` 只回放已结算记录，不重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-minesweeper-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/minesweeper/status` 返回 401。
- 未登录 `POST /api/games/minesweeper/start` 返回 401。
- 未登录 `POST /api/games/minesweeper/step` 返回 401。
- 登录 `GET /api/games/minesweeper/status` 返回兼容状态字段。
- 登录 `POST /api/games/minesweeper/start` 创建 easy 会话。
- 登录 `POST /api/games/minesweeper/cancel` 清理活跃会话。
- 再次开始会话后，执行首次 reveal，再从数据库权威会话中读取雷位并 reveal 触发失败。
- `POST /api/games/minesweeper/submit` 写入失败局记录、积分和每日统计。
- 同一 `sessionId` 重复提交返回 200 并回放同一条已结算记录，不重复写积分或记录。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/minesweeper/status {
	reverse_proxy api:8080
}
handle /api/games/minesweeper/start {
	reverse_proxy api:8080
}
handle /api/games/minesweeper/step {
	reverse_proxy api:8080
}
handle /api/games/minesweeper/submit {
	reverse_proxy api:8080
}
handle /api/games/minesweeper/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/minesweeper* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-minesweeper-cutover.mjs
node --check scripts/smoke-minesweeper-go-api.mjs
node scripts/audit-minesweeper-cutover.mjs
node scripts/smoke-minesweeper-go-api.mjs
go test ./internal/minesweeper ./internal/httpserver -run 'Minesweeper' -count=1
go test -tags integration ./internal/httpserver -run 'Minesweeper' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后扫雷开局、操作、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 5 条 `/api/games/minesweeper/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-minesweeper-cutover.mjs`，确认 Gateway 扫雷规则状态与预期一致。
