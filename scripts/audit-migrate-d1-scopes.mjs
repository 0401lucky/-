import { readFileSync } from 'node:fs';

const migrateMainPath = 'backend/cmd/migrate-d1/main.go';
const readmePath = 'backend/README.md';

const expectedOrder = [
  'public-lists',
  'users-points',
  'points-history',
  'store-data',
  'user-assets',
  'user-profiles',
  'user-achievements',
  'notifications',
  'reward-claims',
  'raffle-entries',
  'eco-state',
  'eco-global',
  'farm-v2',
  'cards',
  'feedback',
];

const migrateMain = readFileSync(migrateMainPath, 'utf8');
const readme = readFileSync(readmePath, 'utf8');

const switchScopes = [...migrateMain.matchAll(/case\s+"([^"]+)":/g)]
  .map((match) => match[1])
  .filter((scope, index, list) => list.indexOf(scope) === index);

const validationScopes = [...migrateMain.matchAll(/\*scope\s*!=\s*"([^"]+)"/g)]
  .map((match) => match[1]);

const helpScopeLine = (migrateMain.match(/当前支持 ([^"]+)"/) || [])[1] || '';
const helpScopes = helpScopeLine
  .split('、')
  .map((scope) => scope.trim())
  .filter(Boolean);

function sameList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function missingReadmeEntries(scope) {
  const missing = [];
  if (!readme.includes(`-scope ${scope}`)) {
    missing.push(`缺少 -scope ${scope} 命令示例`);
  }
  if (!readme.includes(`- \`${scope}\``)) {
    missing.push(`缺少 ${scope} 说明条目`);
  }
  return missing;
}

const failures = [];

if (!sameList(switchScopes, expectedOrder)) {
  failures.push({
    check: 'switch cases',
    expected: expectedOrder,
    actual: switchScopes,
  });
}

if (!sameList(validationScopes, expectedOrder)) {
  failures.push({
    check: 'validation list',
    expected: expectedOrder,
    actual: validationScopes,
  });
}

if (!sameList(helpScopes, expectedOrder)) {
  failures.push({
    check: 'flag help list',
    expected: expectedOrder,
    actual: helpScopes,
  });
}

const readmeFailures = expectedOrder
  .map((scope) => ({ scope, missing: missingReadmeEntries(scope) }))
  .filter((entry) => entry.missing.length > 0);
if (readmeFailures.length > 0) {
  failures.push({
    check: 'backend README coverage',
    missing: readmeFailures,
  });
}

if (failures.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'migrate-d1-scope-audit',
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'migrate-d1-scope-audit',
  scopes: expectedOrder,
  checkedFiles: [
    migrateMainPath,
    readmePath,
  ],
}, null, 2));
