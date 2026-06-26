import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const packagePath = 'package.json';

function run(args, env = {}) {
  return spawnSync('node', ['scripts/plan-package-cloudflare-cleanup.mjs', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      CONFIRM_CLEAN_PACKAGE_CLOUDFLARE: env.CONFIRM_CLEAN_PACKAGE_CLOUDFLARE || '',
    },
    maxBuffer: 1024 * 1024 * 4,
  });
}

function assert(condition, message, details = {}) {
  if (!condition) {
    console.error(JSON.stringify({
      ok: false,
      mode: 'package-cloudflare-cleanup-guard-test',
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

const before = readFileSync(packagePath, 'utf8');

const applyWithoutConfirm = run(['--apply']);
assert(applyWithoutConfirm.status !== 0, 'apply without confirmation should fail');
assert(
  /requires CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=package-cloudflare-signals/.test(`${applyWithoutConfirm.stdout}\n${applyWithoutConfirm.stderr}`),
  'apply without confirmation should explain required confirmation',
  { stdout: applyWithoutConfirm.stdout, stderr: applyWithoutConfirm.stderr },
);
assert(readFileSync(packagePath, 'utf8') === before, 'apply without confirmation must not modify package.json');

const dryRun = run([]);
assert(dryRun.status === 0, 'dry-run should succeed', { stdout: dryRun.stdout, stderr: dryRun.stderr });
const dryRunPayload = parseJSON(dryRun.stdout, 'dry-run');
assert(dryRunPayload.mode === 'dry-run', 'dry-run mode should be reported', dryRunPayload);
assert(dryRunPayload.changed === false, 'dry-run should not change package.json', dryRunPayload);
assert(dryRunPayload.removed.scripts.length === 5, 'dry-run should plan 5 script removals', dryRunPayload);
assert(dryRunPayload.removed.dependencies.length === 1, 'dry-run should plan 1 dependency removal', dryRunPayload);
assert(dryRunPayload.removed.devDependencies.length === 2, 'dry-run should plan 2 devDependency removals', dryRunPayload);
assert(readFileSync(packagePath, 'utf8') === before, 'dry-run must not modify package.json');

console.log(JSON.stringify({
  ok: true,
  mode: 'package-cloudflare-cleanup-guard-test',
  checked: [
    'apply without confirmation fails before modification',
    'dry-run does not modify package.json',
    'dry-run reports expected package cleanup plan',
  ],
}, null, 2));
