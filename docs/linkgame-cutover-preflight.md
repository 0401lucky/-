# Linkgame 精确切流前置审计

本文记录连连看 `/api/games/linkgame/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 4 条连连看路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/linkgame*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-linkgame-cutover.mjs
```

当前脚本会确认连连看页面只依赖以下 4 条 API：

- `GET /api/games/linkgame/status`
- `POST /api/games/linkgame/start`
- `POST /api/games/linkgame/submit`
- `POST /api/games/linkgame/cancel`

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限和活跃会话。
- `start`：校验难度、冷却和活跃会话，创建服务端权威牌面。
- `submit`：服务端按 `tileLayout + moves` 校验匹配、完成、死局或超时，不信任客户端分数。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 完整牌面保存在 PostgreSQL `game_sessions.payload`。
- `ValidateResult` 会重放 moves 并拒绝已移除道具或非法匹配。
- `ValidateSettlementTiming` 会拒绝过短游戏和过早超时。
- 结算后删除 active session；重复 `submit` 只回放已结算记录，不重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-linkgame-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/linkgame/status` 返回 401。
- 未登录 `POST /api/games/linkgame/start` 返回 401。
- 登录 `GET /api/games/linkgame/status` 返回兼容状态字段。
- 登录 `POST /api/games/linkgame/start` 创建 easy 会话。
- 登录 `POST /api/games/linkgame/cancel` 清理活跃会话。
- 再次开始会话后，将测试会话改成 2 张相同牌，提交一条合法匹配。
- `POST /api/games/linkgame/submit` 结算成功，写入 1 积分和一条 win 记录。
- 同一 `sessionId` 重复提交返回 200 并回放同一条已结算记录，不重复写积分或记录。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/linkgame/status {
	reverse_proxy api:8080
}
handle /api/games/linkgame/start {
	reverse_proxy api:8080
}
handle /api/games/linkgame/submit {
	reverse_proxy api:8080
}
handle /api/games/linkgame/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/linkgame* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-linkgame-cutover.mjs
node --check scripts/smoke-linkgame-go-api.mjs
node scripts/audit-linkgame-cutover.mjs
node scripts/smoke-linkgame-go-api.mjs
go test ./internal/linkgame ./internal/httpserver -run 'Linkgame' -count=1
go test -tags integration ./internal/httpserver -run 'Linkgame' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后连连看开局、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 4 条 `/api/games/linkgame/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-linkgame-cutover.mjs`，确认 Gateway 连连看规则状态与预期一致。
