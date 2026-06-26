import { existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const validBatches = new Set([
  '01-tombstoned-legacy-tools',
  '03-auth-routes',
  '04-admin-routes',
  '05-game-routes',
  '06-user-feature-routes',
  '07-public-and-misc-routes',
]);

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const batchArg = process.argv.find((arg) => arg.startsWith('--batch='));
const batch = batchArg ? batchArg.slice('--batch='.length) : '';
const confirmValue = process.env.CONFIRM_DELETE_NEXT_API_ROUTES || '';

function fail(message) {
  console.error(`remove-next-api-routes failed: ${message}`);
  process.exit(1);
}

if (!batch || !validBatches.has(batch)) {
  fail(`missing or invalid --batch. valid batches: ${[...validBatches].join(', ')}`);
}

if (execute && confirmValue !== batch) {
  fail(`execute mode requires CONFIRM_DELETE_NEXT_API_ROUTES=${batch}`);
}

const auditOutput = execFileSync('node', ['scripts/audit-legacy-cloudflare-residuals.mjs'], {
  env: {
    ...process.env,
    LEGACY_CLOUDFLARE_RESIDUALS_FULL: '1',
  },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const audit = JSON.parse(auditOutput);
const routes = audit.nextApiRouteDeletionPlan?.candidateRoutes || [];
const selectedRoutes = routes.filter((route) => {
  if (route.bucket === 'alreadyGoTombstoned') {
    return batch === '01-tombstoned-legacy-tools';
  }
  if (route.path.startsWith('/api/internal/')) {
    return batch === '02-internal-cron-routes';
  }
  if (route.path.startsWith('/api/auth/')) {
    return batch === '03-auth-routes';
  }
  if (route.path.startsWith('/api/admin/')) {
    return batch === '04-admin-routes';
  }
  if (route.path.startsWith('/api/games/')) {
    return batch === '05-game-routes';
  }
  if (
    route.path.startsWith('/api/farm') ||
    route.path.startsWith('/api/cards') ||
    route.path.startsWith('/api/store') ||
    route.path.startsWith('/api/profile') ||
    route.path.startsWith('/api/notifications')
  ) {
    return batch === '06-user-feature-routes';
  }
  return batch === '07-public-and-misc-routes';
});

const files = [...new Set(selectedRoutes.map((route) => route.file).filter(Boolean))].sort();

if (files.length === 0) {
  fail(`batch ${batch} has no candidate files`);
}

const missingFiles = files.filter((file) => !existsSync(file));
if (missingFiles.length > 0) {
  fail(`candidate files are already missing: ${missingFiles.join(', ')}`);
}

if (execute) {
  for (const file of files) {
    rmSync(file);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: execute ? 'execute' : 'dry-run',
  batch,
  files: files.length,
  routes: selectedRoutes.length,
  deleted: execute ? files.length : 0,
  candidates: files,
  nextReviewCommands: [
    'node scripts/audit-next-api-fallback-risk.mjs',
    'node scripts/audit-legacy-cloudflare-residuals.mjs',
    'node scripts/audit-gateway-cutover-guard.mjs',
    'node scripts/audit-gateway-allowed-cutovers.mjs',
    'npm run typecheck',
  ],
}, null, 2));
