import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function runJSON(label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 60000,
    env: {
      ...process.env,
      ...(options.env || {}),
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
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      parseError: String(error),
    };
  }
}

function checkTextFile(file, phrases) {
  if (!existsSync(file)) {
    return {
      ok: false,
      file,
      missingFile: true,
      missingPhrases: phrases,
    };
  }
  const content = readFileSync(file, 'utf8');
  const missingPhrases = phrases.filter((phrase) => !content.includes(phrase));
  return {
    ok: missingPhrases.length === 0,
    file,
    missingPhrases,
  };
}

const checks = {
  migrationArtifacts: runJSON('migration artifacts', 'node', ['scripts/audit-migration-artifacts.mjs']),
  pr9Reconciliation: runJSON('pr 9 go reconciliation', 'node', ['scripts/audit-pr-9-go-reconciliation.mjs']),
  zeaburSinglePlan: runJSON('zeabur single service plan', 'node', ['scripts/audit-zeabur-single-plan.mjs']),
  dockerfiles: runJSON('dockerfiles', 'node', ['scripts/audit-dockerfiles.mjs']),
  c1c3Readiness: runJSON('c1-c3 cleanup readiness', 'node', ['scripts/audit-c1-c3-cleanup-readiness.mjs'], { timeout: 180000 }),
  c1c3Runbook: runJSON('c1-c3 cleanup runbook', 'node', ['scripts/audit-c1-c3-cleanup-runbook.mjs']),
  productionReadiness: runJSON('production cutover readiness', 'node', ['scripts/audit-production-cutover-readiness.mjs']),
};

const workflowCheck = checkTextFile('.github/workflows/build-ghcr-image.yml', [
  'ghcr.io/0401lucky/redemption-zeabur',
  'file: ./Dockerfile',
  'push: true',
  'platforms: linux/amd64',
]);

const ghcrDocCheck = checkTextFile('docs/zeabur-ghcr-image-deployment.md', [
  'ghcr.io/0401lucky/redemption-zeabur:latest',
  'Custom Docker Image',
  '8080',
  '.github/workflows/build-ghcr-image.yml',
  'NEW_API_ADMIN_ACCESS_TOKEN',
  '个人设置 / 系统访问令牌',
  'FEEDBACK_MEDIA_DIR=/data/feedback-media',
  'Mount Path: /data',
  '/app/migrate',
  'fresh Zeabur',
]);

const dockerfileCheck = checkTextFile('Dockerfile', [
  'COPY scripts/start-zeabur.sh /app/start-zeabur.sh',
  'COPY gateway/Caddyfile /app/gateway/Caddyfile',
  'COPY --from=go-builder /out/api /app/api',
  'COPY --from=go-builder /out/worker /app/worker',
  'EXPOSE 8080',
  'CMD ["/app/start-zeabur.sh"]',
]);

const releaseReadinessDocCheck = checkTextFile('docs/current-go-zeabur-release-readiness.md', [
  '当前代码可以先推到 `main`',
  '生产 readiness',
  'C1-C3 物理清理未确认执行',
  'Custom Docker Image',
  'ghcr.io/0401lucky/redemption-zeabur:latest',
  '/app/migrate',
  'fresh Zeabur',
  'Mount Path: /data',
  '个人设置 / 系统访问令牌',
  '2048 开局与结算',
]);

const evidenceCollectionDocCheck = checkTextFile('docs/production-evidence-collection-runbook.md', [
  'AUTH_GO_API_COOKIE',
  'WALLET_GO_API_COOKIE',
  'PROFILE_GO_API_COOKIE',
  'NOTIFICATIONS_GO_API_COOKIE',
  'FARM_GO_API_COOKIE',
  'CARDS_GO_API_COOKIE',
  'ADMIN_CARDS_GO_API_COOKIE',
  'node scripts/smoke-auth-login-go-api.mjs',
  'node scripts/smoke-wallet-go-api.mjs',
  'node scripts/smoke-profile-go-api.mjs',
  'node scripts/smoke-notifications-go-api.mjs',
  'node scripts/smoke-farm-go-api.mjs',
  'node scripts/smoke-cards-go-api.mjs',
  'node scripts/smoke-admin-cards-go-api.mjs',
  'CUTOVER_EVIDENCE_FILE=./deploy/production-cutover-evidence.json',
  '不记录 Cookie 原文',
]);

const staticChecks = {
  workflowCheck,
  ghcrDocCheck,
  dockerfileCheck,
  releaseReadinessDocCheck,
  evidenceCollectionDocCheck,
};

const hardFailures = [];
for (const [name, check] of Object.entries(checks)) {
  if (name === 'productionReadiness') {
    continue;
  }
  if (!check.ok) {
    hardFailures.push({ name, check });
  }
}
for (const [name, check] of Object.entries(staticChecks)) {
  if (!check.ok) {
    hardFailures.push({ name, check });
  }
}

const productionReadiness = checks.productionReadiness.payload ?? {};
const c1c3Readiness = checks.c1c3Readiness.payload ?? {};

const payload = {
  ok: hardFailures.length === 0,
  mode: 'current-go-zeabur-release-audit',
  deployForTestingReady: hardFailures.length === 0,
  productionEvidenceReady: checks.productionReadiness.ok && productionReadiness.ready === true,
  hardFailures,
  summary: {
    ghcrWorkflowReady: workflowCheck.ok,
    dockerfileSingleContainerReady: dockerfileCheck.ok,
    zeaburSinglePlanReady: checks.zeaburSinglePlan.ok,
    pr9GoReconciliationReady: checks.pr9Reconciliation.ok,
    c1c3DryRunsReady: c1c3Readiness.dryRunsReady === true,
    c1c3PhysicalDeletionConfirmed: c1c3Readiness.physicalDeletionConfirmed === true,
    productionBlockedModules: productionReadiness.blockedModules || [],
  },
  softBlockers: [
    ...(checks.productionReadiness.ok && productionReadiness.ready === false
      ? [`production readiness still blocked: ${(productionReadiness.blockedModules || []).join(', ')}`]
      : []),
    ...(c1c3Readiness.physicalDeletionConfirmed === false
      ? ['C1-C3 physical cleanup is prepared but not confirmed/executed']
      : []),
  ],
  nextCommands: [
    'npm run audit:current-go-zeabur-release',
    'npm run typecheck',
    'git push origin main',
    'GitHub Actions: Build GHCR image',
    'Zeabur: deploy ghcr.io/0401lucky/redemption-zeabur:latest on port 8080',
  ],
};

console.log(JSON.stringify(payload, null, 2));

if (hardFailures.length > 0) {
  process.exit(1);
}
