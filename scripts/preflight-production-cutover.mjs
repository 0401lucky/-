import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const requiredEnvFiles = [
  ['CUTOVER_EVIDENCE_FILE', process.env.CUTOVER_EVIDENCE_FILE],
  ['ZEABUR_ENV_FILE', process.env.ZEABUR_ENV_FILE],
];
const optionalEnvFiles = [
  ['D1_EXPORT_SQL', process.env.D1_EXPORT_SQL],
];

const requiredValues = [
  ['ZEABUR_RUNTIME_BASE_URL', process.env.ZEABUR_RUNTIME_BASE_URL],
];

function parseURL(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHost(hostname) {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i.test(hostname);
}

const missingInputs = [];
for (const [key, value] of requiredEnvFiles) {
  if (!value || String(value).trim() === '') {
    missingInputs.push(`${key} is required`);
  } else if (!existsSync(value)) {
    missingInputs.push(`${key} file does not exist: ${value}`);
  } else if (/\.example(?:\.|$)/.test(value)) {
    missingInputs.push(`${key} must point to a real non-example file: ${value}`);
  }
}
for (const [key, value] of optionalEnvFiles) {
  if (!value || String(value).trim() === '') {
    continue;
  }
  if (!existsSync(value)) {
    missingInputs.push(`${key} file does not exist: ${value}`);
  } else if (/\.example(?:\.|$)/.test(value)) {
    missingInputs.push(`${key} must point to a real non-example file: ${value}`);
  }
}
for (const [key, value] of requiredValues) {
  if (!value || String(value).trim() === '') {
    missingInputs.push(`${key} is required`);
  }
}

const runtimeURL = process.env.ZEABUR_RUNTIME_BASE_URL
  ? parseURL(process.env.ZEABUR_RUNTIME_BASE_URL)
  : null;
if (process.env.ZEABUR_RUNTIME_BASE_URL && !runtimeURL) {
  missingInputs.push(`ZEABUR_RUNTIME_BASE_URL must be a valid URL: ${process.env.ZEABUR_RUNTIME_BASE_URL}`);
}
if (runtimeURL && runtimeURL.protocol !== 'https:') {
  missingInputs.push(`ZEABUR_RUNTIME_BASE_URL must use https: ${process.env.ZEABUR_RUNTIME_BASE_URL}`);
}
if (runtimeURL && isLocalHost(runtimeURL.hostname)) {
  missingInputs.push(`ZEABUR_RUNTIME_BASE_URL must target Zeabur remote host, not localhost: ${process.env.ZEABUR_RUNTIME_BASE_URL}`);
}

if (missingInputs.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'production-cutover-preflight',
    reason: 'missing required production cutover inputs',
    missingInputs,
    requiredEnv: [
      'CUTOVER_EVIDENCE_FILE',
      'ZEABUR_ENV_FILE',
      'ZEABUR_RUNTIME_BASE_URL',
    ],
    optionalEnv: [
      'D1_EXPORT_SQL',
    ],
  }, null, 2));
  process.exit(1);
}

const steps = [
  ['deploy secret hygiene audit', 'node', ['scripts/audit-deploy-secret-hygiene.mjs'], {}, 60000],
  ['gateway upstreams audit', 'node', ['scripts/audit-gateway-upstreams.mjs'], {}, 60000],
  ['gateway guard', 'node', ['scripts/audit-gateway-cutover-guard.mjs'], {}, 60000],
  ['gateway allowed cutovers audit', 'node', ['scripts/audit-gateway-allowed-cutovers.mjs'], {}, 60000],
  ['production cutover evidence strict audit', 'node', ['scripts/audit-production-cutover-evidence.mjs'], {
    CUTOVER_EVIDENCE_FILE: process.env.CUTOVER_EVIDENCE_FILE,
    D1_EXPORT_SQL: process.env.D1_EXPORT_SQL || '',
    ZEABUR_ENV_FILE: process.env.ZEABUR_ENV_FILE,
    CUTOVER_EVIDENCE_STRICT: '1',
  }, 60000],
  ['production cutover readiness strict audit', 'node', ['scripts/audit-production-cutover-readiness.mjs'], {
    CUTOVER_EVIDENCE_FILE: process.env.CUTOVER_EVIDENCE_FILE,
    D1_EXPORT_SQL: process.env.D1_EXPORT_SQL || '',
    ZEABUR_ENV_FILE: process.env.ZEABUR_ENV_FILE,
    ZEABUR_RUNTIME_BASE_URL: process.env.ZEABUR_RUNTIME_BASE_URL,
    PRODUCTION_CUTOVER_READINESS_STRICT: '1',
  }, 180000],
];

function runStep(label, command, args, extraEnv, timeout) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
    },
    timeout,
    maxBuffer: 1024 * 1024 * 8,
  });
  const durationMs = Date.now() - startedAt;
  if (result.status !== 0) {
    console.error(JSON.stringify({
      ok: false,
      mode: 'production-cutover-preflight',
      failedStep: label,
      command: [command, ...args].join(' '),
      durationMs,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }, null, 2));
    process.exit(result.status || 1);
  }
  return {
    label,
    command: [command, ...args].join(' '),
    durationMs,
  };
}

const results = [];
for (const [label, command, args, extraEnv, timeout] of steps) {
  results.push(runStep(label, command, args, extraEnv, timeout));
}

console.log(JSON.stringify({
  ok: true,
  mode: 'production-cutover-preflight',
  steps: results,
  evidenceFile: process.env.CUTOVER_EVIDENCE_FILE,
  d1ExportFile: process.env.D1_EXPORT_SQL || null,
  deploymentMode: process.env.D1_EXPORT_SQL ? 'd1-import' : 'fresh-zeabur',
  envFile: process.env.ZEABUR_ENV_FILE,
  runtimeBaseURL: process.env.ZEABUR_RUNTIME_BASE_URL,
}, null, 2));
