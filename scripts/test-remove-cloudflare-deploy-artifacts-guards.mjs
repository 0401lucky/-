import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const fixtureFile = 'wrangler.jsonc';

function run(args, env = {}) {
  return spawnSync('node', ['scripts/remove-cloudflare-deploy-artifacts.mjs', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS: env.CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS || '',
    },
    maxBuffer: 1024 * 1024 * 4,
  });
}

function assert(condition, message, details = {}) {
  if (!condition) {
    console.error(JSON.stringify({
      ok: false,
      mode: 'cloudflare-deploy-artifacts-guard-test',
      message,
      details,
    }, null, 2));
    process.exit(1);
  }
}

function parseJSON(output, label) {
  try {
    return JSON.parse(output);
  } catch (error) {
    assert(false, `${label} did not return JSON`, { output, error: String(error) });
  }
}

assert(existsSync(fixtureFile), 'guard fixture file is missing before tests', { fixtureFile });

const executeWithoutConfirm = run(['--execute']);
assert(executeWithoutConfirm.status !== 0, 'execute without confirmation should fail');
assert(
  /requires CONFIRM_DELETE_CLOUDFLARE_DEPLOY_ARTIFACTS=cloudflare-deploy-artifacts/.test(`${executeWithoutConfirm.stdout}\n${executeWithoutConfirm.stderr}`),
  'execute without confirmation should explain required confirmation',
  { stdout: executeWithoutConfirm.stdout, stderr: executeWithoutConfirm.stderr },
);
assert(existsSync(fixtureFile), 'execute without confirmation must not delete files', { fixtureFile });

const dryRun = run([]);
assert(dryRun.status === 0, 'dry-run should succeed', { stdout: dryRun.stdout, stderr: dryRun.stderr });
const dryRunPayload = parseJSON(dryRun.stdout, 'dry-run');
assert(dryRunPayload.mode === 'dry-run', 'dry-run mode should be reported', dryRunPayload);
assert(dryRunPayload.deleted === 0, 'dry-run should delete zero files', dryRunPayload);
assert(dryRunPayload.files === 5, 'Cloudflare deploy artifacts baseline should have 5 files', dryRunPayload);
assert(existsSync(fixtureFile), 'dry-run must not delete files', { fixtureFile });

console.log(JSON.stringify({
  ok: true,
  mode: 'cloudflare-deploy-artifacts-guard-test',
  checked: [
    'execute without confirmation fails before deletion',
    'dry-run deletes zero files',
  ],
}, null, 2));
