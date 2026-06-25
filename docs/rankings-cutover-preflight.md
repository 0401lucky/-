# 排行榜 Go 切流预检

本文记录 B5 排行榜与历史奖励的 Go 迁移边界。

当前结论：B5-3 排行榜只读、历史只读与后台结算已完成精确 Gateway 切流。`/api/rankings/points`、`/api/rankings/games`、`/api/rankings/checkin-streak`、`/api/rankings/history`、`/api/admin/rankings/settle` 已进入 Go；继续禁止打开 `/api/rankings/*` 与 `/api/admin/*` 通配。

## 已切路径

- `GET /api/rankings/points`
- `GET /api/rankings/games`
- `GET /api/rankings/checkin-streak`
- `GET /api/rankings/history`
- `POST /api/admin/rankings/settle`

## PostgreSQL 数据源

- 积分总榜：`point_accounts`
- 月积分榜：`point_ledger`
- 游戏榜：`game_records`
- 签到连签榜：`checkin_records`
- 历史月榜巅峰：`point_ledger`
- 排行榜结算历史：`ranking_settlements`
- 排行榜结算派奖幂等：`ranking_reward_claims`
- 排行榜结算派奖账本：`point_accounts`、`point_ledger`
- 排行榜结算通知：`notifications`
- 月榜第一成就：`user_achievement_grants`、`user_equipped_achievements`、`user_forced_achievements`
- 用户展示资料：`users`、`user_profiles`
- 佩戴成就：`user_equipped_achievements`、`user_forced_achievements`、`user_achievement_grants`

## Gateway 边界

只允许精确路径：

```caddyfile
handle /api/rankings/points {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/rankings/games {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/rankings/checkin-streak {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/rankings/history {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
handle /api/admin/rankings/settle {
	reverse_proxy {$API_UPSTREAM:api:8080}
}
```

禁止：

```caddyfile
handle /api/rankings/*
handle /api/rankings*
handle_path /api/rankings
handle /api/admin/*
handle /api/admin*
```

## 验证命令

```bash
go test ./internal/rankings ./internal/httpserver -run 'Ranking|Rankings' -count=1
TEST_DATABASE_URL='postgres://app:app@localhost:5432/app?sslmode=disable' go test -tags=integration ./internal/rankings -run 'TestServiceReadOnlyLeaderboardsUsePostgres|TestServiceSettleRankingPeriodGrantsRewardsIdempotently' -count=1
node --check scripts/audit-rankings-cutover.mjs
node scripts/audit-rankings-cutover.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-points-rankings-cutover.mjs
```

## 回滚方式

从 `gateway/Caddyfile` 移除以下精确规则即可回退到 Next 旧路由：

- `/api/rankings/points`
- `/api/rankings/games`
- `/api/rankings/checkin-streak`
- `/api/rankings/history`
- `/api/admin/rankings/settle`

无需新增环境变量或挂载卷；需要应用 `0024_ranking_settlements.sql`。若仅回滚 Gateway，保留该表不影响旧链路。
