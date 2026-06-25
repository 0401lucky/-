import { existsSync, readFileSync } from 'node:fs';

const planPath = process.env.ZEABUR_SINGLE_PLAN || 'deploy/zeabur-single-service.example.json';
const envExamplePath = process.env.ZEABUR_ENV_EXAMPLE || 'deploy/zeabur.env.example';

function readJson(file) {
  if (!existsSync(file)) {
    throw new Error(`service plan file not found: ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseEnvKeys(content) {
  const keys = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index > 0) {
      keys.add(line.slice(0, index).trim());
    }
  }
  return keys;
}

let plan;
try {
  plan = readJson(planPath);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-single-plan-audit',
    planPath,
    error: error.message,
  }, null, 2));
  process.exit(1);
}

const envKeys = existsSync(envExamplePath)
  ? parseEnvKeys(readFileSync(envExamplePath, 'utf8'))
  : new Set();

const requiredServiceKeys = ['app', 'postgres', 'redis'];
const requiredEnvironment = [
  'WEB_PORT',
  'API_PORT',
  'GATEWAY_PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'NEXT_PUBLIC_BASE_URL',
  'SESSION_SECRET',
  'ADMIN_USERNAMES',
  'INTERNAL_API_SECRET',
  'RAFFLE_DELIVERY_CRON_SECRET',
  'CRON_SECRET',
  'NEW_API_URL',
  'NEW_API_ADMIN_ACCESS_TOKEN',
  'NEW_API_ADMIN_USER_ID',
  'R2_PUBLIC_URL',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET_FEEDBACK_IMAGES',
  'S3_BUCKET_CARD_IMAGES',
  'FEEDBACK_MEDIA_DIR',
  'FEEDBACK_MEDIA_PUBLIC_URL',
];

const missing = [];
if (plan.version !== 1) {
  missing.push('version must be 1');
}
if (plan.publicEntry !== 'app') {
  missing.push('publicEntry must be app');
}
for (const service of requiredServiceKeys) {
  if (!plan.services?.[service]) {
    missing.push(`services.${service}`);
  }
}
if (plan.services?.app?.dockerfile !== 'Dockerfile') {
  missing.push('services.app.dockerfile must be Dockerfile');
}
if (plan.services?.app?.context !== '.') {
  missing.push('services.app.context must be .');
}
if (plan.services?.app?.port !== 8080) {
  missing.push('services.app.port must be 8080');
}
if (plan.services?.app?.public !== true) {
  missing.push('services.app.public must be true');
}
for (const key of ['postgres', 'redis']) {
  if (plan.services?.[key]?.public !== false) {
    missing.push(`services.${key}.public must be false`);
  }
}
if (!Array.isArray(plan.services?.app?.dependsOn) || !plan.services.app.dependsOn.includes('postgres') || !plan.services.app.dependsOn.includes('redis')) {
  missing.push('services.app.dependsOn must include postgres and redis');
}

for (const key of requiredEnvironment) {
  if (!plan.services?.app?.environment?.includes(key)) {
    missing.push(`services.app.environment.${key}`);
  }
  if (!envKeys.has(key)) {
    missing.push(`deploy/zeabur.env.example.${key}`);
  }
}

if (!Array.isArray(plan.postDeployChecks) || !plan.postDeployChecks.includes('GET /healthz') || !plan.postDeployChecks.includes('GET /readyz')) {
  missing.push('postDeployChecks must include /healthz and /readyz');
}

if (missing.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-single-plan-audit',
    planPath,
    envExamplePath,
    missing,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-single-plan-audit',
  planPath,
  envExamplePath,
  checkedEnvironmentKeys: requiredEnvironment.length,
}, null, 2));
