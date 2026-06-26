import { existsSync, readFileSync } from 'node:fs';

const runbookPath = 'docs/c1-c3-physical-cleanup-runbook.md';

const requiredPhrases = [
  'npm run audit:c1-c3-cleanup-readiness',
  'CONFIRM_C1_C3_PHYSICAL_CLEANUP=c1-c3-physical-cleanup',
  'CONFIRM_DELETE_NEXT_API_ROUTES=01-tombstoned-legacy-tools',
  'CONFIRM_DELETE_NEXT_API_ROUTES=03-auth-routes',
  'CONFIRM_DELETE_NEXT_API_ROUTES=04-admin-routes',
  'CONFIRM_DELETE_NEXT_API_ROUTES=05-game-routes',
  'CONFIRM_DELETE_NEXT_API_ROUTES=06-user-feature-routes',
  'CONFIRM_DELETE_NEXT_API_ROUTES=07-public-and-misc-routes',
  'CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts',
  'CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals',
  'LEGACY_CLOUDFLARE_RESIDUALS_STRICT=1 node scripts/audit-legacy-cloudflare-residuals.mjs',
  'productionSourceLegacyReferences.count = 0',
  'cloudflareDeployArtifacts.count = 0',
  'packageCloudflareSignals.count = 0',
  '不恢复 `games/fallback`',
  '`migrate-d1` 仍作为可选归档迁移工具保留',
  '不使用 `git reset --hard`',
];

const batchExpectations = [
  ['批次 1：墓碑化旧工具 API', '--batch=01-tombstoned-legacy-tools', '执行器删除 10 个文件'],
  ['批次 2：认证 API', '--batch=03-auth-routes', '执行器删除 3 个文件'],
  ['批次 3：后台 API', '--batch=04-admin-routes', '执行器删除 37 个文件'],
  ['批次 4：游戏 API', '--batch=05-game-routes', '执行器删除 38 个文件'],
  ['批次 5：用户功能 API', '--batch=06-user-feature-routes', '执行器删除 38 个文件'],
  ['批次 6：公开与杂项 API', '--batch=07-public-and-misc-routes', '执行器删除 28 个文件'],
  ['批次 7：Cloudflare/OpenNext 文件产物', 'cleanup:cloudflare-deploy-artifacts:dry-run', '删除 5 个文件型部署产物'],
  ['批次 8：package Cloudflare 信号', 'cleanup:package-cloudflare:dry-run', 'package-lock.json'],
];

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'c1-c3-cleanup-runbook-audit',
    message,
    details,
  }, null, 2));
  process.exit(1);
}

if (!existsSync(runbookPath)) {
  fail('runbook file is missing', { runbookPath });
}

const runbook = readFileSync(runbookPath, 'utf8');

const missingPhrases = requiredPhrases.filter((phrase) => !runbook.includes(phrase));
const missingBatchExpectations = batchExpectations
  .map(([heading, command, completion]) => ({
    heading,
    command,
    completion,
    present: runbook.includes(heading) && runbook.includes(command) && runbook.includes(completion),
  }))
  .filter((entry) => !entry.present);

const batchHeadingCount = (runbook.match(/^## 批次 /gm) || []).length;

if (missingPhrases.length > 0 || missingBatchExpectations.length > 0 || batchHeadingCount !== 8) {
  fail('runbook is missing required cleanup guidance', {
    missingPhrases,
    missingBatchExpectations,
    batchHeadingCount,
    expectedBatchHeadingCount: 8,
  });
}

console.log(JSON.stringify({
  ok: true,
  mode: 'c1-c3-cleanup-runbook-audit',
  checkedPhrases: requiredPhrases.length,
  checkedBatches: batchExpectations.length,
  batchHeadingCount,
}, null, 2));
