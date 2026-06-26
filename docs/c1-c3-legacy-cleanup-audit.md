# C1-C3 Legacy Cleanup Audit

本文记录 Go/Zeabur 迁移后，清理旧 Next API、Cloudflare KV/D1 和
OpenNext/Wrangler 部署链路前的非破坏性审计。

当前策略：

- Fresh Zeabur 新部署不从 Cloudflare D1 迁移历史数据。
- `migrate-d1` 仍保留为可选归档迁移工具。
- Gateway 已避免生产请求继续落回旧 Next/KV 路径。
- 物理删除旧源码、OpenNext/Wrangler 配置和 package 脚本前需要单独确认。

## 审计入口

```bash
node scripts/audit-legacy-cloudflare-residuals.mjs
```

严格模式：

```bash
LEGACY_CLOUDFLARE_RESIDUALS_STRICT=1 node scripts/audit-legacy-cloudflare-residuals.mjs
```

物理清理前统一 readiness 审计：

```bash
npm run audit:c1-c3-cleanup-readiness
```

该审计会复用旧 Next API、Cloudflare 文件产物和 package 清理的 dry-run/guard，
确认 `manualReviewRoutes = 0`、所有 dry-run 不会实际删除、package 清理不会改
`package.json`。它不会执行任何真实删除。

真实清理执行顺序见：

```text
docs/c1-c3-physical-cleanup-runbook.md
```

runbook 一致性审计：

```bash
npm run audit:c1-c3-cleanup-runbook
```

删除执行器默认只 dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=01-tombstoned-legacy-tools
```

真正执行删除时必须显式传入 `--execute`，并设置确认口令：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=01-tombstoned-legacy-tools \
node scripts/remove-next-api-routes.mjs --batch=01-tombstoned-legacy-tools --execute
```

Windows PowerShell：

```powershell
$env:CONFIRM_DELETE_NEXT_API_ROUTES='01-tombstoned-legacy-tools'
node scripts/remove-next-api-routes.mjs --batch=01-tombstoned-legacy-tools --execute
Remove-Item Env:\CONFIRM_DELETE_NEXT_API_ROUTES
```

本阶段未执行上述 `--execute` 命令。

防误删 guard：

```bash
npm run test:next-api-route-cleanup-guards
```

该 guard 覆盖：

1. 非法批次必须失败。
2. `--execute` 但未设置 `CONFIRM_DELETE_NEXT_API_ROUTES=<batch>` 必须失败。
3. dry-run 必须报告 `deleted = 0`，且候选文件仍存在。

Cloudflare/OpenNext 文件型部署产物 dry-run：

```bash
npm run cleanup:cloudflare-deploy-artifacts:dry-run
```

真正执行文件删除时必须显式传入 `--execute`，并设置确认口令：

```bash
CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts \
node scripts/remove-cloudflare-deploy-artifacts.mjs --execute
```

Windows PowerShell：

```powershell
$env:CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS='cloudflare-deploy-artifacts'
node scripts/remove-cloudflare-deploy-artifacts.mjs --execute
Remove-Item Env:\CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS
```

Cloudflare 部署产物 guard：

```bash
npm run test:cloudflare-deploy-cleanup-guards
```

该 guard 覆盖：

1. `--execute` 但未设置 `CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts` 必须失败。
2. dry-run 必须报告 `deleted = 0`，且候选文件仍存在。

本阶段未执行上述 `--execute` 命令。

package 级 Cloudflare/OpenNext 信号 dry-run：

```bash
npm run cleanup:package-cloudflare:dry-run
```

真正清理 `package.json` 中的 Cloudflare 部署脚本和依赖时，必须显式传入
`--apply`，并设置确认口令：

```bash
CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals \
node scripts/plan-package-cloudflare-cleanup.mjs --apply
```

Windows PowerShell：

```powershell
$env:CONFIRM_CLEAN_PACKAGE_CLOUDFLARE='package-cloudflare-signals'
node scripts/plan-package-cloudflare-cleanup.mjs --apply
Remove-Item Env:\CONFIRM_CLEAN_PACKAGE_CLOUDFLARE
```

package 级清理 guard：

```bash
npm run test:package-cloudflare-cleanup-guards
```

该 guard 覆盖：

1. `--apply` 但未设置 `CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals` 必须失败。
2. dry-run 不修改 `package.json`。
3. dry-run 必须报告计划移除 5 个 script、1 个 dependency、2 个 devDependency。

本阶段未执行上述 `--apply` 命令，也未运行 `npm install` 更新 lockfile。

严格模式只有在以下条件全部满足时才通过：

1. `scripts/audit-next-api-fallback-risk.mjs` 确认：
   - `mustMigrateOrTombstone = 0`
   - `blockedByExternalConfig = 0`
   - `internalOnly = 0`
2. `src/app`、`src/components`、`src/lib` 等生产源码不再引用旧 KV/D1 或 Cloudflare runtime。
3. Cloudflare/OpenNext/Wrangler 部署产物已移除。
4. `package.json` 不再暴露 Cloudflare 部署脚本或依赖。

## 输出分类

- `productionSourceLegacyReferences`
  - 生产源码中的旧 KV/D1、OpenNext、Cloudflare Workers 引用。
  - 这是 C1 的主要清理对象。

- `cloudflareDeployArtifacts`
  - `wrangler.jsonc`、`open-next.config.ts`、`cloudflare-env.d.ts`、
    `worker-wrapper.mjs`、Durable Object 类型/源码等。
  - 这是 C3 的主要清理对象。

- `optionalD1ArchiveTools`
  - `backend/cmd/migrate-d1`、`backend/internal/migration/d1` 和 D1 scope 审计。
  - 当前保留，除非明确决定不再提供历史数据归档迁移。

- `migrationAuditDocsAndScripts`
  - 文档和审计脚本中用于说明历史迁移、禁切门禁和部署策略的引用。
  - 不能简单按关键词删除，需要随 C1-C3 进度更新。

- `testLegacyReferences`
  - 旧 TypeScript 单测中的 KV/D1 mock。
  - 等生产源码清理后再统一删除或改写，避免把旧测试误当生产依据。

- `nextApiRouteDeletionPlan`
  - 基于 `scripts/audit-next-api-fallback-risk.mjs` 的 Gateway 覆盖结果生成。
  - 只把已经由 Gateway 转到 Go 或显式 410 的 `src/app/api/**/route.ts`
    归为删除候选。
  - `manualReviewRoutes` 必须为 0，才说明没有仍需迁移、外部阻塞或内部定时待处理的 route。

## 当前完成标准

C1 生产源码清理：

```text
productionSourceLegacyReferences.count = 0
npm run typecheck 通过
node scripts/audit-next-api-fallback-risk.mjs 通过且 mustMigrateOrTombstone = 0
```

C2 旧 Next API 清理：

```text
旧 src/app/api/**/route.ts 已删除或只保留必要的 Next 页面辅助 API
Gateway 精确 Go/Gone 规则仍通过双门禁
前端 fetch 调用全部能落到 Go/Gateway 允许路径
```

C3 Cloudflare 部署链路清理：

```text
cloudflareDeployArtifacts.count = 0
packageCloudflareSignals.count = 0
新人只看 Zeabur GHCR 文档即可部署
```

## 本轮结论

本轮只新增审计、dry-run 执行器、guard 和文档，不执行删除。

当前基线：

- `productionFallbackClean = true`
- `mustMigrateOrTombstone = 0`
- `blockedByExternalConfig = 0`
- `internalOnly = 0`
- `packageCloudflareSignals.count = 8`
- `productionSourceLegacyReferences.count = 83`
- `cloudflareDeployArtifacts.count = 5`
- `optionalD1ArchiveTools.count = 50`
- `migrationAuditDocsAndScripts.count = 12`
- `testLegacyReferences.count = 31`
- `nextApiRouteDeletionPlan.totalNextApiRoutes = 154`
- `nextApiRouteDeletionPlan.deleteCandidateRoutes = 154`
- `nextApiRouteDeletionPlan.goCutoverCandidates = 144`
- `nextApiRouteDeletionPlan.tombstoneCandidates = 10`
- `nextApiRouteDeletionPlan.manualReviewRoutes = 0`
- `nextApiRouteDeletionPlan.readyForRouteDeletion = true`

当前建议删除批次：

1. `01-tombstoned-legacy-tools`
   - 10 个 route，全部已由 Gateway 显式 410。
   - 优先删除，风险最低。
2. `03-auth-routes`
   - 3 个 route，已由 Gateway 精确转 Go。
   - 删除后重点复跑 login/me/logout smoke。
3. `04-admin-routes`
   - 37 个 route，已由 Gateway 精确转 Go。
   - 删除后重点复跑后台页面和 admin smoke。
4. `05-game-routes`
   - 38 个 route，已由 Gateway 精确转 Go。
   - 删除后重点复跑普通游戏、2048 和游戏汇总 smoke。
5. `06-user-feature-routes`
   - 38 个 route，已由 Gateway 精确转 Go。
   - 删除后重点复跑 store、wallet、profile、notifications、farm、cards smoke。
6. `07-public-and-misc-routes`
   - 28 个 route，已由 Gateway 精确转 Go。
   - 删除后重点复跑 projects、raffle、lottery、rankings、feedback smoke。

这些数字说明：生产 Gateway 回落风险已经收口，但源码和部署产物层面的
Cloudflare/KV 残留还没有物理清理完成。

## 本轮 package 清理 review

改动范围：

- `package.json`
- `scripts/plan-package-cloudflare-cleanup.mjs`
- `scripts/test-package-cloudflare-cleanup-guards.mjs`
- `scripts/audit-migration-artifacts.mjs`
- `scripts/preflight-zeabur-go-api.mjs`
- `scripts/audit-legacy-cloudflare-residuals.mjs`
- `scripts/audit-c1-c3-cleanup-readiness.mjs`
- `scripts/audit-c1-c3-cleanup-runbook.mjs`
- `docs/c1-c3-legacy-cleanup-audit.md`
- `docs/go-zeabur-refactor-plan.md`

执行结果：

- package 清理默认只 dry-run。
- 真正应用必须同时传 `--apply` 和
  `CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals`。
- 本轮没有修改 `package-lock.json`，也没有移除任何依赖。
- 残留审计不会把 package 清理工具自身误算为待删除的
  `packageCloudflareSignals`。

验证命令：

```bash
npm run cleanup:package-cloudflare:dry-run
npm run test:package-cloudflare-cleanup-guards
node --check scripts/plan-package-cloudflare-cleanup.mjs
node --check scripts/test-package-cloudflare-cleanup-guards.mjs
node --check scripts/audit-legacy-cloudflare-residuals.mjs
node --check scripts/audit-c1-c3-cleanup-readiness.mjs
node --check scripts/audit-c1-c3-cleanup-runbook.mjs
node --check scripts/audit-migration-artifacts.mjs
node --check scripts/preflight-zeabur-go-api.mjs
node scripts/audit-migration-artifacts.mjs
node scripts/audit-legacy-cloudflare-residuals.mjs
npm run audit:c1-c3-cleanup-readiness
npm run audit:c1-c3-cleanup-runbook
npm run typecheck
```

下一步如果要进入物理清理，需要先确认要删除的范围：

1. 是否删除 OpenNext/Wrangler 部署脚本与配置。
2. 是否保留 `migrate-d1` 作为可选归档工具。
3. 是否批量删除已由 Gateway 接管或墓碑化的 `src/app/api/**/route.ts`。
