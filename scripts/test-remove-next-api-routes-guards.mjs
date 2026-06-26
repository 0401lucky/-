import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const tombstoneFile = 'src/app/api/admin/sync-users/route.ts';

function run(args, env = {}) {
  return spawnSync('node', ['scripts/remove-next-api-routes.mjs', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      CONFIRM_DELETE_NEXT_API_ROUTES: env.CONFIRM_DELETE_NEXT_API_ROUTES || '',
    },
    maxBuffer: 1024 * 1024 * 4,
  });
}

function assert(condition, message, details = {}) {
  if (!condition) {
    console.error(JSON.stringify({
      ok: false,
      mode: 'remove-next-api-routes-guard-test',
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

assert(existsSync(tombstoneFile), 'guard fixture file is missing before tests', { tombstoneFile });

const invalidBatch = run(['--batch=invalid']);
assert(invalidBatch.status !== 0, 'invalid batch should fail');
assert(
  /missing or invalid --batch/.test(`${invalidBatch.stdout}\n${invalidBatch.stderr}`),
  'invalid batch failure should explain valid batches',
  { stdout: invalidBatch.stdout, stderr: invalidBatch.stderr },
);

const executeWithoutConfirm = run(['--batch=01-tombstoned-legacy-tools', '--execute']);
assert(executeWithoutConfirm.status !== 0, 'execute without confirmation should fail');
assert(
  /requires CONFIRM_DELETE_NEXT_API_ROUTES=01-tombstoned-legacy-tools/.test(`${executeWithoutConfirm.stdout}\n${executeWithoutConfirm.stderr}`),
  'execute without confirmation should explain required confirmation',
  { stdout: executeWithoutConfirm.stdout, stderr: executeWithoutConfirm.stderr },
);
assert(existsSync(tombstoneFile), 'execute without confirmation must not delete files', { tombstoneFile });

const dryRun = run(['--batch=01-tombstoned-legacy-tools']);
assert(dryRun.status === 0, 'dry-run should succeed', { stdout: dryRun.stdout, stderr: dryRun.stderr });
const dryRunPayload = parseJSON(dryRun.stdout, 'dry-run');
assert(dryRunPayload.mode === 'dry-run', 'dry-run mode should be reported', dryRunPayload);
assert(dryRunPayload.deleted === 0, 'dry-run should delete zero files', dryRunPayload);
assert(dryRunPayload.files === 10, 'tombstoned batch should have 10 files in current baseline', dryRunPayload);
assert(existsSync(tombstoneFile), 'dry-run must not delete files', { tombstoneFile });

console.log(JSON.stringify({
  ok: true,
  mode: 'remove-next-api-routes-guard-test',
  checked: [
    'invalid batch fails',
    'execute without confirmation fails before deletion',
    'dry-run deletes zero files',
  ],
}, null, 2));
