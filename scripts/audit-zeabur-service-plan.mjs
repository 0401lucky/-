import { spawnSync } from 'node:child_process';

const result = spawnSync('node', ['scripts/audit-zeabur-single-plan.mjs'], {
  encoding: 'utf8',
  stdio: 'inherit',
});

process.exit(result.status || 0);
