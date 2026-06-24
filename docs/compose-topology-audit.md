# Docker Compose 拓扑审计

本文记录本地 Docker / Zeabur 多服务拓扑的静态审计。
它用于确认 `compose.yml` 仍符合迁移目标中的服务结构。

## 运行方式

```bash
node scripts/audit-compose-topology.mjs
```

## 检查范围

脚本会检查：

- `gateway`、`web`、`api`、`worker`、`postgres`、`redis` 六个服务存在。
- `gateway` 构建自 `gateway/Dockerfile`。
- `web` 构建自主 `Dockerfile`。
- `api` 和 `worker` 构建自 `backend/Dockerfile`。
- `gateway` 暴露 `8080:8080`。
- `web` 暴露内部 `3000`。
- `api` 暴露内部 `8080`。
- `postgres` 和 `redis` 有本地端口、volume 和 healthcheck。
- `api` / `worker` 依赖健康的 PostgreSQL 和 Redis。
- `gateway` 依赖 `web` 和 `api`。
- 本地开发环境变量仍使用明确的本地占位值，避免误以为 compose 就是生产 env。

## 不做的事

该脚本只做静态拓扑检查：

- 不启动容器。
- 不构建镜像。
- 不连接 PostgreSQL 或 Redis。
- 不修改 Gateway。

运行时检查仍由：

```bash
docker compose config --quiet
node scripts/smoke-zeabur-runtime.mjs
node scripts/preflight-zeabur-go-api.mjs
```

负责。

## Review 命令

```bash
node --check scripts/audit-compose-topology.mjs
node scripts/audit-compose-topology.mjs
docker compose config --quiet
node scripts/preflight-zeabur-go-api.mjs
```
