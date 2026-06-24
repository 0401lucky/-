# D1 导入 Scope 一致性审计

本文记录 `migrate-d1 -apply -scope` 支持范围的一致性门禁。
它用于防止新增导入器后，CLI、校验列表和 README 说明出现漂移。

## 运行方式

```bash
node scripts/audit-migrate-d1-scopes.mjs
```

## 检查范围

脚本以 `backend/cmd/migrate-d1/main.go` 为权威来源，检查：

- `-scope` 帮助文案里的支持范围。
- `-apply` 前的 scope 白名单校验。
- `switch *scope` 的实际导入分支。
- `backend/README.md` 中的本地命令示例。
- `backend/README.md` 中的 Docker 命令示例。
- `backend/README.md` 中的每个 scope 说明条目。

当前必须一致覆盖 15 个 scope：

- `public-lists`
- `users-points`
- `points-history`
- `store-data`
- `user-assets`
- `user-profiles`
- `user-achievements`
- `notifications`
- `reward-claims`
- `raffle-entries`
- `eco-state`
- `eco-global`
- `farm-v2`
- `cards`
- `feedback`

## 与总预检的关系

`scripts/preflight-zeabur-go-api.mjs` 已经把该审计作为部署前步骤。
如果后续新增 scope 但没有同步 CLI 校验或 README，总预检会失败。

## 不做的事

该脚本只做静态一致性检查：

- 不读取真实 D1 导出。
- 不连接 PostgreSQL。
- 不执行 `migrate-d1 -apply`。
- 不修改 Gateway。

真实生产导入仍必须按 `docs/production-cutover-readiness.md` 执行真实导出、导入、Cookie 冒烟和页面级 review。

## Review 命令

```bash
node --check scripts/audit-migrate-d1-scopes.mjs
node scripts/audit-migrate-d1-scopes.mjs
node scripts/preflight-zeabur-go-api.mjs
```
