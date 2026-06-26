import { spawnSync } from 'node:child_process';

const includeInternal = process.env.ZEABUR_PREFLIGHT_INCLUDE_INTERNAL === '1';

const steps = [
  ['migration artifact audit', 'node', ['scripts/audit-migration-artifacts.mjs'], 60000],
  ['pr 9 go reconciliation audit', 'node', ['scripts/audit-pr-9-go-reconciliation.mjs'], 60000],
  ['legacy cloudflare residuals audit', 'node', ['scripts/audit-legacy-cloudflare-residuals.mjs'], 60000],
  ['c1-c3 cleanup readiness audit', 'node', ['scripts/audit-c1-c3-cleanup-readiness.mjs'], 180000],
  ['c1-c3 cleanup runbook audit', 'node', ['scripts/audit-c1-c3-cleanup-runbook.mjs'], 60000],
  ['next api route deletion dry-run', 'node', ['scripts/remove-next-api-routes.mjs', '--batch=01-tombstoned-legacy-tools'], 60000],
  ['next api route cleanup guards', 'node', ['scripts/test-remove-next-api-routes-guards.mjs'], 60000],
  ['cloudflare deploy artifacts deletion dry-run', 'node', ['scripts/remove-cloudflare-deploy-artifacts.mjs'], 60000],
  ['cloudflare deploy artifacts cleanup guards', 'node', ['scripts/test-remove-cloudflare-deploy-artifacts-guards.mjs'], 60000],
  ['package cloudflare signals cleanup dry-run', 'node', ['scripts/plan-package-cloudflare-cleanup.mjs'], 60000],
  ['package cloudflare signals cleanup guards', 'node', ['scripts/test-package-cloudflare-cleanup-guards.mjs'], 60000],
  ['compose topology audit', 'node', ['scripts/audit-compose-topology.mjs'], 60000],
  ['dockerfile audit', 'node', ['scripts/audit-dockerfiles.mjs'], 60000],
  ['postgres migrations audit', 'node', ['scripts/audit-postgres-migrations.mjs'], 60000],
  ['postgres live schema audit', 'node', ['scripts/audit-postgres-live-schema.mjs'], 60000],
  ['zeabur service plan audit', 'node', ['scripts/audit-zeabur-service-plan.mjs'], 60000],
  ['zeabur single plan audit', 'node', ['scripts/audit-zeabur-single-plan.mjs'], 60000],
  ['production cutover evidence template audit', 'node', ['scripts/audit-production-cutover-evidence.mjs'], 60000],
  ['production cutover preflight audit', 'node', ['scripts/audit-production-cutover-preflight.mjs'], 60000],
  ['production cutover guards test', 'node', ['scripts/test-production-cutover-guards.mjs'], 60000],
  ['deploy secret hygiene audit', 'node', ['scripts/audit-deploy-secret-hygiene.mjs'], 60000],
  ['zeabur env example audit', 'node', ['scripts/audit-zeabur-env-example.mjs'], 60000],
  ['migrate-d1 scope audit', 'node', ['scripts/audit-migrate-d1-scopes.mjs'], 60000],
  ['zeabur runbook audit', 'node', ['scripts/audit-zeabur-runbook.mjs'], 60000],
  ['compose config', 'docker', ['compose', 'config', '--quiet'], 60000],
  ['gateway upstreams audit', 'node', ['scripts/audit-gateway-upstreams.mjs'], 60000],
  ['gateway guard', 'node', ['scripts/audit-gateway-cutover-guard.mjs'], 60000],
  ['gateway allowed cutovers audit', 'node', ['scripts/audit-gateway-allowed-cutovers.mjs'], 60000],
  ['zeabur runtime smoke', 'node', ['scripts/smoke-zeabur-runtime.mjs'], 120000],
  ['auth/login cutover smoke', 'node', ['scripts/smoke-auth-login-go-api.mjs'], 180000],
  ['auth/me sync smoke', 'node', ['scripts/smoke-auth-me-go-api.mjs'], 180000],
  ['auth/logout revocation smoke', 'node', ['scripts/smoke-auth-logout-go-api.mjs'], 180000],
  ['checkin audit', 'node', ['scripts/audit-checkin-cutover.mjs'], 60000],
  ['checkin smoke', 'node', ['scripts/smoke-checkin-go-api.mjs'], 180000],
  ['announcements audit', 'node', ['scripts/audit-announcements-cutover.mjs'], 60000],
  ['announcements smoke', 'node', ['scripts/smoke-announcements-go-api.mjs'], 180000],
  ['lottery cutover audit', 'node', ['scripts/audit-lottery-cutover.mjs'], 60000],
  ['rankings cutover audit', 'node', ['scripts/audit-rankings-cutover.mjs'], 60000],
  ['points/rankings audit', 'node', ['scripts/audit-points-rankings-cutover.mjs'], 60000],
  ['points/rankings smoke', 'node', ['scripts/smoke-points-rankings-go-api.mjs'], 180000],
  ['store audit', 'node', ['scripts/audit-store-cutover.mjs'], 60000],
  ['store smoke', 'node', ['scripts/smoke-store-go-api.mjs'], 180000],
  ['admin store reset tombstone audit', 'node', ['scripts/audit-admin-store-reset-tombstone.mjs'], 60000],
  ['admin store reset tombstone smoke', 'node', ['scripts/smoke-admin-store-reset-go-api.mjs'], 180000],
  ['eco audit', 'node', ['scripts/audit-eco-cutover.mjs'], 60000],
  ['eco smoke', 'node', ['scripts/smoke-eco-go-api.mjs'], 180000],
  ['admin eco audit', 'node', ['scripts/audit-admin-eco-cutover.mjs'], 60000],
  ['admin eco smoke', 'node', ['scripts/smoke-admin-eco-go-api.mjs'], 180000],
  ['admin points audit', 'node', ['scripts/audit-admin-points-cutover.mjs'], 60000],
  ['admin points smoke', 'node', ['scripts/smoke-admin-points-go-api.mjs'], 180000],
  ['admin users audit', 'node', ['scripts/audit-admin-users-cutover.mjs'], 60000],
  ['admin users smoke', 'node', ['scripts/smoke-admin-users-go-api.mjs'], 180000],
  ['admin dashboard audit', 'node', ['scripts/audit-admin-dashboard-cutover.mjs'], 60000],
  ['admin alerts audit', 'node', ['scripts/audit-admin-alerts-cutover.mjs'], 60000],
  ['admin tools audit', 'node', ['scripts/audit-admin-tools-cutover.mjs'], 60000],
  ['admin legacy tools smoke', 'node', ['scripts/smoke-admin-legacy-tools-go-api.mjs'], 180000],
  ['admin dashboard smoke', 'node', ['scripts/smoke-admin-dashboard-go-api.mjs'], 180000],
  ['admin rewards audit', 'node', ['scripts/audit-admin-rewards-cutover.mjs'], 60000],
  ['admin rewards smoke', 'node', ['scripts/smoke-admin-rewards-go-api.mjs'], 180000],
  ['admin projects audit', 'node', ['scripts/audit-admin-projects-cutover.mjs'], 60000],
  ['admin projects smoke', 'node', ['scripts/smoke-admin-projects-go-api.mjs'], 180000],
  ['projects audit', 'node', ['scripts/audit-projects-cutover.mjs'], 60000],
  ['projects smoke', 'node', ['scripts/smoke-projects-go-api.mjs'], 180000],
  ['raffle audit', 'node', ['scripts/audit-raffle-cutover.mjs'], 60000],
  ['raffle smoke', 'node', ['scripts/smoke-raffle-go-api.mjs'], 180000],
  ['games summary audit', 'node', ['scripts/audit-games-summary-cutover.mjs'], 60000],
  ['games summary smoke', 'node', ['scripts/smoke-games-summary-go-api.mjs'], 180000],
  ['ordinary games suite', 'node', ['scripts/smoke-game-cutovers-go-api.mjs'], 420000],
  ['2048 audit', 'node', ['scripts/audit-game-2048-cutover.mjs'], 60000],
  ['2048 smoke', 'node', ['scripts/smoke-game-2048-go-api.mjs'], 180000],
  ['wallet missing-newapi safety smoke', 'node', ['scripts/smoke-wallet-write-missing-newapi-go-api.mjs'], 180000],
  ['feedback audit', 'node', ['scripts/audit-feedback-cutover.mjs'], 60000],
  ['feedback smoke', 'node', ['scripts/smoke-feedback-go-api.mjs'], 180000],
  ['farm audit', 'node', ['scripts/audit-farm-status-cutover.mjs'], 60000],
  ['farm write smoke', 'node', ['scripts/smoke-farm-write-go-api.mjs'], 240000],
];

const internalSteps = [
  ['profile audit', 'node', ['scripts/audit-profile-cutover.mjs'], 60000],
  ['profile write smoke', 'node', ['scripts/smoke-profile-write-go-api.mjs'], 180000],
  ['notifications audit', 'node', ['scripts/audit-notifications-cutover.mjs'], 60000],
  ['notifications write smoke', 'node', ['scripts/smoke-notifications-write-go-api.mjs'], 180000],
  ['cards audit', 'node', ['scripts/audit-cards-cutover.mjs'], 60000],
  ['cards write smoke', 'node', ['scripts/smoke-cards-write-go-api.mjs'], 180000],
  ['admin cards audit', 'node', ['scripts/audit-admin-cards-cutover.mjs'], 60000],
  ['admin cards write smoke', 'node', ['scripts/smoke-admin-cards-write-go-api.mjs'], 180000],
];

if (includeInternal) {
  steps.push(...internalSteps);
}

steps.push(['postgres smoke residue audit', 'node', ['scripts/audit-postgres-smoke-residue.mjs'], 60000]);

function runStep(label, command, args, timeout) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024 * 12,
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    console.error(`zeabur preflight failed at ${label}`);
    if (result.stdout.trim()) {
      console.error(result.stdout.trim());
    }
    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status || 1);
  }
  return {
    label,
    command: [command, ...args].join(' '),
    durationMs,
  };
}

const results = [];
for (const [label, command, args, timeout] of steps) {
  results.push(runStep(label, command, args, timeout));
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-go-api-preflight',
  includeInternal,
  steps: results,
  guardedForbiddenPrefixes: [
    '/api/farm*',
    '/api/profile* 通配',
    '/api/notifications* 通配',
    '/api/store/topup',
    '/api/store/withdraw',
    '/api/cards 根路径或通配',
    '/api/admin/cards 根路径或通配',
    '/api/games/*',
    '/api/projects* 通配',
    '/api/admin/*',
  ],
}, null, 2));
