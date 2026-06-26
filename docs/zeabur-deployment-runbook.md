# Zeabur 部署运行手册

本文记录 Go + PostgreSQL + Redis 迁移到 Zeabur 前后的执行顺序。
它是部署操作入口，不替代各业务模块的独立预检文档。

## 1. 本地部署前检查

先确认 Docker 服务可用：

```bash
docker compose up --build -d
docker compose config --quiet
docker compose exec -T api /app/migrate
```

然后运行默认部署前总预检：

```bash
node scripts/audit-migration-artifacts.mjs
node scripts/audit-compose-topology.mjs
node scripts/audit-dockerfiles.mjs
node scripts/audit-postgres-migrations.mjs
node scripts/audit-postgres-live-schema.mjs
node scripts/audit-postgres-smoke-residue.mjs
node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-preflight.mjs
node scripts/audit-deploy-secret-hygiene.mjs
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/preflight-zeabur-go-api.mjs
```

Zeabur 当前只走单容器部署，生产入口是 `app 服务`。

1. 创建托管 PostgreSQL，并记录 `DATABASE_URL`。
2. 创建托管 Redis，并记录 `REDIS_URL`。
3. 创建 `app` 服务，根目录 `/`，使用根目录 `Dockerfile.dachely`。
4. 把 `app` 设为唯一公网入口，绑定域名。
5. 在 `app` 服务里先执行 `/app/migrate` 初始化数据库。

如果 Zeabur 没有命中根目录 `Dockerfile`，就在 `app` 服务里显式设置：

```bash
ZBPACK_DOCKERFILE_PATH=Dockerfile.dachely
```

`app` 容器内部同时启动：

- `gateway`：8080
- `web`：3000
- `api`：8081
- `worker`：后台进程，不对外暴露

如果暂不接 S3/R2，请给 `app` 挂载一个持久卷到：

```text
/data/feedback-media
```

`postgres` 和 `redis` 仍然保持为独立托管服务。

需要复跑未切流模块的本地写路径门禁时：

```bash
ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1 node scripts/preflight-zeabur-go-api.mjs
```

## 2. Zeabur 环境变量准备

以 `deploy/zeabur.env.example` 为模板配置 Zeabur 环境变量。
以 `deploy/zeabur-single-service.example.json` 为模板核对服务、端口、依赖和环境变量名。

必须先通过样例审计：

```bash
node scripts/audit-zeabur-env-example.mjs
node scripts/audit-zeabur-single-plan.mjs
```

真实环境变量填好后，再通过运行时审计：

```bash
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-zeabur-runtime-env.mjs
```

生产环境必须单独配置真实值：

- `GATEWAY_PORT`
- `WEB_PORT`
- `API_PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `ADMIN_USERNAMES`
- `INTERNAL_API_SECRET`
- `NEW_API_URL`
- `NEW_API_ADMIN_ACCESS_TOKEN`
- `NEW_API_ADMIN_USER_ID`
- `NEW_API_ADMIN_USERNAME`
- `NEW_API_ADMIN_PASSWORD`
- `RAFFLE_DELIVERY_CRON_SECRET`
- `CRON_SECRET`
- R2 / S3 相关变量
- `FEEDBACK_MEDIA_DIR`
- `FEEDBACK_MEDIA_PUBLIC_URL`

`SESSION_SECRET` 必须在单容器内保持一致。

反馈墙附件当前支持本地挂载卷存储：

- 若暂不启用 S3/R2，请在 `app` 服务挂载持久卷到 `FEEDBACK_MEDIA_DIR`，推荐 `/data/feedback-media`。
- `FEEDBACK_MEDIA_PUBLIC_URL` 可留空，附件会通过 `/api/feedback/images/*` 读取。
- 如果后续接入 S3/R2，需在真实切流证据中记录最终采用的对象存储方案。

## 3. PostgreSQL 初始化与可选 D1 归档导入

当前生产策略是 fresh Zeabur 新部署，不从 Cloudflare D1 迁移历史数据。
生产主线只需要创建空 PostgreSQL、执行 `/app/migrate`、复核 schema，并检查必要的默认配置或种子数据。

```bash
docker compose exec -T api /app/migrate
node scripts/audit-postgres-live-schema.mjs
```

D1 导出与 `migrate-d1` 仍保留为可选归档迁移工具。
只有后续决定补导旧 Cloudflare 数据时，才需要执行本节后半部分。

拿到真实 D1 导出文件后，先做 dry-run：

```bash
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL"
```

导入前先确认 scope 文档和 CLI 一致：

```bash
node scripts/audit-migrate-d1-scopes.mjs
```

按业务顺序执行导入：

```bash
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope public-lists
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope users-points
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope points-history
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope store-data
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope user-assets
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope user-profiles
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope user-achievements
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope notifications
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope reward-claims
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope raffle-entries
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope eco-state
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope eco-global
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope farm-v2
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope cards
go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL" -apply -scope feedback
```

如果选择 d1-import 归档迁移，生产导入必须在维护窗口内执行，避免 Next 旧 API 和 Go API 分叉写入。

## 4. 生产切流准备审计

导入和环境变量准备后运行：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-readiness.mjs
```

最终切流前运行 strict 总门禁：

```bash
CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json ZEABUR_ENV_FILE=./deploy/zeabur.env ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/preflight-production-cutover.mjs
```

`node scripts/test-production-cutover-guards.mjs` 必须覆盖 8 类失败路径：缺少生产输入、example 输入、可选 D1 example 输入、本地/非 HTTPS URL、证据未齐提前审批、Zeabur env 路径不一致、D1 导出路径不一致和 d1-import 证据包路径不一致。

如果使用本地 env 文件：

```bash
ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-production-cutover-readiness.mjs
```

只有目标模块显示 `ready: true`，且对应页面级冒烟完成后，才允许进入精确 Gateway 切流评估。

## 5. 仍禁止直接打开的路径

继续禁止以下路径通配或未复核精确切流：

- `/api/farm*`
- `/api/profile*`
- `/api/notifications*`
- `/api/store/topup`
- `/api/store/withdraw`
- `/api/cards*`
- `/api/admin/cards*`
- `/api/games/*`
- `/api/projects/*`
- `/api/admin/*`

每次修改 Gateway 后必须运行：

```bash
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
```

## 6. Zeabur 发布后冒烟

发布后至少复核：

- `GET /healthz`
- `GET /readyz`
- 首页加载
- `/api/points`
- `/api/store`
- `/api/store/exchange`
- `/api/games/eco/status`
- 6 个普通游戏的 start/status/submit/cancel 链路
- `/api/projects`
- `/api/raffle`
- `/api/games/profile`

本地等价复核入口：

```bash
node scripts/smoke-zeabur-runtime.mjs
node scripts/preflight-zeabur-go-api.mjs
```

Zeabur 发布后复核必须显式指向远端 HTTPS 域名：

```bash
ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs
```

## 7. 回滚原则

只按精确路径回滚，不做数据库硬回滚。

若某个路径异常：

1. 从 `gateway/Caddyfile` 移除对应精确 `handle`。
2. 重建并重启 Gateway。
3. 运行 `node scripts/audit-gateway-cutover-guard.mjs`。
4. 运行 `node scripts/audit-gateway-allowed-cutovers.mjs`。
5. 用对应页面和直连 Go API 对账 PostgreSQL 写入。
6. 保留 PostgreSQL 审计记录，用业务补偿脚本或人工对账修复。

禁止使用 `git reset --hard` 或删除生产数据作为回滚手段。

## 8. Review 命令

```bash
node --check scripts/audit-zeabur-runbook.mjs
node scripts/audit-zeabur-runbook.mjs
node scripts/audit-production-cutover-evidence.mjs
node scripts/audit-production-cutover-preflight.mjs
node scripts/test-production-cutover-guards.mjs
node scripts/preflight-zeabur-go-api.mjs
node scripts/audit-production-cutover-readiness.mjs
node scripts/audit-gateway-upstreams.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/audit-postgres-smoke-residue.mjs
docker compose config --quiet
```
