import { readFileSync } from 'node:fs';

const envPath = process.env.ZEABUR_ENV_EXAMPLE || 'deploy/zeabur.env.example';

const requiredGroups = {
  singleContainer: [
    'GATEWAY_PORT',
    'WEB_PORT',
    'API_PORT',
  ],
  web: [
    'NODE_ENV',
    'NEXT_PUBLIC_BASE_URL',
  ],
  sharedAuth: [
    'SESSION_SECRET',
    'ADMIN_USERNAMES',
  ],
  goRuntime: [
    'APP_MODE',
    'DATABASE_URL',
    'REDIS_URL',
    'INTERNAL_API_SECRET',
  ],
  newAPI: [
    'NEW_API_URL',
    'NEW_API_ADMIN_ACCESS_TOKEN',
    'NEW_API_ADMIN_USER_ID',
    'NEW_API_ADMIN_USERNAME',
    'NEW_API_ADMIN_PASSWORD',
  ],
  workerCron: [
    'RAFFLE_DELIVERY_CRON_SECRET',
    'CRON_SECRET',
  ],
  objectStorage: [
    'R2_PUBLIC_URL',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET_FEEDBACK_IMAGES',
    'S3_BUCKET_CARD_IMAGES',
  ],
  feedbackMedia: [
    'FEEDBACK_MEDIA_DIR',
    'FEEDBACK_MEDIA_PUBLIC_URL',
  ],
};

const secretKeys = new Set([
  'SESSION_SECRET',
  'INTERNAL_API_SECRET',
  'NEW_API_ADMIN_ACCESS_TOKEN',
  'NEW_API_ADMIN_PASSWORD',
  'RAFFLE_DELIVERY_CRON_SECRET',
  'CRON_SECRET',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);

const optionalBlankKeys = new Set([
  'FEEDBACK_MEDIA_PUBLIC_URL',
]);

function parseEnv(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    values[key] = value;
  }
  return values;
}

function isPlaceholder(value) {
  return value.includes('replace-with-') || value.includes('your-') || value.startsWith('${');
}

const content = readFileSync(envPath, 'utf8');
const values = parseEnv(content);
const missing = [];
const blank = [];
const secretWithoutPlaceholder = [];

for (const [group, keys] of Object.entries(requiredGroups)) {
  for (const key of keys) {
    if (!(key in values)) {
      missing.push(`${group}.${key}`);
      continue;
    }
    if (values[key] === '' && !optionalBlankKeys.has(key)) {
      blank.push(`${group}.${key}`);
    }
    if (secretKeys.has(key) && !isPlaceholder(values[key])) {
      secretWithoutPlaceholder.push(`${group}.${key}`);
    }
  }
}

if (missing.length > 0 || blank.length > 0 || secretWithoutPlaceholder.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    envPath,
    missing,
    blank,
    secretWithoutPlaceholder,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-env-example-audit',
  envPath,
  groups: Object.fromEntries(
    Object.entries(requiredGroups).map(([group, keys]) => [group, keys.length]),
  ),
  checkedKeys: Object.values(requiredGroups).flat().length,
}, null, 2));
