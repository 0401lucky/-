import { spawnSync } from 'node:child_process';

const steps = [
  ['gateway guard', ['scripts/audit-gateway-cutover-guard.mjs']],
  ['memory audit', ['scripts/audit-memory-cutover.mjs']],
  ['memory smoke', ['scripts/smoke-memory-go-api.mjs']],
  ['match3 audit', ['scripts/audit-match3-cutover.mjs']],
  ['match3 smoke', ['scripts/smoke-match3-go-api.mjs']],
  ['whack-mole audit', ['scripts/audit-whack-mole-cutover.mjs']],
  ['whack-mole smoke', ['scripts/smoke-whack-mole-go-api.mjs']],
  ['minesweeper audit', ['scripts/audit-minesweeper-cutover.mjs']],
  ['minesweeper smoke', ['scripts/smoke-minesweeper-go-api.mjs']],
  ['linkgame audit', ['scripts/audit-linkgame-cutover.mjs']],
  ['linkgame smoke', ['scripts/smoke-linkgame-go-api.mjs']],
  ['roguelite audit', ['scripts/audit-roguelite-cutover.mjs']],
  ['roguelite smoke', ['scripts/smoke-roguelite-go-api.mjs']],
];

function runStep(label, args) {
  const startedAt = Date.now();
  const result = spawnSync('node', args, {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1024 * 1024 * 8,
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    console.error(`game cutover suite failed at ${label}`);
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
    command: ['node', ...args].join(' '),
    durationMs,
  };
}

const results = [];
for (const [label, args] of steps) {
  results.push(runStep(label, args));
}

console.log(JSON.stringify({
  ok: true,
  mode: 'docker-compose-game-cutover-suite',
  steps: results,
  checkedGames: [
    'memory',
    'match3',
    'whack-mole',
    'minesweeper',
    'linkgame',
    'roguelite',
  ],
}, null, 2));
