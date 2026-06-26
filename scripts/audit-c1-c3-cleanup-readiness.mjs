import { spawnSync } from 'node:child_process';

const routeBatches = [
  '01-tombstoned-legacy-tools',
  '03-auth-routes',
  '04-admin-routes',
  '05-game-routes',
  '06-user-feature-routes',
  '07-public-and-misc-routes',
];

const confirmationToken = 'c1-c3-physical-cleanup';
const confirmation = process.env.CONFIRM_C1_C3_PHYSICAL_CLEANUP || '';

function runJSON(label, command, args, env = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
    maxBuffer: 1024 * 1024 * 12,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      label,
      command: [command, ...args].join(' '),
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }

  try {
    return {
      ok: true,
      label,
      command: [command, ...args].join(' '),
      payload: JSON.parse(result.stdout),
    };
  } catch (error) {
    return {
      ok: false,
      label,
      command: [command, ...args].join(' '),
      status: result.status,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      parseError: String(error),
    };
  }
}

const legacyAudit = runJSON('legacy cloudflare residuals audit', 'node', [
  'scripts/audit-legacy-cloudflare-residuals.mjs',
]);

const routeDeletionPlan = legacyAudit.payload?.nextApiRouteDeletionPlan ?? {};
const packageSignals = legacyAudit.payload?.packageCloudflareSignals ?? {};
const buckets = legacyAudit.payload?.buckets ?? {};

const postCleanupComplete = legacyAudit.ok &&
  legacyAudit.payload?.productionFallbackClean === true &&
  legacyAudit.payload?.productionFallbackSummary?.totalNextApiRoutes === 0 &&
  (buckets.cloudflareDeployArtifacts?.count ?? 0) === 0 &&
  (packageSignals.count ?? 0) === 0 &&
  (buckets.productionSourceLegacyReferences?.count ?? 0) === 0;

const routeDryRuns = postCleanupComplete ? [] : routeBatches.map((batch) => runJSON(
  `next api route cleanup dry-run: ${batch}`,
  'node',
  ['scripts/remove-next-api-routes.mjs', `--batch=${batch}`],
));

const routeGuard = postCleanupComplete ? null : runJSON('next api route cleanup guard', 'node', [
  'scripts/test-remove-next-api-routes-guards.mjs',
]);

const cloudflareArtifactsDryRun = postCleanupComplete ? null : runJSON('cloudflare deploy artifacts cleanup dry-run', 'node', [
  'scripts/remove-cloudflare-deploy-artifacts.mjs',
]);

const cloudflareArtifactsGuard = postCleanupComplete ? null : runJSON('cloudflare deploy artifacts cleanup guard', 'node', [
  'scripts/test-remove-cloudflare-deploy-artifacts-guards.mjs',
]);

const packageDryRun = postCleanupComplete ? null : runJSON('package cloudflare cleanup dry-run', 'node', [
  'scripts/plan-package-cloudflare-cleanup.mjs',
]);

const packageGuard = postCleanupComplete ? null : runJSON('package cloudflare cleanup guard', 'node', [
  'scripts/test-package-cloudflare-cleanup-guards.mjs',
]);

const checks = [
  legacyAudit,
  ...routeDryRuns,
  routeGuard,
  cloudflareArtifactsDryRun,
  cloudflareArtifactsGuard,
  packageDryRun,
  packageGuard,
].filter(Boolean);

const failedChecks = checks.filter((check) => !check.ok);
const routeSummary = routeDryRuns.map((check) => ({
  batch: check.payload?.batch ?? check.label,
  ok: check.ok,
  files: check.payload?.files ?? 0,
  routes: check.payload?.routes ?? 0,
  deleted: check.payload?.deleted ?? null,
}));

const preCleanupDryRunsReady = failedChecks.length === 0 &&
  routeDeletionPlan.readyForRouteDeletion === true &&
  routeDeletionPlan.manualReviewRoutes === 0 &&
  routeDryRuns.every((check) => check.payload?.mode === 'dry-run' && check.payload?.deleted === 0) &&
  cloudflareArtifactsDryRun?.payload?.mode === 'dry-run' &&
  cloudflareArtifactsDryRun?.payload?.deleted === 0 &&
  packageDryRun?.payload?.mode === 'dry-run' &&
  packageDryRun?.payload?.changed === false;

const dryRunsReady = postCleanupComplete || preCleanupDryRunsReady;

const physicalDeletionConfirmed = postCleanupComplete || confirmation === confirmationToken;

const payload = {
  ok: postCleanupComplete || failedChecks.length === 0,
  mode: 'c1-c3-cleanup-readiness',
  cleanupState: postCleanupComplete ? 'post-clean-complete' : 'pre-clean-ready-check',
  dryRunsReady,
  physicalDeletionConfirmed,
  requiredConfirmation: `CONFIRM_C1_C3_PHYSICAL_CLEANUP=${confirmationToken}`,
  summary: {
    productionFallbackClean: legacyAudit.payload?.productionFallbackClean ?? false,
    nextApiRouteDeletionReady: postCleanupComplete || routeDeletionPlan.readyForRouteDeletion === true,
    nextApiManualReviewRoutes: routeDeletionPlan.manualReviewRoutes ?? null,
    nextApiDeleteCandidateRoutes: routeDeletionPlan.deleteCandidateRoutes ?? null,
    routeDryRuns: routeSummary,
    cloudflareDeployArtifacts: buckets.cloudflareDeployArtifacts?.count ?? null,
    packageCloudflareSignals: packageSignals.count ?? null,
    productionSourceLegacyReferences: buckets.productionSourceLegacyReferences?.count ?? null,
  },
  executionOrderWhenConfirmed: [
    'npm run cleanup:next-api-routes:dry-run -- --batch=01-tombstoned-legacy-tools',
    'CONFIRM_DELETE_NEXT_API_ROUTES=01-tombstoned-legacy-tools node scripts/remove-next-api-routes.mjs --batch=01-tombstoned-legacy-tools --execute',
    '逐批复跑 review 命令后再继续 03/04/05/06/07 批次',
    'CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts node scripts/remove-cloudflare-deploy-artifacts.mjs --execute',
    'CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals node scripts/plan-package-cloudflare-cleanup.mjs --apply',
    'npm install',
    'npm run typecheck',
    'node scripts/audit-legacy-cloudflare-residuals.mjs',
  ],
  failedChecks,
};

console.log(JSON.stringify(payload, null, 2));

if (!postCleanupComplete && failedChecks.length > 0) {
  process.exit(1);
}
