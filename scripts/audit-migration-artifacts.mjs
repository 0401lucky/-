import { existsSync, readFileSync } from 'node:fs';

const preflightPath = 'scripts/preflight-zeabur-go-api.mjs';
const planPath = 'docs/go-zeabur-refactor-plan.md';

const requiredFiles = [
  'backend/README.md',
  'compose.yml',
  'deploy/zeabur.env.example',
  'deploy/zeabur-services.example.json',
  'deploy/production-cutover-evidence.example.json',
  'gateway/Caddyfile',
  'docs/go-zeabur-refactor-plan.md',
  'docs/stage-1-4-review.md',
  'docs/zeabur-deployment-preflight.md',
  'docs/zeabur-deployment-runbook.md',
  'docs/zeabur-service-plan.md',
  'docs/zeabur-env-audit.md',
  'docs/zeabur-runtime-smoke.md',
  'docs/production-cutover-readiness.md',
  'docs/production-cutover-evidence.md',
  'docs/production-cutover-preflight.md',
  'docs/deploy-secret-hygiene-audit.md',
  'docs/migrate-d1-scope-audit.md',
  'docs/compose-topology-audit.md',
  'docs/dockerfile-audit.md',
  'docs/postgres-migration-audit.md',
  'docs/postgres-live-schema-audit.md',
  'docs/postgres-smoke-residue-audit.md',
  'docs/gateway-cutover-guard.md',
  'docs/gateway-allowed-cutovers.md',
  'docs/gateway-upstream-audit.md',
  'docs/game-cutover-suite.md',
  'scripts/preflight-zeabur-go-api.mjs',
  'scripts/audit-compose-topology.mjs',
  'scripts/audit-dockerfiles.mjs',
  'scripts/audit-postgres-migrations.mjs',
  'scripts/audit-postgres-live-schema.mjs',
  'scripts/audit-postgres-smoke-residue.mjs',
  'scripts/audit-zeabur-service-plan.mjs',
  'scripts/audit-zeabur-env-example.mjs',
  'scripts/audit-zeabur-runtime-env.mjs',
  'scripts/audit-migrate-d1-scopes.mjs',
  'scripts/audit-zeabur-runbook.mjs',
  'scripts/audit-gateway-cutover-guard.mjs',
  'scripts/audit-gateway-allowed-cutovers.mjs',
  'scripts/audit-gateway-upstreams.mjs',
  'scripts/audit-production-cutover-readiness.mjs',
  'scripts/audit-production-cutover-evidence.mjs',
  'scripts/audit-production-cutover-preflight.mjs',
  'scripts/test-production-cutover-guards.mjs',
  'scripts/preflight-production-cutover.mjs',
  'scripts/audit-deploy-secret-hygiene.mjs',
  'scripts/smoke-zeabur-runtime.mjs',
  'scripts/smoke-game-cutovers-go-api.mjs',
];

const moduleArtifacts = [
  ['points-rankings', 'docs/points-rankings-cutover-preflight.md', 'scripts/audit-points-rankings-cutover.mjs', 'scripts/smoke-points-rankings-go-api.mjs'],
  ['store', 'docs/store-cutover-preflight.md', 'scripts/audit-store-cutover.mjs', 'scripts/smoke-store-go-api.mjs'],
  ['eco', 'docs/eco-cutover-preflight.md', 'scripts/audit-eco-cutover.mjs', 'scripts/smoke-eco-go-api.mjs'],
  ['admin-eco', 'docs/admin-eco-cutover-preflight.md', 'scripts/audit-admin-eco-cutover.mjs', 'scripts/smoke-admin-eco-go-api.mjs'],
  ['admin-points', 'docs/admin-points-cutover-preflight.md', 'scripts/audit-admin-points-cutover.mjs', 'scripts/smoke-admin-points-go-api.mjs'],
  ['admin-users', 'docs/admin-users-cutover-preflight.md', 'scripts/audit-admin-users-cutover.mjs', 'scripts/smoke-admin-users-go-api.mjs'],
  ['admin-dashboard', 'docs/admin-dashboard-cutover-preflight.md', 'scripts/audit-admin-dashboard-cutover.mjs', 'scripts/smoke-admin-dashboard-go-api.mjs'],
  ['admin-projects', 'docs/admin-projects-cutover-preflight.md', 'scripts/audit-admin-projects-cutover.mjs', 'scripts/smoke-admin-projects-go-api.mjs'],
  ['projects', 'docs/projects-cutover-preflight.md', 'scripts/audit-projects-cutover.mjs', 'scripts/smoke-projects-go-api.mjs'],
  ['raffle', 'docs/raffle-cutover-preflight.md', 'scripts/audit-raffle-cutover.mjs', 'scripts/smoke-raffle-go-api.mjs'],
  ['games-summary', 'docs/games-summary-cutover-preflight.md', 'scripts/audit-games-summary-cutover.mjs', 'scripts/smoke-games-summary-go-api.mjs'],
  ['memory', 'docs/memory-cutover-preflight.md', 'scripts/audit-memory-cutover.mjs', 'scripts/smoke-memory-go-api.mjs'],
  ['match3', 'docs/match3-cutover-preflight.md', 'scripts/audit-match3-cutover.mjs', 'scripts/smoke-match3-go-api.mjs'],
  ['whack-mole', 'docs/whack-mole-cutover-preflight.md', 'scripts/audit-whack-mole-cutover.mjs', 'scripts/smoke-whack-mole-go-api.mjs'],
  ['minesweeper', 'docs/minesweeper-cutover-preflight.md', 'scripts/audit-minesweeper-cutover.mjs', 'scripts/smoke-minesweeper-go-api.mjs'],
  ['linkgame', 'docs/linkgame-cutover-preflight.md', 'scripts/audit-linkgame-cutover.mjs', 'scripts/smoke-linkgame-go-api.mjs'],
  ['game-2048', 'docs/game-2048-cutover-preflight.md', 'scripts/audit-game-2048-cutover.mjs', 'scripts/smoke-game-2048-go-api.mjs'],
  ['roguelite', 'docs/roguelite-cutover-preflight.md', 'scripts/audit-roguelite-cutover.mjs', 'scripts/smoke-roguelite-go-api.mjs'],
  ['wallet', 'docs/wallet-cutover-preflight.md', 'scripts/audit-wallet-cutover.mjs', 'scripts/smoke-wallet-go-api.mjs', 'scripts/smoke-wallet-write-missing-newapi-go-api.mjs'],
  ['profile', 'docs/profile-cutover-preflight.md', 'scripts/audit-profile-cutover.mjs', 'scripts/smoke-profile-go-api.mjs', 'scripts/smoke-profile-write-go-api.mjs'],
  ['notifications', 'docs/notifications-cutover-preflight.md', 'scripts/audit-notifications-cutover.mjs', 'scripts/smoke-notifications-go-api.mjs', 'scripts/smoke-notifications-write-go-api.mjs'],
  ['farm', 'docs/farm-status-cutover-preflight.md', 'scripts/audit-farm-status-cutover.mjs', 'scripts/smoke-farm-go-api.mjs', 'scripts/smoke-farm-write-go-api.mjs'],
  ['cards', 'docs/cards-cutover-preflight.md', 'scripts/audit-cards-cutover.mjs', 'scripts/smoke-cards-go-api.mjs', 'scripts/smoke-cards-write-go-api.mjs'],
  ['admin-cards', 'docs/admin-cards-cutover-preflight.md', 'scripts/audit-admin-cards-cutover.mjs', 'scripts/smoke-admin-cards-go-api.mjs', 'scripts/smoke-admin-cards-write-go-api.mjs'],
  ['feedback', 'docs/feedback-cutover-preflight.md', 'scripts/audit-feedback-cutover.mjs', 'scripts/smoke-feedback-go-api.mjs'],
];

const requiredPreflightReferences = [
  'scripts/audit-migration-artifacts.mjs',
  'scripts/audit-compose-topology.mjs',
  'scripts/audit-dockerfiles.mjs',
  'scripts/audit-postgres-migrations.mjs',
  'scripts/audit-postgres-live-schema.mjs',
  'scripts/audit-postgres-smoke-residue.mjs',
  'scripts/audit-zeabur-service-plan.mjs',
  'scripts/audit-production-cutover-evidence.mjs',
  'scripts/audit-production-cutover-preflight.mjs',
  'scripts/test-production-cutover-guards.mjs',
  'scripts/audit-deploy-secret-hygiene.mjs',
  'scripts/audit-zeabur-env-example.mjs',
  'scripts/audit-migrate-d1-scopes.mjs',
  'scripts/audit-zeabur-runbook.mjs',
  'scripts/audit-gateway-cutover-guard.mjs',
  'scripts/audit-gateway-allowed-cutovers.mjs',
  'scripts/audit-gateway-upstreams.mjs',
  'scripts/smoke-zeabur-runtime.mjs',
  'scripts/smoke-game-cutovers-go-api.mjs',
  'scripts/audit-game-2048-cutover.mjs',
  'scripts/smoke-game-2048-go-api.mjs',
  'scripts/audit-feedback-cutover.mjs',
  'scripts/smoke-feedback-go-api.mjs',
  'scripts/audit-admin-eco-cutover.mjs',
  'scripts/smoke-admin-eco-go-api.mjs',
  'scripts/audit-admin-points-cutover.mjs',
  'scripts/smoke-admin-points-go-api.mjs',
  'scripts/audit-admin-users-cutover.mjs',
  'scripts/smoke-admin-users-go-api.mjs',
  'scripts/audit-admin-dashboard-cutover.mjs',
  'scripts/smoke-admin-dashboard-go-api.mjs',
  'scripts/audit-admin-projects-cutover.mjs',
  'scripts/smoke-admin-projects-go-api.mjs',
];

const requiredPlanPhrases = [
  'Zeabur 部署前总预检',
  'Zeabur 服务计划',
  'PostgreSQL migration',
  '生产切流准备审计',
  '生产切流证据包',
  '生产切流最终预检',
  '敏感信息卫生审计',
  'Zeabur 真实环境变量审计',
  'D1 导入 scope 一致性审计',
  'Zeabur 运行时基础冒烟',
  'Gateway 上游可配置化',
  'PostgreSQL 冒烟测试残留审计',
  '生产最终预检漂移审计',
  '生产证据包切流审批一致性',
  '生产证据包输入路径一致性',
  '生产切流 guard 失败路径自动化',
  '生产最终预检显式 D1 导出输入',
  '生产最终预检 D1 example 输入拦截文档化',
  '生产切流 guard 覆盖漂移审计',
  '生产 readiness 显式传递证据输入',
  '生产 readiness 证据路径一致性自动 guard',
  '阶段 5 反馈墙本地附件存储',
  '阶段 5 反馈墙 Docker 直连冒烟门禁',
  'fresh Zeabur 新部署',
  '可选归档迁移工具',
  'PR #9 2048 Go 迁移：规则引擎',
  'PR #9 2048 Go 迁移：内部 API',
  'PR #9 2048 Go 迁移：Docker 直连冒烟门禁',
  'PR #9 后台反馈删除 Go 迁移',
  'PR #9 后台环保管理 Go 迁移',
  'PR #9 后台积分管理 Go 迁移',
  'PR #9 后台用户管理 Go 迁移',
  'PR #9 后台仪表盘 Go 迁移',
  'PR #9 后台项目管理 Go 迁移',
];

const missingFiles = [];
for (const file of requiredFiles) {
  if (!existsSync(file)) {
    missingFiles.push(file);
  }
}

const missingModuleArtifacts = [];
for (const [name, ...files] of moduleArtifacts) {
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    missingModuleArtifacts.push({ name, missing });
  }
}

const preflight = existsSync(preflightPath) ? readFileSync(preflightPath, 'utf8') : '';
const missingPreflightReferences = requiredPreflightReferences
  .filter((file) => !preflight.includes(file));

const plan = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
const missingPlanPhrases = requiredPlanPhrases
  .filter((phrase) => !plan.includes(phrase));

if (
  missingFiles.length > 0 ||
  missingModuleArtifacts.length > 0 ||
  missingPreflightReferences.length > 0 ||
  missingPlanPhrases.length > 0
) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'migration-artifact-audit',
    missingFiles,
    missingModuleArtifacts,
    missingPreflightReferences,
    missingPlanPhrases,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'migration-artifact-audit',
  checkedCoreFiles: requiredFiles.length,
  checkedModules: moduleArtifacts.length,
  checkedModuleFiles: moduleArtifacts.reduce((count, [, ...files]) => count + files.length, 0),
  checkedPreflightReferences: requiredPreflightReferences.length,
}, null, 2));
