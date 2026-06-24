# Roguelite 精确切流前置审计

本文记录星尘迷阵 `/api/games/roguelite/*` 前台使用路径的 Go 精确切流复核证据。
当前结论：前端实际使用的 5 条 Roguelite 路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；完整 `/api/games/roguelite*` 和 `/api/games/*` 通配仍保持关闭。

## 当前前端依赖

运行：

```bash
node scripts/audit-roguelite-cutover.mjs
```

当前脚本会确认 Roguelite 页面只依赖以下 5 条 API：

- `GET /api/games/roguelite/status`
- `POST /api/games/roguelite/start`
- `POST /api/games/roguelite/step`
- `POST /api/games/roguelite/submit`
- `POST /api/games/roguelite/cancel`

## Go 覆盖范围

Go 当前覆盖：

- `status`：返回余额、今日统计、冷却状态、每日上限、历史记录和活跃会话。
- `start`：校验冷却和活跃会话，创建服务端权威世界状态。
- `step`：服务端推进移动、战斗、事件、商店、宝箱和撤离操作。
- `submit`：只允许已撤离或已失败的会话结算，写积分、每日统计、游戏记录和冷却。
- `cancel`：清理当前活跃会话并设置短冷却。

结算安全点：

- 完整世界、玩家、待处理事件和行动计数保存在 PostgreSQL `game_sessions.payload`。
- `step` 只接受 Go 侧校验后的行动类型和参数。
- 行动日志只保留最近 120 条，但通过 `actionCount` 和 `moveCount` 保留总计数。
- `submit` 使用服务端状态计算分数和积分，不信任客户端分数。
- 结算后删除 active session；重复 `submit` 只回放已结算记录，不重复发分。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0012_game_runtime.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-roguelite-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/games/roguelite/status` 返回 401。
- 未登录 `POST /api/games/roguelite/start` 返回 401。
- 未登录 `POST /api/games/roguelite/step` 返回 401。
- 登录 `GET /api/games/roguelite/status` 返回兼容状态字段。
- 登录 `POST /api/games/roguelite/start` 创建 playing 会话。
- 登录 `POST /api/games/roguelite/cancel` 清理活跃会话。
- 再次开始会话后执行一次真实 `step`，确认 action count 推进。
- 将测试会话调整成 escaped 完成态，再执行 `submit`。
- 同一 `sessionId` 重复提交返回 200 并回放同一条已结算记录，不重复写积分或记录。
- 数据库中 `point_accounts`、`point_ledger`、`daily_game_points`、`game_daily_stats` 和 `game_records` 写入一致，active session 和 session 已清理。
- 最后自动清理测试用户、积分、会话、冷却、每日统计和游戏记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/games/roguelite/status {
	reverse_proxy api:8080
}
handle /api/games/roguelite/start {
	reverse_proxy api:8080
}
handle /api/games/roguelite/step {
	reverse_proxy api:8080
}
handle /api/games/roguelite/submit {
	reverse_proxy api:8080
}
handle /api/games/roguelite/cancel {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/games/roguelite* {
	reverse_proxy api:8080
}
handle /api/games/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-roguelite-cutover.mjs
node --check scripts/smoke-roguelite-go-api.mjs
node scripts/audit-roguelite-cutover.mjs
node scripts/smoke-roguelite-go-api.mjs
go test ./internal/roguelite ./internal/httpserver -run 'Roguelite' -count=1
go test -tags integration ./internal/httpserver -run 'Roguelite' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后 Roguelite 开局、行动、结算或取消异常：

1. 从 `gateway/Caddyfile` 移除 5 条 `/api/games/roguelite/...` 精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `game_sessions`、`active_game_sessions`、`game_records`、`point_accounts`、`point_ledger`、`daily_game_points` 和 `game_daily_stats` 做人工核对。
5. 复跑 `node scripts/audit-roguelite-cutover.mjs`，确认 Gateway Roguelite 规则状态与预期一致。
