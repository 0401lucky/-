# Notifications 精确切流审计

本文记录 `/notifications` 页面和通知入口从 Next 切到 Go 的复核证据。
当前结论：Zeabur fresh 新部署不再迁 Cloudflare D1 历史通知，已允许通知中心五个精确路径切到 Go；仍禁止 `/api/notifications*` 通配。

## 当前前端依赖

运行：

```bash
npm run audit:notifications-cutover
```

当前脚本会确认前端只依赖以下通知 API：

- `GET /api/notifications`
- `GET /api/notifications/unread-count`
- `POST /api/notifications/read`
- `POST /api/notifications/claim`
- `POST /api/notifications/delete`

调用位置：

- `SiteSidebar`：未读数徽标。
- `/notifications` 页面：列表、已读、领取、删除。
- 首页公告栏：公告通知列表和公告已读。

首页同时调用 `/api/announcements` 与 `/api/projects/my-claims`，这两个路径不属于通知切流范围。

## Go 覆盖范围

Go 当前已覆盖旧前端需要的响应字段和行为：

- 列表：`items`、`unreadCount`、`pagination`、`counts`
- 通知项：`id`、`userId`、`type`、`title`、`content`、`data`、`createdAt`、`readAt`、`isRead`
- 分页：`page`、`limit`、`total`、`totalPages`、`hasMore`
- 分类计数：`all`、`unread`、`prize`、`reply`、`system`、`redeem`
- 已读：`updated`、`unreadCount`
- 删除：`deleted`、`unreadCount`
- 领取：`claimStatus`

领取奖励当前支持：

- `points`：事务内写入积分账户和 `point_ledger`，重复领取不重复加分。
- `quota`：复用 new-api client；未配置 new-api 管理端时返回 `503`，避免静默失败。
- 缺失 `reward_claims` 时可从 reward 通知 `data` 恢复 pending claim。

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-notifications-go-api.mjs
node scripts/smoke-notifications-write-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，避免误走 Gateway。

脚本会检查：

- `/readyz` 返回 200，且 PostgreSQL 与 Redis 均 ready。
- 未登录访问 `GET /api/notifications?page=1&limit=5` 返回 401。
- 未登录访问 `GET /api/notifications/unread-count` 返回 401。
- 未登录访问 `POST /api/notifications/read` 返回 401。
- 未登录访问 `POST /api/notifications/delete` 返回 401。
- 未登录访问 `POST /api/notifications/claim` 返回 401。
- `gateway/Caddyfile` 只包含五个已批准的通知精确规则。

真实导入样本账号可用后，使用登录态只读复验：

```bash
NOTIFICATIONS_GO_API_COOKIE="..." node scripts/smoke-notifications-go-api.mjs
```

带 Cookie 模式只检查通知列表和未读数两个只读接口，不触发已读、删除或领取写操作。

`scripts/smoke-notifications-write-go-api.mjs` 会创建专用 Docker PostgreSQL 测试用户和三类通知，直连 Go API 验证登录态列表、未读数、标记已读、删除已读通知、领取 points 奖励和重复领取幂等。脚本会确认积分只入账一次、`reward_claims` 与通知 `claimStatus` 变为 `claimed`，最后清理测试用户、通知、奖励批次、领取记录和积分流水。

## 可选归档导入顺序

当前生产策略是 fresh Zeabur 新部署，不要求导入旧 Cloudflare D1 通知。
若后续需要归档导入旧通知，建议顺序：

```bash
go run ./cmd/migrate-d1 -input ./d1-export.sql -scope notifications
go run ./cmd/migrate-d1 -input ./d1-export.sql -scope reward-claims
```

需要执行真实导入时增加 `-apply`，并确保 `DATABASE_URL` 指向目标 PostgreSQL：

```bash
DATABASE_URL=... go run ./cmd/migrate-d1 -input ./d1-export.sql -scope notifications -apply
DATABASE_URL=... go run ./cmd/migrate-d1 -input ./d1-export.sql -scope reward-claims -apply
```

导入后至少核对：

- `notifications` 行数与 dry-run 估算一致或差异有 warning 可解释。
- `reward_batches` 与 `reward_claims` 已导入。
- reward 通知中 `claimStatus=pending` 的记录可对应到 `reward_claims`。
- 坏数据 warning 已人工确认，不影响当前用户可见通知。

## 精确 Gateway 草案

只允许评估以下精确规则，不打开 `/api/notifications*` 通配：

```caddyfile
handle /api/notifications {
	reverse_proxy api:8080
}
handle /api/notifications/unread-count {
	reverse_proxy api:8080
}
handle /api/notifications/read {
	reverse_proxy api:8080
}
handle /api/notifications/claim {
	reverse_proxy api:8080
}
handle /api/notifications/delete {
	reverse_proxy api:8080
}
```

## 切流检查项

1. `npm run audit:notifications-cutover` 通过。
2. `node scripts/smoke-notifications-go-api.mjs` 通过。
3. `node scripts/smoke-notifications-write-go-api.mjs` 通过。
4. 带真实样本账号 Cookie 复跑 `NOTIFICATIONS_GO_API_COOKIE="..." node scripts/smoke-notifications-go-api.mjs` 通过时，可作为线上只读证据。
5. `go test ./internal/notifications ./internal/rewards ./internal/httpserver` 通过。
6. Zeabur 上验证 `/notifications` 页面列表、已读、删除、领取按钮可用。
7. 验证 `SiteSidebar` 未读徽标正常。
8. 验证首页公告栏标记已读仍正常。
9. 若存在 `quota` 奖励，必须确认 Zeabur 环境已配置：
   - `NEW_API_URL`
   - `NEW_API_ADMIN_ACCESS_TOKEN`
   - `NEW_API_ADMIN_USER_ID`

## 回滚步骤

若切流后发现通知列表、已读、删除或领取异常：

1. 从 `gateway/Caddyfile` 移除上面五个 `handle /api/notifications...` 精确规则。
2. 重新构建并重启 Zeabur 单容器镜像。
3. 复验 `/api/notifications` 回落到 Next。
4. 保留 PostgreSQL 写入记录，必要时根据 `notifications`、`reward_claims`、`point_ledger` 做人工对账。
5. 若回滚到旧 Next API，临时补齐 `KV_REST_API_URL` / `KV_REST_API_TOKEN`，否则旧 KV 路径仍会报错。
