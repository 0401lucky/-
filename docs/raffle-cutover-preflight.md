# Raffle 精确切流前置审计

本文记录公开抽奖和抽奖后台从 Next 切到 Go 后的复核证据。
当前结论：公开 `/api/raffle` 列表、详情、参与路径和后台 `/api/admin/raffle` 管理路径已精确切到 Go；已补独立审计脚本和 Docker 直连 Go API 冒烟门禁；继续禁止 `/api/admin/*` 通配。

## 当前前端依赖

运行：

```bash
node scripts/audit-raffle-cutover.mjs
```

当前脚本会确认前端只依赖以下抽奖 API：

- `GET /api/raffle`
- `GET /api/raffle/{id}`
- `POST /api/raffle/{id}/join`
- `GET /api/admin/raffle`
- `POST /api/admin/raffle`
- `GET /api/admin/raffle/{id}`
- `PUT /api/admin/raffle/{id}`
- `DELETE /api/admin/raffle/{id}`
- `POST /api/admin/raffle/{id}/publish`
- `POST /api/admin/raffle/{id}/draw`
- `POST /api/admin/raffle/{id}/cancel`
- `POST /api/admin/raffle/{id}/retry`

调用位置：

- 首页和商城页读取 `GET /api/raffle?active=true`。
- 抽奖详情页读取 `GET /api/raffle/{id}` 并提交 `POST /api/raffle/{id}/join`。
- 抽奖后台列表、创建、详情、更新、删除、发布、开奖、取消和重试发奖均走 `/api/admin/raffle*`。

`/api/projects`、`/api/projects/{id}` 和福利项目领取不属于本文抽奖切流范围。

## Go 覆盖范围

Go 当前覆盖：

- 公开抽奖列表：活动模式、奖品、状态、参与人数、中奖人数、红包剩余点数和名额。
- 公开抽奖详情：活动详情、最近参与记录、登录用户参与/中奖状态。
- 普通抽奖参与：重复参与防护、阈值开奖入队、参与人数一致性。
- 抢红包参与：名额和点数行锁扣减、即时积分入账、活动自动结束。
- 后台管理：列表、创建、详情、更新、删除、发布、取消、手动开奖和重试发奖。
- 发奖链路：`raffle_delivery_jobs`、`user_raffle_wins`、`notifications` 和积分账本。

相关 PostgreSQL 迁移：

- `0003_welfare_lists.sql`
- `0005_raffle_detail.sql`
- `0006_raffle_user_wins.sql`
- `0007_notifications.sql`
- `0008_raffle_delivery_jobs.sql`

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-raffle-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建专用测试抽奖和测试用户。
它会验证：

- `GET /api/raffle`
- `GET /api/raffle/{id}`
- 未登录 `POST /api/raffle/{id}/join` 返回 401
- 登录态 `POST /api/raffle/{id}/join` 成功
- 重复参与返回 400
- 登录态详情包含 `userStatus.hasJoined`
- 未登录 `GET /api/admin/raffle` 返回 401
- 非管理员 `GET /api/admin/raffle` 返回 403
- 管理员 `GET /api/admin/raffle` 和 `GET /api/admin/raffle/{id}` 成功
- 数据库中参与人数和参与记录一致
- 最后自动清理测试抽奖、参与记录和测试用户

## Gateway 精确规则

当前只允许以下规则：

```caddyfile
handle /api/admin/raffle {
	reverse_proxy api:8080
}
handle /api/admin/raffle/* {
	reverse_proxy api:8080
}
handle /api/raffle {
	reverse_proxy api:8080
}
handle /api/raffle/* {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-raffle-cutover.mjs
node --check scripts/smoke-raffle-go-api.mjs
node scripts/audit-raffle-cutover.mjs
node scripts/smoke-raffle-go-api.mjs
go test ./internal/welfare ./internal/httpserver -run 'Raffle' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后抽奖列表、参与、后台管理或发奖出现异常：

1. 从 `gateway/Caddyfile` 移除 `/api/raffle`、`/api/raffle/*`、`/api/admin/raffle`、`/api/admin/raffle/*` 四条精确规则。
2. 重建并重启 `gateway`。
3. 复验相关路径回落到 Next。
4. 保留 PostgreSQL 抽奖相关表，按 `raffles`、`raffle_entries`、`raffle_delivery_jobs`、`user_raffle_wins`、`point_ledger` 和 `notifications` 做人工核对。
5. 复跑 `node scripts/audit-raffle-cutover.mjs`，确认 Gateway 抽奖规则状态与预期一致。
