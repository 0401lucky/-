# C1-C3 Physical Cleanup Runbook

本文只记录 Go/Zeabur 迁移后的物理清理执行步骤。执行前必须先确认：

- `npm run audit:c1-c3-cleanup-readiness` 输出 `dryRunsReady = true`。
- 已明确接受删除旧 Next API、Cloudflare/OpenNext 文件产物和 package 依赖。
- 已确认当前分支无需保留 Cloudflare Workers/OpenNext 生产部署链路。
- `migrate-d1` 仍作为可选归档迁移工具保留，不纳入本轮删除。

## 禁止事项

- 不使用 `git reset --hard`。
- 不用手工批量删除未知文件。
- 不一次性删除全部候选后再 review。
- 不删除 `.gocache/`、`backups/` 或临时备份文件。
- 不删除 `backend/cmd/migrate-d1` 与 `backend/internal/migration/d1`。

## 总入口

清理前先运行：

```bash
npm run audit:c1-c3-cleanup-readiness
```

只有当输出满足以下条件时才继续：

```text
ok = true
dryRunsReady = true
nextApiManualReviewRoutes = 0
physicalDeletionConfirmed = true 或已由人工明确确认继续
```

`physicalDeletionConfirmed` 对应总确认口令：

```bash
CONFIRM_C1_C3_PHYSICAL_CLEANUP=c1-c3-physical-cleanup
```

该总口令只用于人工流程确认；具体删除仍必须使用各执行器自己的精确口令。

## 批次 1：墓碑化旧工具 API

目标：

- 删除已由 Gateway 显式 410 的旧 Next route。
- 不影响线上正常用户路径。

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=01-tombstoned-legacy-tools
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=01-tombstoned-legacy-tools \
node scripts/remove-next-api-routes.mjs --batch=01-tombstoned-legacy-tools --execute
```

Review：

```bash
node scripts/audit-next-api-fallback-risk.mjs
node scripts/audit-legacy-cloudflare-residuals.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
npm run typecheck
```

完成标准：

- 执行器删除 10 个文件。
- Gateway 410 规则仍存在。
- `manualReviewRoutes = 0`。
- TypeScript 通过。

## 批次 2：认证 API

目标：

- 删除 `/api/auth/login`、`/api/auth/me`、`/api/auth/logout` 旧 Next route。
- 生产继续由 Go 精确路由处理。

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=03-auth-routes
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=03-auth-routes \
node scripts/remove-next-api-routes.mjs --batch=03-auth-routes --execute
```

Review：

```bash
node scripts/audit-next-api-fallback-risk.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/smoke-auth-login-go-api.mjs
node scripts/smoke-auth-me-go-api.mjs
node scripts/smoke-auth-logout-go-api.mjs
npm run typecheck
```

完成标准：

- 执行器删除 3 个文件。
- 登录、查询当前用户、退出登录 smoke 通过。
- 新用户仍会通过 Go `/api/auth/me` 同步到 PostgreSQL。

## 批次 3：后台 API

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=04-admin-routes
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=04-admin-routes \
node scripts/remove-next-api-routes.mjs --batch=04-admin-routes --execute
```

Review：

```bash
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
node scripts/smoke-admin-users-go-api.mjs
node scripts/smoke-admin-dashboard-go-api.mjs
node scripts/smoke-admin-projects-go-api.mjs
node scripts/smoke-admin-eco-go-api.mjs
node scripts/smoke-admin-points-go-api.mjs
node scripts/smoke-feedback-go-api.mjs
npm run typecheck
```

完成标准：

- 执行器删除 37 个文件。
- 后台用户、仪表盘、项目、环保、积分、反馈 smoke 通过。
- `/api/admin/*` 通配仍未打开。

## 批次 4：游戏 API

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=05-game-routes
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=05-game-routes \
node scripts/remove-next-api-routes.mjs --batch=05-game-routes --execute
```

Review：

```bash
node scripts/smoke-game-cutovers-go-api.mjs
node scripts/smoke-game-2048-go-api.mjs
node scripts/smoke-games-summary-go-api.mjs
node scripts/audit-gateway-cutover-guard.mjs
node scripts/audit-gateway-allowed-cutovers.mjs
npm run typecheck
```

完成标准：

- 执行器删除 38 个文件。
- 普通游戏、2048、游戏汇总 smoke 通过。
- 不恢复 `games/fallback`。

## 批次 5：用户功能 API

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=06-user-feature-routes
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=06-user-feature-routes \
node scripts/remove-next-api-routes.mjs --batch=06-user-feature-routes --execute
```

Review：

```bash
node scripts/smoke-store-go-api.mjs
node scripts/smoke-wallet-go-api.mjs
node scripts/smoke-wallet-write-missing-newapi-go-api.mjs
node scripts/smoke-profile-write-go-api.mjs
node scripts/smoke-notifications-write-go-api.mjs
node scripts/smoke-farm-write-go-api.mjs
node scripts/smoke-cards-write-go-api.mjs
node scripts/smoke-admin-cards-write-go-api.mjs
npm run typecheck
```

完成标准：

- 执行器删除 38 个文件。
- 商城、钱包、个人主页、通知、农场、卡牌 smoke 通过。
- 钱包在缺 new-api 配置时仍不写账。

## 批次 6：公开与杂项 API

Dry-run：

```bash
npm run cleanup:next-api-routes:dry-run -- --batch=07-public-and-misc-routes
```

执行：

```bash
CONFIRM_DELETE_NEXT_API_ROUTES=07-public-and-misc-routes \
node scripts/remove-next-api-routes.mjs --batch=07-public-and-misc-routes --execute
```

Review：

```bash
node scripts/smoke-projects-go-api.mjs
node scripts/smoke-raffle-go-api.mjs
node scripts/smoke-points-rankings-go-api.mjs
node scripts/smoke-feedback-go-api.mjs
node scripts/audit-lottery-cutover.mjs
node scripts/audit-rankings-cutover.mjs
npm run typecheck
```

完成标准：

- 执行器删除 28 个文件。
- 项目、抽奖、排行榜、反馈、彩票相关 smoke/audit 通过。

## 批次 7：Cloudflare/OpenNext 文件产物

Dry-run：

```bash
npm run cleanup:cloudflare-deploy-artifacts:dry-run
```

执行：

```bash
CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts \
node scripts/remove-cloudflare-deploy-artifacts.mjs --execute
```

Review：

```bash
node scripts/audit-legacy-cloudflare-residuals.mjs
node scripts/audit-migration-artifacts.mjs
npm run typecheck
```

完成标准：

- 删除 5 个文件型部署产物。
- `cloudflareDeployArtifacts.count = 0`。
- Zeabur/GHCR 文档仍完整。

## 批次 8：package Cloudflare 信号

Dry-run：

```bash
npm run cleanup:package-cloudflare:dry-run
```

执行：

```bash
CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals \
node scripts/plan-package-cloudflare-cleanup.mjs --apply
npm install
```

Review：

```bash
npm run typecheck
node scripts/audit-legacy-cloudflare-residuals.mjs
node scripts/audit-migration-artifacts.mjs
```

完成标准：

- `packageCloudflareSignals.count = 0`。
- `package-lock.json` 与 `package.json` 一致。
- `npm run typecheck` 通过。

## 最终收口

全部批次完成后运行：

```bash
node scripts/audit-legacy-cloudflare-residuals.mjs
LEGACY_CLOUDFLARE_RESIDUALS_STRICT=1 node scripts/audit-legacy-cloudflare-residuals.mjs
node scripts/audit-migration-artifacts.mjs
npm run typecheck
```

最终完成标准：

- `productionFallbackClean = true`
- `mustMigrateOrTombstone = 0`
- `manualReviewRoutes = 0`
- `productionSourceLegacyReferences.count = 0`
- `cloudflareDeployArtifacts.count = 0`
- `packageCloudflareSignals.count = 0`
- TypeScript 通过

## 回滚方式

如果某批删除后发现问题：

1. 停止继续执行后续批次。
2. 用 `git status --short` 确认本批改动范围。
3. 只恢复本批删除文件，避免影响其它已完成改动。
4. 回滚到上一 GHCR 镜像，或暂时移除对应 Gateway 精确规则。
5. 复跑该批 review 命令后再继续。
