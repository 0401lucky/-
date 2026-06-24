# Zeabur Service Plan

本文记录 Zeabur 多服务部署计划。
它不替代 `compose.yml`，而是把 Zeabur 上需要创建的服务、构建入口、端口、依赖和环境变量来源固化为可审计模板。

## 运行方式

默认审计模板：

```bash
node scripts/audit-zeabur-service-plan.mjs
```

如果维护了实际服务计划文件：

```bash
ZEABUR_SERVICE_PLAN=./deploy/zeabur-services.json node scripts/audit-zeabur-service-plan.mjs
```

## 模板文件

模板位于：

```text
deploy/zeabur-services.example.json
```

真实服务计划只允许记录服务名、Docker 构建入口、端口、依赖和环境变量名。
不要写入真实 Cookie、Token、Secret、Password、Authorization 或访问密钥。

## 服务拓扑

Zeabur 上建议保持 6 个服务：

- `gateway`：唯一公网入口，使用 `gateway/Dockerfile`，公开 8080。
- `web`：Next.js standalone 服务，使用根目录 `Dockerfile`，仅内网访问 3000。
- `api`：Go API 服务，使用 `backend/Dockerfile`，仅内网访问 8080。
- `worker`：Go Worker 服务，使用 `backend/Dockerfile` 并覆盖 entrypoint 为 `/app/worker`。
- `postgres`：Zeabur 托管 PostgreSQL，提供 `DATABASE_URL`。
- `redis`：Zeabur 托管 Redis，提供 `REDIS_URL`。

Gateway 依赖 `web` 和 `api`。
Web 依赖 `api`。
API 和 Worker 都依赖 `postgres` 与 `redis`。

Gateway 的上游地址通过环境变量配置：

- `API_UPSTREAM`：默认 `api:8080`，指向 Go API 服务。
- `WEB_UPSTREAM`：默认 `web:3000`，指向 Next.js Web 服务。

Zeabur 服务名或内网端口和本地 Compose 不一致时，只覆盖这两个变量。
不要为了适配 Zeabur 服务名去改 `gateway/Caddyfile` 的路径切流清单。

## 环境变量来源

服务计划中的变量名必须能在 `deploy/zeabur.env.example` 中找到。
其中 `SESSION_SECRET`、`ADMIN_USERNAMES`、`INTERNAL_API_SECRET` 必须在 Web、API 和 Worker 中按职责保持一致。

## 发布后检查

服务计划必须包含以下发布后检查：

- `GET /healthz`
- `GET /readyz`
- `node scripts/smoke-zeabur-runtime.mjs`
- `node scripts/preflight-zeabur-go-api.mjs`

## Review 命令

```bash
node --check scripts/audit-zeabur-service-plan.mjs
node scripts/audit-zeabur-service-plan.mjs
node scripts/audit-compose-topology.mjs
node scripts/audit-zeabur-env-example.mjs
docker compose config --quiet
```
