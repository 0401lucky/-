# Dockerfile 构建产物审计

本文记录 Web、Go 后端和 Gateway 镜像构建文件的静态审计。
它用于防止 Dockerfile 后续改动破坏 Zeabur / Docker 部署入口。

## 运行方式

```bash
node scripts/audit-dockerfiles.mjs
```

## 检查范围

脚本会检查：

- Web `Dockerfile` 使用 Node 22 Alpine 多阶段构建。
- Web 镜像执行 `npm ci` 和 `npm run build`。
- Web 运行层使用 Next standalone 输出、非 root 用户、`EXPOSE 3000` 和 `CMD ["node", "server.js"]`。
- Go `backend/Dockerfile` 使用 Go 1.23 Alpine 构建。
- Go 镜像构建 `/app/api`、`/app/worker`、`/app/migrate`、`/app/migrate-d1`。
- Go 运行层复制 `migrations`、使用非 root 用户、`EXPOSE 8080` 和默认 `CMD ["/app/api"]`。
- Gateway `gateway/Dockerfile` 使用 Caddy 2 Alpine 并复制 `Caddyfile`。
- `.dockerignore` 排除依赖、构建缓存、环境变量、`backend`、`gateway` 和 `backups`，避免 Web 构建上下文过大或误带敏感文件。

## 不做的事

该脚本只做静态检查：

- 不构建镜像。
- 不启动容器。
- 不访问 Gateway。

镜像和运行时验证仍由：

```bash
docker compose config --quiet
node scripts/smoke-zeabur-runtime.mjs
node scripts/preflight-zeabur-go-api.mjs
```

负责。

## Review 命令

```bash
node --check scripts/audit-dockerfiles.mjs
node scripts/audit-dockerfiles.mjs
node scripts/preflight-zeabur-go-api.mjs
```
