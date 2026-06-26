import { readFileSync, writeFileSync } from 'node:fs';

const packagePath = 'package.json';
const apply = process.argv.includes('--apply');
const confirmToken = 'package-cloudflare-signals';
const confirmValue = process.env.CONFIRM_CLEAN_PACKAGE_CLOUDFLARE || '';

const scriptsToRemove = [
  'opennext:patch',
  'preview',
  'deploy',
  'upload',
  'cf-typegen',
];

const dependenciesToRemove = [
  '@vercel/kv',
];

const devDependenciesToRemove = [
  '@opennextjs/cloudflare',
  'wrangler',
];

function fail(message, details = {}) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'package-cloudflare-cleanup',
    message,
    details,
  }, null, 2));
  process.exit(1);
}

if (apply && confirmValue !== confirmToken) {
  fail(`apply mode requires CONFIRM_CLEAN_PACKAGE_CLOUDFLARE=${confirmToken}`);
}

const source = readFileSync(packagePath, 'utf8');
const pkg = JSON.parse(source);

const existingScripts = scriptsToRemove.filter((name) => Object.hasOwn(pkg.scripts || {}, name));
const existingDependencies = dependenciesToRemove.filter((name) => Object.hasOwn(pkg.dependencies || {}, name));
const existingDevDependencies = devDependenciesToRemove.filter((name) => Object.hasOwn(pkg.devDependencies || {}, name));

if (apply) {
  for (const name of existingScripts) {
    delete pkg.scripts[name];
  }
  for (const name of existingDependencies) {
    delete pkg.dependencies[name];
  }
  for (const name of existingDevDependencies) {
    delete pkg.devDependencies[name];
  }
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

console.log(JSON.stringify({
  ok: true,
  mode: apply ? 'apply' : 'dry-run',
  changed: apply,
  removed: {
    scripts: existingScripts,
    dependencies: existingDependencies,
    devDependencies: existingDevDependencies,
  },
  remainingManualSteps: [
    'apply 后需要运行 npm install 更新 package-lock.json',
    'apply 后需要复跑 npm run typecheck',
    'apply 后需要复跑 node scripts/audit-legacy-cloudflare-residuals.mjs',
  ],
}, null, 2));
