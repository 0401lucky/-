# Games Summary 精确切流前置审计

本文记录游戏中心汇总接口从 Next 切到 Go 前必须复核的证据。
当前结论：`/api/games/profile` 已完成精确切流，并通过本地 Gateway 页面冒烟和直连 Go API 聚合冒烟；`/api/games/overview` 暂无前端直接调用，仍不主动切流。

## 当前前端依赖

运行：

```bash
npm run audit:games-summary-cutover
```

当前脚本会确认前端游戏中心只直接依赖：

- `GET /api/games/profile`

`GET /api/games/overview` 旧 Next 路由仍存在，Go 已同步迁移为兼容能力，但当前页面代码没有直接调用它。

## Go 覆盖范围

Go 当前已覆盖旧游戏大厅需要的响应字段：

- 概览：`balance`、`dailyStats.gamesPlayed`、`dailyStats.pointsEarned`、`dailyLimit`、`pointsLimitReached`
- 个人战绩：`totalGamesPlayed`、`peakScore`、`peakGame`、`favoriteGame`、`mostWinsGame`、`mostWinsCount`、`bestStreakGame`、`bestStreak`、`winRate`
- 单游戏进度：`totalPlays`、`bestScore`、`totalPointsEarned`、`hasWinFlag`、`wins`、`bestWinStreak`
- `perGame` key 保持前端兼容：`roguelite`、`minesweeper`、`whack-mole`、`memory`、`match3`、`linkgame`

聚合数据来自 PostgreSQL：

- `point_accounts`
- `game_daily_stats`
- `game_records`

每个游戏最多读取最近 50 条记录，和旧 Next 实现的 `RECORD_FETCH_LIMIT = 50` 对齐。

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-games-summary-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试用户。
它会验证：

- 未登录 `GET /api/games/profile` 返回 401。
- 未登录 `GET /api/games/overview` 返回 401。
- 认证 `GET /api/games/profile` 返回余额、今日统计、最高分、常玩游戏、胜率和 `perGame` 聚合字段。
- 认证 `GET /api/games/overview` 返回余额、今日统计、每日上限和是否触顶字段。
- Gateway 只允许已切流的 `handle /api/games/profile {`，不允许 `/api/games/overview` 或 `/api/games/*`。
- 最后自动清理测试用户、积分账户、今日统计和游戏记录。

## 精确 Gateway 草案

当前已启用前端实际使用的精确规则，不打开 `/api/games/*` 通配：

```caddyfile
handle /api/games/profile {
	reverse_proxy api:8080
}
```

若后续前端重新启用 `/api/games/overview`，再单独评估：

```caddyfile
handle /api/games/overview {
	reverse_proxy api:8080
}
```

## 切流前置条件

1. `npm run audit:games-summary-cutover` 通过。
2. `node scripts/smoke-games-summary-go-api.mjs` 通过。
3. `go test ./internal/gamesummary ./internal/httpserver` 通过。
4. `TEST_DATABASE_URL=... go test -p 1 -tags integration ./internal/gamesummary ./internal/httpserver -run 'GameSummary|GetProfile' -count=1` 通过。
5. 本地 Gateway 页面冒烟：打开 `/games`，确认 `/api/games/profile` 返回 200。
6. 页面战绩卡片、最高分、常玩游戏、胜率、积分余额显示合理。
7. Gateway 只允许精确打开 `/api/games/profile`；不要打开 `/api/games/*`。

当前本地验证已完成以上条件。页面冒烟时仍可见既有 `/api/profile/settings` 503 和 `/api/farm/status` 500，本次切流不处理这两个路径。

## 回滚步骤

若切流后游戏大厅战绩、胜率或积分数据显示异常：

1. 从 `gateway/Caddyfile` 移除 `handle /api/games/profile`。
2. 重建并重启 `gateway`。
3. 复验 `/api/games/profile` 回落到 Next。
4. 保留 PostgreSQL `game_records` 和 `game_daily_stats`，按用户抽样对比旧 Next 返回与 Go 聚合差异。
5. 复跑 `npm run audit:games-summary-cutover`，确认 Gateway games summary 规则已清除。

## 当前保留项

- `/api/games/overview` 当前无前端直接调用，不需要为了已迁移而主动切流。
- `/api/games/*` 通配仍必须关闭，避免未知游戏子路径误转到 Go 的 `notMigratedHandler`。
