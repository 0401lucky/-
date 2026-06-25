import { readFileSync } from 'node:fs';

const runbookPath = 'docs/zeabur-deployment-runbook.md';
const runbook = readFileSync(runbookPath, 'utf8');

const requiredSnippets = [
  'docker compose up --build -d',
  'docker compose config --quiet',
  'docker compose exec -T api /app/migrate',
  'node scripts/audit-migration-artifacts.mjs',
  'node scripts/audit-compose-topology.mjs',
  'node scripts/audit-dockerfiles.mjs',
  'node scripts/audit-postgres-migrations.mjs',
  'node scripts/audit-postgres-live-schema.mjs',
  'node scripts/audit-zeabur-single-plan.mjs',
  'node scripts/audit-production-cutover-evidence.mjs',
  'node scripts/audit-production-cutover-preflight.mjs',
  'node scripts/test-production-cutover-guards.mjs',
  'node scripts/audit-deploy-secret-hygiene.mjs',
  'node scripts/preflight-zeabur-go-api.mjs',
  'ZEABUR_PREFLIGHT_INCLUDE_INTERNAL=1 node scripts/preflight-zeabur-go-api.mjs',
  'node scripts/audit-zeabur-env-example.mjs',
  'deploy/zeabur-single-service.example.json',
  'ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-zeabur-runtime-env.mjs',
  '当前生产策略是 fresh Zeabur 新部署，不从 Cloudflare D1 迁移历史数据。',
  'docker compose exec -T api /app/migrate',
  'D1 导出与 `migrate-d1` 仍保留为可选归档迁移工具。',
  'go run ./cmd/migrate-d1 -input "$D1_EXPORT_SQL"',
  'node scripts/audit-migrate-d1-scopes.mjs',
  'node scripts/audit-production-cutover-readiness.mjs',
  'CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json node scripts/audit-production-cutover-evidence.mjs',
  'CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json ZEABUR_ENV_FILE=./deploy/zeabur.env ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com node scripts/preflight-production-cutover.mjs',
  'node scripts/test-production-cutover-guards.mjs` 必须覆盖 8 类失败路径',
  'ZEABUR_ENV_FILE=./deploy/zeabur.env node scripts/audit-production-cutover-readiness.mjs',
  'node scripts/audit-gateway-cutover-guard.mjs',
  'node scripts/audit-gateway-allowed-cutovers.mjs',
  'node scripts/smoke-zeabur-runtime.mjs',
  'ZEABUR_RUNTIME_BASE_URL=https://your-domain.example.com ZEABUR_RUNTIME_REQUIRE_REMOTE=1 node scripts/smoke-zeabur-runtime.mjs',
  'GET /healthz',
  'GET /readyz',
  'GATEWAY_PORT',
  'WEB_PORT',
  'API_PORT',
  'ZBPACK_DOCKERFILE_PATH=Dockerfile',
  'app 服务',
  '/data/feedback-media',
  'FEEDBACK_MEDIA_DIR',
  'FEEDBACK_MEDIA_PUBLIC_URL',
  'git reset --hard',
];

const scopes = [
  'public-lists',
  'users-points',
  'points-history',
  'store-data',
  'user-assets',
  'user-profiles',
  'user-achievements',
  'notifications',
  'reward-claims',
  'raffle-entries',
  'eco-state',
  'eco-global',
  'farm-v2',
  'cards',
  'feedback',
];

const forbiddenPaths = [
  '/api/farm*',
  '/api/profile*',
  '/api/notifications*',
  '/api/store/topup',
  '/api/store/withdraw',
  '/api/cards*',
  '/api/admin/cards*',
  '/api/games/*',
  '/api/projects/*',
  '/api/admin/*',
];

const missingSnippets = requiredSnippets.filter((snippet) => !runbook.includes(snippet));
const missingScopes = scopes.filter((scope) => !runbook.includes(`-scope ${scope}`));
const missingForbiddenPaths = forbiddenPaths.filter((path) => !runbook.includes(path));

if (missingSnippets.length > 0 || missingScopes.length > 0 || missingForbiddenPaths.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-runbook-audit',
    missingSnippets,
    missingScopes,
    missingForbiddenPaths,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-runbook-audit',
  runbookPath,
  checkedSnippets: requiredSnippets.length,
  checkedScopes: scopes.length,
  checkedForbiddenPaths: forbiddenPaths.length,
}, null, 2));
