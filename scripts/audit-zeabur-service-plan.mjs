import { existsSync, readFileSync } from 'node:fs';

const planPath = process.env.ZEABUR_SERVICE_PLAN || 'deploy/zeabur-services.example.json';
const envExamplePath = process.env.ZEABUR_ENV_EXAMPLE || 'deploy/zeabur.env.example';

const requiredServices = ['gateway', 'web', 'api', 'worker', 'postgres', 'redis'];
const requiredDockerServices = {
  gateway: { context: '.', dockerfile: 'Dockerfile.gateway', port: 8080 },
  web: { context: '.', dockerfile: 'Dockerfile.web', port: 3000 },
  api: { context: '.', dockerfile: 'Dockerfile.api', port: 8080 },
  worker: { context: '.', dockerfile: 'Dockerfile.worker' },
};
const requiredDependencies = [
  ['gateway', 'web'],
  ['gateway', 'api'],
  ['web', 'api'],
  ['api', 'postgres'],
  ['api', 'redis'],
  ['worker', 'postgres'],
  ['worker', 'redis'],
];
const expectedEnvironment = {
  gateway: ['PORT', 'API_UPSTREAM', 'WEB_UPSTREAM'],
  web: ['NODE_ENV', 'PORT', 'NEXT_PUBLIC_BASE_URL', 'SESSION_SECRET', 'ADMIN_USERNAMES'],
  api: [
    'APP_MODE',
    'PORT',
    'DATABASE_URL',
    'REDIS_URL',
    'SESSION_SECRET',
    'ADMIN_USERNAMES',
    'INTERNAL_API_SECRET',
    'NEW_API_URL',
    'NEW_API_ADMIN_ACCESS_TOKEN',
    'NEW_API_ADMIN_USER_ID',
    'R2_PUBLIC_URL',
    'S3_ENDPOINT',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET_FEEDBACK_IMAGES',
    'S3_BUCKET_CARD_IMAGES',
  ],
  worker: [
    'APP_MODE',
    'DATABASE_URL',
    'REDIS_URL',
    'SESSION_SECRET',
    'ADMIN_USERNAMES',
    'INTERNAL_API_SECRET',
    'RAFFLE_DELIVERY_CRON_SECRET',
    'CRON_SECRET',
  ],
};

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

function checkNoSensitiveValues(value, path = []) {
  const violations = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      violations.push(...checkNoSensitiveValues(entry, [...path, String(index)]));
    });
    return violations;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      violations.push(...checkNoSensitiveValues(entry, [...path, key]));
    }
    return violations;
  }
  if (typeof value !== 'string') {
    return violations;
  }

  const key = path[path.length - 1] || '';
  const lowerKey = key.toLowerCase();
  const looksSensitiveKey = /(cookie|token|secret|password|authorization|access_key)/.test(lowerKey);
  const looksSensitiveValue = /(Bearer\s+|session=|cf_clearance=|sk-[a-zA-Z0-9]|eyJ[a-zA-Z0-9_-]{20,})/i.test(value);
  if (looksSensitiveKey || looksSensitiveValue) {
    violations.push({
      path: path.join('.'),
      reason: 'Zeabur 服务计划只能记录变量名、服务拓扑和构建入口，不能写入真实密钥或凭据',
    });
  }
  return violations;
}

let plan;
try {
  plan = readJson(planPath);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-service-plan-audit',
    planPath,
    error: error.message,
  }, null, 2));
  process.exit(1);
}

const envKeys = existsSync(envExamplePath)
  ? parseEnvKeys(readFileSync(envExamplePath, 'utf8'))
  : new Set();
const missing = [];
const invalid = [];

if (plan.version !== 1) {
  invalid.push('version must be 1');
}
if (plan.publicEntry !== 'gateway') {
  invalid.push('publicEntry must be gateway');
}
if (!plan.services || typeof plan.services !== 'object') {
  invalid.push('services must be object');
}

for (const service of requiredServices) {
  if (!plan.services?.[service]) {
    missing.push(`services.${service}`);
  }
}

for (const [service, expected] of Object.entries(requiredDockerServices)) {
  const actual = plan.services?.[service];
  if (!actual) {
    continue;
  }
  if (actual.type !== 'docker') {
    invalid.push(`services.${service}.type must be docker`);
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      invalid.push(`services.${service}.${key} must be ${value}`);
    }
  }
}

if (plan.services?.postgres?.type !== 'managed-postgres') {
  invalid.push('services.postgres.type must be managed-postgres');
}
if (plan.services?.redis?.type !== 'managed-redis') {
  invalid.push('services.redis.type must be managed-redis');
}
if (plan.services?.gateway?.public !== true) {
  invalid.push('services.gateway.public must be true');
}
for (const service of ['web', 'api', 'worker', 'postgres', 'redis']) {
  if (plan.services?.[service]?.public !== false) {
    invalid.push(`services.${service}.public must be false`);
  }
}

for (const [service, dependency] of requiredDependencies) {
  const dependsOn = plan.services?.[service]?.dependsOn || [];
  if (!Array.isArray(dependsOn) || !dependsOn.includes(dependency)) {
    missing.push(`services.${service}.dependsOn.${dependency}`);
  }
}

for (const [service, keys] of Object.entries(expectedEnvironment)) {
  const environment = plan.services?.[service]?.environment || [];
  if (!Array.isArray(environment)) {
    invalid.push(`services.${service}.environment must be array`);
    continue;
  }
  for (const key of keys) {
    if (!environment.includes(key)) {
      missing.push(`services.${service}.environment.${key}`);
    }
    if (!envKeys.has(key)) {
      missing.push(`deploy/zeabur.env.example.${key}`);
    }
  }
}

const postDeployChecks = plan.postDeployChecks || [];
for (const check of ['GET /healthz', 'GET /readyz', 'node scripts/smoke-zeabur-runtime.mjs', 'node scripts/preflight-zeabur-go-api.mjs']) {
  if (!Array.isArray(postDeployChecks) || !postDeployChecks.includes(check)) {
    missing.push(`postDeployChecks.${check}`);
  }
}

const forbiddenPublicServices = plan.forbiddenPublicServices || [];
for (const service of ['web', 'api', 'worker', 'postgres', 'redis']) {
  if (!Array.isArray(forbiddenPublicServices) || !forbiddenPublicServices.includes(service)) {
    missing.push(`forbiddenPublicServices.${service}`);
  }
}

const sensitiveViolations = checkNoSensitiveValues(plan);

if (missing.length > 0 || invalid.length > 0 || sensitiveViolations.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'zeabur-service-plan-audit',
    planPath,
    envExamplePath,
    missing,
    invalid,
    sensitiveViolations,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'zeabur-service-plan-audit',
  planPath,
  envExamplePath,
  checkedServices: requiredServices.length,
  checkedDependencies: requiredDependencies.length,
  checkedEnvironmentKeys: Object.values(expectedEnvironment).reduce((count, keys) => count + keys.length, 0),
  publicEntry: plan.publicEntry,
}, null, 2));
