# Projects 精确切流前置审计

本文记录公开福利项目 `GET /api/projects`、`GET /api/projects/{id}`、
`POST /api/projects/{id}` 和 `GET /api/projects/my-claims` 从 Next/KV
收口到 Go/PostgreSQL 后的复核证据。

当前结论：公开项目列表、详情、直充领取和我的领取记录已精确切到 Go；后台项目管理由 `admin-projects` 小块精确切到 Go。

## 当前前端依赖

运行：

```bash
node scripts/audit-projects-cutover.mjs
```

当前脚本会确认首页、商城页和项目详情页使用以下路径：

- `GET /api/projects`
- `GET /api/projects/{id}`
- `POST /api/projects/{id}`
- `GET /api/projects/my-claims`
- 后台 `/api/admin/projects` 与 `/api/admin/projects/*` 由 `docs/admin-projects-cutover-preflight.md` 单独约束。

## Go 覆盖范围

Go 当前覆盖公开列表和详情响应字段：

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

直充领取由 Go 事务处理：

- 锁定项目行。
- 按用户和项目串行化领取。
- 重复领取返回已领取结果，不重复加积分。
- 写入 `point_accounts`、`point_ledger` 和 `exchange_logs`。
- 更新 `projects.claimed_count`，满额后自动置为 `exhausted`。
- `0027_project_claims.sql` 为 `exchange_logs(user_id,item_id)` 的 `project_direct` 记录加唯一索引。

历史兑换码项目暂不在 Zeabur 新后端继续发码，领取时返回明确错误。

## 直连 Go API 冒烟

运行：

```bash
node scripts/smoke-projects-go-api.mjs
```

当前脚本默认通过 `docker compose exec -T api` 直连 Go API 容器，并创建一个 active 项目和一个 paused 项目。
它会验证：

- `GET /api/projects` 返回 200。
- `GET /api/projects/{id}` 匿名可读取，`claimed` 为 `null`。
- `GET /api/projects/my-claims` 未登录返回 401。
- `POST /api/projects/{id}` 登录后直充积分成功。
- 重复 `POST /api/projects/{id}` 不重复加积分。
- `GET /api/projects/my-claims` 登录后返回已领取项目 ID。
- 响应中包含 active 测试项目。
- 响应中不包含 paused 测试项目。
- active 项目的 `directPoints`、`pinned` 等字段保持旧前端兼容。
- Gateway 只打开已审 projects 精确规则。
- 最后自动清理测试项目、用户、积分流水和兑换日志。

## Gateway 精确规则

当前只允许：

```caddyfile
handle /api/projects {
	reverse_proxy api:8080
}
handle /api/projects/my-claims {
	reverse_proxy api:8080
}
handle /api/projects/* {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/projects* {
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
TEST_DATABASE_URL='postgres://app:app@localhost:5432/app?sslmode=disable' go test -tags=integration ./internal/httpserver -run 'PublicProject|AdminProject' -count=1
docker compose config --quiet
```

## 回滚步骤

若切流后首页、商城页或项目详情页的福利项目异常：

1. 从 `gateway/Caddyfile` 移除 `handle /api/projects`、`handle /api/projects/my-claims` 和 `handle /api/projects/*`。
2. 重建并重启 `gateway`。
3. 复验对应路径回落到 Next。
4. 保留 PostgreSQL `projects` 表、`point_ledger` 和 `exchange_logs`，按测试用户抽样核对是否有重复发放。
5. 复跑 `node scripts/audit-projects-cutover.mjs`，确认 Gateway 项目列表规则状态符合预期。
