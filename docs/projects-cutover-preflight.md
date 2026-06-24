# Projects List 精确切流前置审计

本文记录公开福利项目列表 `GET /api/projects` 从 Next 切到 Go 后的复核证据。
当前结论：公开项目列表已精确切到 Go；后台项目管理已由独立 `admin-projects` 小块精确切到 Go；公开项目详情、领取记录和领取动作仍不属于本小块，不能打开 `/api/projects/*`。

## 当前前端依赖

运行：

```bash
node scripts/audit-projects-cutover.mjs
```

当前脚本会确认首页和商城页只通过以下路径读取公开福利项目列表：

- `GET /api/projects`

以下路径仍不属于本轮 Go 切流范围：

- `GET /api/projects/{id}`
- `POST /api/projects/{id}`
- `GET /api/projects/my-claims`
- 后台 `/api/admin/projects` 与 `/api/admin/projects/*` 由 `docs/admin-projects-cutover-preflight.md` 单独约束。

## Go 覆盖范围

Go 当前覆盖公开列表响应字段：

- `id`
- `name`
- `description`
- `maxClaims`
- `claimedCount`
- `codesCount`
- `status`
- `createdAt`
- `createdBy`
- `rewardType`
- `directPoints`
- `newUserOnly`
- `pinned`
- `pinnedAt`

数据来自 PostgreSQL `projects` 表，由 `0003_welfare_lists.sql` 建立。
Go 列表只返回 `status <> 'paused'` 的项目，并按置顶和创建时间排序。

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-projects-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建一个 active 项目和一个 paused 项目。
它会验证：

- `GET /api/projects` 返回 200。
- 响应中包含 active 测试项目。
- 响应中不包含 paused 测试项目。
- active 项目的 `directPoints`、`pinned` 等字段保持旧前端兼容。
- Gateway 只打开 `handle /api/projects {`。
- 最后自动清理测试项目。

## Gateway 精确规则

当前只允许：

```caddyfile
handle /api/projects {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/projects/* {
	reverse_proxy api:8080
}
handle /api/admin/projects* {
	reverse_proxy api:8080
}
```

## Review 命令

```bash
node --check scripts/audit-projects-cutover.mjs
node --check scripts/smoke-projects-go-api.mjs
node scripts/audit-projects-cutover.mjs
node scripts/smoke-projects-go-api.mjs
go test ./internal/welfare ./internal/httpserver -run 'Project|Welfare' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后首页或商城页的福利项目列表异常：

1. 从 `gateway/Caddyfile` 移除 `handle /api/projects`。
2. 重建并重启 `gateway`。
3. 复验 `GET /api/projects` 回落到 Next。
4. 保留 PostgreSQL `projects` 表，按 D1 原始导出抽样核对字段。
5. 复跑 `node scripts/audit-projects-cutover.mjs`，确认 Gateway 项目列表规则状态符合预期。
