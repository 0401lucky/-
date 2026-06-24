# Points 与 Eco Rankings 精确切流前置审计

本文记录积分查询 `GET /api/points` 和环保排行榜 `GET /api/rankings/eco` 的 Go 精确切流复核证据。
当前结论：两条路径已精确切到 Go，并补齐独立审计脚本和 Docker 直连 Go API 冒烟门禁；仍不打开 `/api/points*`、`/api/rankings/*` 或其它排行榜路径。

## 当前前端依赖

运行：

```bash
node scripts/audit-points-rankings-cutover.mjs
```

当前脚本会确认：

- 排行榜页只通过 `GET /api/rankings/eco?period=...&limit=...` 读取环保排行榜。
- 当前前端页面没有直接调用 `GET /api/points`；该接口仍作为精确 Go 路径保留，供已有登录态积分查询能力使用。

其它排行榜路径仍由 Next 处理，不属于本小块：

- `/api/rankings/games`
- `/api/rankings/points`
- `/api/rankings/checkin-streak`
- `/api/rankings/history`
- `/api/rankings/profile`
- `/api/rankings/lottery`

## Go 覆盖范围

`GET /api/points` 覆盖：

- 登录校验。
- 用户积分账户兜底创建。
- `balance`
- `logs`
- `id`
- `amount`
- `source`
- `description`
- `balance`
- `createdAt`

`GET /api/rankings/eco` 覆盖：

- 登录校验。
- `period` 归一化，非法值回落 daily。
- `limit` 上限收敛到 100。
- 从 `eco_trash_rankings` 读取 daily/weekly/monthly 榜。
- 按 `trash_cleared DESC, user_id ASC` 排序。
- 返回 `period`、`periodKey`、`generatedAt`、`totalParticipants`、`leaderboard`。
- 返回公开成就字段 `equippedAchievement`，包含强制佩戴优先级。

相关 PostgreSQL 迁移：

- `0001_base.sql`
- `0010_eco_base.sql`
- `0011_achievements.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-points-rankings-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建两个专用测试用户。
它会验证：

- `/readyz` 返回 200。
- 未登录 `GET /api/points` 返回 401。
- 未登录 `GET /api/rankings/eco` 返回 401。
- 登录 `GET /api/points` 返回测试余额 `1234` 和最近积分流水。
- 登录 `GET /api/rankings/eco?period=daily&limit=10` 返回两个测试用户。
- 环保排行榜按垃圾数降序排序。
- 排名第一用户返回 `beginner` 佩戴成就。
- Gateway 只打开 `handle /api/points {` 和 `handle /api/rankings/eco {`。
- 最后自动清理测试用户、积分账户、积分流水、环保榜数据和成就记录。

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/points {
	reverse_proxy api:8080
}
handle /api/rankings/eco {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/points* {
	reverse_proxy api:8080
}
handle /api/rankings/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-points-rankings-cutover.mjs
node --check scripts/smoke-points-rankings-go-api.mjs
node scripts/audit-points-rankings-cutover.mjs
node scripts/smoke-points-rankings-go-api.mjs
go test ./internal/economy ./internal/eco ./internal/httpserver -run 'Points|TrashLeaderboard|Ranking|Eco' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后积分查询或环保排行榜异常：

1. 从 `gateway/Caddyfile` 移除 `/api/points` 和 `/api/rankings/eco` 两条精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 数据，根据 `point_accounts`、`point_ledger`、`eco_trash_rankings` 和成就表做人工核对。
5. 复跑 `node scripts/audit-points-rankings-cutover.mjs`，确认 Gateway 规则状态与预期一致。
