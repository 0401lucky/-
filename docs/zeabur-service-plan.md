# Zeabur Service Plan

本文记录 Zeabur 单容器部署计划。
它不替代 `compose.yml`，而是把 Zeabur 上需要创建的服务、构建入口、端口、依赖和环境变量来源固化为可审计模板。

## 运行方式

默认审计模板：

```bash
node scripts/audit-zeabur-single-plan.mjs
```

如果维护了实际服务计划文件：

```bash
ZEABUR_SINGLE_PLAN=./deploy/zeabur-single-service.json node scripts/audit-zeabur-single-plan.mjs
```

## 模板文件

模板位于：

```text
deploy/zeabur-single-service.example.json
```

真实服务计划只允许记录服务名、Docker 构建入口、端口、依赖和环境变量名。
不要写入真实 Cookie、Token、Secret、Password、Authorization 或访问密钥。

## 服务拓扑

Zeabur 上现在只保留 3 个服务：

- `app`：唯一公网入口，使用根目录 `Dockerfile`，公开 8080。
- `postgres`：Zeabur 托管 PostgreSQL，提供 `DATABASE_URL`。
- `redis`：Zeabur 托管 Redis，提供 `REDIS_URL`。

`app` 容器内部同时启动：

- `gateway`：8080
- `web`：3000
- `api`：8081
- `worker`：后台进程，不公开端口

如果暂不接 S3/R2，`app` 需要挂载持久卷到 `/data/feedback-media`。

## 环境变量来源

服务计划中的变量名必须能在 `deploy/zeabur.env.example` 中找到。
其中 `SESSION_SECRET`、`ADMIN_USERNAMES`、`INTERNAL_API_SECRET` 必须在单容器内保持一致。

## 发布后检查

服务计划必须包含以下发布后检查：

- `GET /healthz`
- `GET /readyz`
- `node scripts/smoke-zeabur-runtime.mjs`
- `node scripts/preflight-zeabur-go-api.mjs`

## Review 命令

```bash
node --check scripts/audit-zeabur-single-plan.mjs
node scripts/audit-zeabur-single-plan.mjs
node scripts/audit-compose-topology.mjs
node scripts/audit-zeabur-env-example.mjs
docker compose config --quiet
```
