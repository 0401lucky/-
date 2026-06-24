# PostgreSQL Migration Audit

本文记录 PostgreSQL schema migration 的部署前审计。
目标是避免 Zeabur 上线时漏打包 `/app/migrate`、漏复制 `migrations` 目录、migration 编号断档，或运行手册缺少 schema 升级入口。

## 运行方式

```bash
node scripts/audit-postgres-migrations.mjs
```

脚本只做静态审计，不连接数据库，也不会执行 schema 变更。

## 审计范围

- `backend/migrations/*.sql` 文件必须按 `0001_name.sql` 连续编号。
- 每个 migration 文件必须包含 `-- +goose Up`。
- 每个 migration 的 Up 段必须包含非空 SQL。
- `backend/Dockerfile` 必须构建 `/app/migrate` 并复制 `/app/migrations`。
- `cmd/migrate` 必须支持 `-dry-run`、读取 `DATABASE_URL`，并在容器内默认使用 `/app/migrations`。
- `docs/zeabur-deployment-runbook.md` 必须包含 `/app/migrate` 和本审计脚本入口。

## Zeabur 执行顺序

Zeabur 上创建 PostgreSQL 并配置 `DATABASE_URL` 后，先执行 schema migration：

```bash
/app/migrate
```

确认 schema migration 完成后，再按 `migrate-d1` scope 导入真实 D1 数据。
本地或 Zeabur 等价环境还需要运行 `node scripts/audit-postgres-live-schema.mjs`，确认运行库 `schema_migrations` 已经追到最新。
不要在 schema 未完成时打开 Gateway 新路径。

## Review 命令

```bash
node --check scripts/audit-postgres-migrations.mjs
node scripts/audit-postgres-migrations.mjs
node scripts/audit-postgres-live-schema.mjs
go run ./cmd/migrate -dry-run
docker compose exec -T api /app/migrate -dry-run
docker compose config --quiet
```
