# Announcements Cutover Preflight

本文记录 `/api/announcements` 与 `/api/admin/announcements` 的 Go 迁移证据。

当前结论：公告公开列表、后台公告管理、发布 fanout 通知已由 Go API + PostgreSQL 接管，Gateway 只开放当前前端使用的 3 条精确规则。

## 范围

- `GET /api/announcements`
- `GET /api/admin/announcements`
- `POST /api/admin/announcements`
- `PATCH /api/admin/announcements/{id}`
- `DELETE /api/admin/announcements/{id}`

## PostgreSQL 表

- `announcements`：公告主体。
- `announcement_notifications`：公告通知 fanout 去重表。
- `notifications`：用户通知中心已有表，公告发布时写入 `type='announcement'`。

## 幂等规则

- 草稿公告不 fanout。
- 从草稿或归档状态发布时 fanout 给当前 `users` 表中的用户。
- `announcement_notifications (announcement_id, user_id)` 保证同一公告对同一用户只通知一次。
- 重复发布同一公告不会重复写通知。
- 归档公告不再出现在公开公告列表。

## Review 命令

```bash
node --check scripts/audit-announcements-cutover.mjs
node --check scripts/smoke-announcements-go-api.mjs
node scripts/audit-announcements-cutover.mjs
go test ./internal/announcements ./internal/httpserver -run Announcement -count=1
TEST_DATABASE_URL=postgres://app:app@127.0.0.1:5432/app?sslmode=disable go test -tags=integration ./internal/announcements -run Announcement -count=1
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/smoke-announcements-go-api.mjs
```

## Zeabur 影响

- 不需要新增环境变量。
- 不需要新增卷。
- 需要重新构建并部署 GHCR 单容器镜像。
- fresh PostgreSQL 部署必须先运行 `/app/migrate`，确保 `0021_announcements.sql` 已应用。

## 回滚方式

临时移除 `gateway/Caddyfile` 中三条公告规则：

- `handle /api/announcements`
- `handle /api/admin/announcements`
- `handle /api/admin/announcements/*`

移除后请求会回到 Next 旧实现。Zeabur fresh 部署没有 Cloudflare KV 配置时，旧实现可能继续出现 `KV backend not configured`，所以回滚只适合短期排障。
