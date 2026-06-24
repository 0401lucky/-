import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDir = '.tmp/production-cutover-guards';
const exampleEvidencePath = 'deploy/production-cutover-evidence.example.json';
const evidenceDocPath = 'docs/production-cutover-evidence.md';
const preflightDocPath = 'docs/production-cutover-preflight.md';

const envKeys = [
  'CUTOVER_EVIDENCE_FILE',
  'CUTOVER_EVIDENCE_STRICT',
  'ZEABUR_ENV_FILE',
  'ZEABUR_RUNTIME_BASE_URL',
  'D1_EXPORT_SQL',
];

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of envKeys) {
    if (!(key in extra)) {
      delete env[key];
    }
  }
  return env;
}

function runNode(script, env = {}) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: cleanEnv(env),
    timeout: 60000,
    maxBuffer: 1024 * 1024 * 4,
  });
}

function outputOf(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function expectFailure(name, result, patterns) {
  const output = outputOf(result);
  const missingPatterns = patterns.filter((pattern) => !pattern.test(output));
  if (result.status === 0 || missingPatterns.length > 0) {
    throw new Error(JSON.stringify({
      name,
      expected: 'failure',
      status: result.status,
      missingPatterns: missingPatterns.map((pattern) => String(pattern)),
      output: output.trim(),
    }, null, 2));
  }
  return {
    name,
    status: result.status,
    matchedPatterns: patterns.map((pattern) => String(pattern)),
  };
}

function writeEvidence(file, mutate) {
  const evidence = JSON.parse(readFileSync(exampleEvidencePath, 'utf8'));
  evidence.generatedAt = new Date().toISOString();
  evidence.reviewOwner = 'local-production-cutover-guard-test';
  evidence.database.migrationsApplied = true;
  evidence.database.seedDataReviewed = true;
  evidence.zeaburEnv.envFile = evidenceDocPath;
  mutate(evidence);
  writeFileSync(file, JSON.stringify(evidence, null, 2));
}

mkdirSync(tempDir, { recursive: true });

try {
  const approvalViolationEvidence = join(tempDir, 'approval-violation.json');
  const envMismatchEvidence = join(tempDir, 'env-mismatch.json');
  const d1MismatchEvidence = join(tempDir, 'd1-mismatch.json');

  writeEvidence(approvalViolationEvidence, (evidence) => {
    evidence.modules.wallet.gatewayCutoverApproved = true;
  });
  writeEvidence(envMismatchEvidence, () => {});
  writeEvidence(d1MismatchEvidence, (evidence) => {
    evidence.database.mode = 'd1-import';
    evidence.d1Export = {
      file: evidenceDocPath,
      dryRunReviewed: true,
      importScopesApplied: [
        'user-profiles',
        'user-achievements',
        'notifications',
        'reward-claims',
        'farm-v2',
        'cards',
      ],
    };
    evidence.modules.profile.requiredImportScopes = ['user-profiles', 'user-achievements'];
    evidence.modules.notifications.requiredImportScopes = ['notifications', 'reward-claims'];
    evidence.modules.farm.requiredImportScopes = ['farm-v2'];
    evidence.modules.cards.requiredImportScopes = ['cards'];
  });

  const results = [
    expectFailure(
      'missing production cutover inputs',
      runNode('scripts/preflight-production-cutover.mjs'),
      [/CUTOVER_EVIDENCE_FILE is required/, /ZEABUR_ENV_FILE is required/, /ZEABUR_RUNTIME_BASE_URL is required/],
    ),
    expectFailure(
      'example production cutover inputs',
      runNode('scripts/preflight-production-cutover.mjs', {
        CUTOVER_EVIDENCE_FILE: exampleEvidencePath,
        ZEABUR_ENV_FILE: 'deploy/zeabur.env.example',
        ZEABUR_RUNTIME_BASE_URL: 'https://your-domain.example.com',
      }),
      [/CUTOVER_EVIDENCE_FILE must point to a real non-example file/, /ZEABUR_ENV_FILE must point to a real non-example file/],
    ),
    expectFailure(
      'optional example d1 export input',
      runNode('scripts/preflight-production-cutover.mjs', {
        CUTOVER_EVIDENCE_FILE: evidenceDocPath,
        D1_EXPORT_SQL: 'deploy/zeabur.env.example',
        ZEABUR_ENV_FILE: evidenceDocPath,
        ZEABUR_RUNTIME_BASE_URL: 'https://your-domain.example.com',
      }),
      [/D1_EXPORT_SQL must point to a real non-example file/],
    ),
    expectFailure(
      'local runtime url',
      runNode('scripts/preflight-production-cutover.mjs', {
        CUTOVER_EVIDENCE_FILE: evidenceDocPath,
        ZEABUR_ENV_FILE: evidenceDocPath,
        ZEABUR_RUNTIME_BASE_URL: 'http://127.0.0.1:8080',
      }),
      [/ZEABUR_RUNTIME_BASE_URL must use https/, /ZEABUR_RUNTIME_BASE_URL must target Zeabur remote host/],
    ),
    expectFailure(
      'gateway approval before blockers resolved',
      runNode('scripts/audit-production-cutover-evidence.mjs', {
        CUTOVER_EVIDENCE_FILE: approvalViolationEvidence,
      }),
      [/approvalViolations/, /wallet/],
    ),
    expectFailure(
      'zeabur env evidence mismatch',
      runNode('scripts/audit-production-cutover-evidence.mjs', {
        CUTOVER_EVIDENCE_FILE: envMismatchEvidence,
        ZEABUR_ENV_FILE: preflightDocPath,
      }),
      [/inputConsistencyViolations/, /ZEABUR_ENV_FILE must match/],
    ),
    expectFailure(
      'd1 export evidence mismatch',
      runNode('scripts/audit-production-cutover-evidence.mjs', {
        CUTOVER_EVIDENCE_FILE: d1MismatchEvidence,
        D1_EXPORT_SQL: preflightDocPath,
      }),
      [/inputConsistencyViolations/, /D1_EXPORT_SQL must match/],
    ),
    expectFailure(
      'd1 import evidence mismatch',
      runNode('scripts/audit-production-cutover-readiness.mjs', {
        CUTOVER_EVIDENCE_FILE: d1MismatchEvidence,
        D1_EXPORT_SQL: preflightDocPath,
      }),
      [/readiness audit prerequisites failed/, /D1_EXPORT_SQL must match/],
    ),
  ];

  console.log(JSON.stringify({
    ok: true,
    mode: 'production-cutover-guards-test',
    checkedFailureCases: results.length,
    cases: results,
  }, null, 2));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
