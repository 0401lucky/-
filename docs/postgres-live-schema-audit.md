# PostgreSQL Live Schema Audit

本文记录本地 Docker PostgreSQL 实库 schema 状态审计。
它和静态 `PostgreSQL Migration Audit` 互补：静态审计确认 migration 文件和镜像入口存在，实库审计确认当前运行库已经应用到最新版本。

## 运行方式

```bash
node scripts/audit-postgres-live-schema.mjs
```

脚本只读取 Docker Compose 中的 `postgres` 服务，不执行 schema 变更，不写业务数据。

## 审计范围

- `schema_migrations` 表必须存在。
- `schema_migrations.version` 必须包含 `backend/migrations/*.sql` 中的全部 migration 文件。
- 数据库中不能存在本地 migration 目录之外的未知 migration 版本。

## 使用时机

本地或 Zeabur 等价环境中执行 `/app/migrate` 后运行：

```bash
docker compose exec -T api /app/migrate
node scripts/audit-postgres-live-schema.mjs
```

如果脚本失败，不要继续执行 D1 导入或 Gateway 切流。

## Review 命令

```bash
node --check scripts/audit-postgres-live-schema.mjs
node scripts/audit-postgres-live-schema.mjs
node scripts/audit-postgres-migrations.mjs
docker compose config --quiet
```
