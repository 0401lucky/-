import { existsSync, rmSync } from 'node:fs';

const batch = 'cloudflare-deploy-artifacts';
const execute = process.argv.includes('--execute');
const confirmValue = process.env.CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS || '';

const artifacts = [
  'cloudflare-env.d.ts',
  'open-next.config.ts',
  'worker-wrapper.mjs',
  'wrangler.jsonc',
  'src/durable-objects/minesweeper-session.ts',
];

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'cloudflare-deploy-artifacts-removal',
    message,
    details,
  }, null, 2));
  process.exit(1);
}

if (execute && confirmValue !== batch) {
  fail(`execute mode requires CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=${batch}`);
}

const existingArtifacts = artifacts.filter((file) => existsSync(file));
const missingArtifacts = artifacts.filter((file) => !existsSync(file));

if (existingArtifacts.length === 0) {
  fail('no Cloudflare deploy artifact files found', { artifacts });
}

if (execute) {
  for (const file of existingArtifacts) {
    rmSync(file);
  }
}

console.log(JSON.stringify({
  ok: true,
  mode: execute ? 'execute' : 'dry-run',
  batch,
  files: existingArtifacts.length,
  deleted: execute ? existingArtifacts.length : 0,
  candidates: existingArtifacts,
  alreadyMissing: missingArtifacts,
  packageCleanupRemaining: [
    'package.json scripts: opennext:patch, preview, deploy, upload, cf-typegen',
    'package.json dependencies/devDependencies: @vercel/kv, @opennextjs/cloudflare, wrangler',
  ],
  nextReviewCommands: [
    'node scripts/audit-legacy-cloudflare-residuals.mjs',
    'node scripts/audit-migration-artifacts.mjs',
    'npm run typecheck',
  ],
}, null, 2));
