# PostgreSQL Smoke Residue Audit

本文记录本地 Docker PostgreSQL 的冒烟测试用户残留审计。
它是只读检查，不会删除数据。

## 运行方式

```bash
node scripts/audit-postgres-smoke-residue.mjs
```

默认检查用户 ID 范围：

- `999900..999999`

该范围由本地 smoke 脚本使用。
如果这些用户残留在本地库里，后续 D1 导入复核、页面冒烟或生产切流判断可能被测试数据污染。

## 检查范围

脚本会动态扫描 `public` schema 中的用户关联字段：

- `users.id`
- `user_id`
- `owner_user_id`
- `thief_user_id`
- `original_user_id`

任一表在测试用户范围内存在行都会失败。

## 自定义范围

```bash
SMOKE_RESIDUE_MIN_USER_ID=999900 SMOKE_RESIDUE_MAX_USER_ID=999999 node scripts/audit-postgres-smoke-residue.mjs
```

## Review 命令

```bash
node --check scripts/audit-postgres-smoke-residue.mjs
node scripts/audit-postgres-smoke-residue.mjs
node scripts/preflight-zeabur-go-api.mjs
```
