import { existsSync, readFileSync } from 'node:fs';

const envFile = process.env.ZEABUR_ENV_FILE || '';
const allowLocal = process.env.ZEABUR_ENV_ALLOW_LOCAL === '1';
const envFileMissing = envFile !== '' && !existsSync(envFile);

const requiredGroups = {
  web: [
    'NODE_ENV',
    'PORT',
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
};

const secretMinLength = {
  SESSION_SECRET: 32,
  INTERNAL_API_SECRET: 24,
  NEW_API_ADMIN_ACCESS_TOKEN: 16,
  RAFFLE_DELIVERY_CRON_SECRET: 24,
  CRON_SECRET: 24,
  S3_ACCESS_KEY_ID: 8,
  S3_SECRET_ACCESS_KEY: 16,
};

function readEnvFile(filePath) {
  if (!filePath) {
    return {};
  }
  if (!existsSync(filePath)) {
    return {};
  }
  const values = {};
  const content = readFileSync(filePath, 'utf8');
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
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function hasPlaceholder(value) {
  return value.includes('replace-with-') ||
    value.includes('your-') ||
    value.startsWith('${') ||
    value.includes('example.com');
}

function isLocalValue(value) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|redis:6379|postgres:5432/i.test(value);
}

function isHTTPS(value) {
  return /^https:\/\//i.test(value);
}

const env = {
  ...readEnvFile(envFile),
  ...process.env,
};

const missing = [];
const blank = [];
const placeholders = [];
const weakSecrets = [];
const invalidValues = [];
const localOnlyValues = [];

for (const [group, keys] of Object.entries(requiredGroups)) {
  for (const key of keys) {
    const label = `${group}.${key}`;
    if (!(key in env)) {
      missing.push(label);
      continue;
    }
    const value = String(env[key] || '').trim();
    if (value === '') {
      blank.push(label);
      continue;
    }
    if (hasPlaceholder(value)) {
      placeholders.push(label);
    }
    if (!allowLocal && isLocalValue(value)) {
      localOnlyValues.push(label);
    }
    if (key in secretMinLength && value.length < secretMinLength[key]) {
      weakSecrets.push(`${label}:min${secretMinLength[key]}`);
    }
  }
}

for (const [key, valid] of Object.entries({
  NODE_ENV: String(env.NODE_ENV || '') === 'production',
  PORT: /^\d+$/.test(String(env.PORT || '')),
  APP_MODE: ['api', 'worker'].includes(String(env.APP_MODE || '')),
  NEXT_PUBLIC_BASE_URL: isHTTPS(String(env.NEXT_PUBLIC_BASE_URL || '')),
  NEW_API_URL: isHTTPS(String(env.NEW_API_URL || '')),
  R2_PUBLIC_URL: isHTTPS(String(env.R2_PUBLIC_URL || '')),
  S3_ENDPOINT: isHTTPS(String(env.S3_ENDPOINT || '')),
})) {
  if (!valid) {
    invalidValues.push(key);
  }
}

if (envFileMissing || missing.length > 0 || blank.length > 0 || placeholders.length > 0 || weakSecrets.length > 0 || invalidValues.length > 0 || localOnlyValues.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-runtime-env-audit',
    envFile: envFile || null,
    envFileMissing,
    allowLocal,
    missing,
    blank,
    placeholders,
    weakSecrets,
    invalidValues,
    localOnlyValues,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-runtime-env-audit',
  envFile: envFile || null,
  envFileMissing,
  allowLocal,
  checkedGroups: Object.keys(requiredGroups),
  checkedKeys: Object.values(requiredGroups).flat().length,
}, null, 2));
