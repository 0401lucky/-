# Admin Projects 内部迁移前置审计

本文记录 PR #9 后台福利项目管理 `/api/admin/projects*` 的 Go 迁移证据。

当前结论：Go 内部 API 已覆盖后台项目列表、直充积分项目创建、详情、修改、删除和追加名额；Gateway 已精确切流 `/api/admin/projects` 与 `/api/admin/projects/*`，仍禁止 `/api/admin/*` 通配。

## Go 覆盖范围

- `GET /api/admin/projects`
  - 返回全部项目。
  - 排序规则：置顶优先、`pinnedAt` 倒序、`createdAt` 倒序。
- `POST /api/admin/projects`
  - 只创建 `rewardType=direct` 的直充积分项目。
  - 校验项目名称、限领人数和直充积分。
  - `codesCount` 与 `maxClaims` 保持一致。
  - 支持 `autoPauseAt`，按中国时间解析后台 `datetime-local` 输入并保存 UTC 毫秒时间戳。
- `GET /api/admin/projects/{id}`
  - 返回项目详情和最近领取记录。
  - fresh Zeabur 新部署下，领取记录来自 Go 侧 `exchange_logs`。
  - 旧 Cloudflare KV `records:*` 不再作为生产迁移前置条件。
- `PATCH /api/admin/projects/{id}`
  - 支持更新状态、置顶、名称、描述和限领人数。
  - direct 项目更新限领人数时同步 `codesCount`。
  - exhausted direct 项目增加可用名额后可恢复 active。
- `POST /api/admin/projects/{id}`
  - 仅允许 direct 项目追加名额。
  - 历史兑换码项目返回只读错误。
- `DELETE /api/admin/projects/{id}`
  - 与旧接口一致，执行删除并返回成功。
- Go Worker
  - 每分钟扫描 `auto_pause_at_ms <= now` 且仍为 `active` 的项目。
  - 自动改为 `paused` 并写入 `auto_paused_at_ms`，避免后台页面必须常驻。

## Review 命令

```bash
node --check scripts/audit-admin-projects-cutover.mjs
node --check scripts/smoke-admin-projects-go-api.mjs
node scripts/audit-admin-projects-cutover.mjs
go test ./internal/welfare ./internal/httpserver -run AdminProject -count=1
TEST_DATABASE_URL=postgres://app:app@localhost:5432/app?sslmode=disable go test -tags integration ./internal/welfare ./internal/httpserver -run 'ProcessAutoPauseProjects|AdminProject' -count=1
node scripts/smoke-admin-projects-go-api.mjs
```

## Gateway 状态

允许保留：

```caddyfile
handle /api/admin/projects {
	reverse_proxy api:8080
}
handle /api/admin/projects/* {
	reverse_proxy api:8080
}
```

禁止添加：

```caddyfile
handle /api/admin/* {
	reverse_proxy api:8080
}
```

部署测试阶段只允许保留精确切流 `/api/admin/projects` 与 `/api/admin/projects/*`，禁止新增 `/api/admin/*`。

## 回滚步骤

如后台项目管理异常：

1. 临时移除 Gateway 中 `/api/admin/projects` 与 `/api/admin/projects/*` 精确规则，让这些路径回到 Web/Next。
2. 回退 Go `server.go` 中 `/api/admin/projects` 内部路由。
3. 人工核对 `projects` 和 `exchange_logs` 中 smoke 项目残留。
4. 复跑 `node scripts/audit-admin-projects-cutover.mjs`，确认 Gateway 仍未打开该路径。
