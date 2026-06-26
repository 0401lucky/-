import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const defaultEvidenceFile = 'deploy/production-cutover-evidence.example.json';
const evidenceFile = process.env.CUTOVER_EVIDENCE_FILE || defaultEvidenceFile;
const strict = process.env.CUTOVER_EVIDENCE_STRICT === '1';
const templateMode = evidenceFile === defaultEvidenceFile;

const requiredModules = {
  auth: [
    'loginApiSmokePassed',
    'meApiSmokePassed',
    'logoutApiSmokePassed',
    'pageSmokePassed',
    'gatewayCutoverApproved',
  ],
  wallet: [
    'newApiConfigured',
    'authenticatedApiSmokePassed',
    'pageSmokePassed',
    'gatewayCutoverApproved',
  ],
  profile: [
    'authenticatedApiSmokePassed',
    'pageSmokePassed',
    'gatewayCutoverApproved',
  ],
  notifications: [
    'authenticatedApiSmokePassed',
    'pageSmokePassed',
    'gatewayCutoverApproved',
  ],
  farm: [
    'authenticatedApiSmokePassed',
    'pageSmokePassed',
    'gatewayCutoverApproved',
  ],
  cards: [
    'authenticatedApiSmokePassed',
    'adminAuthenticatedApiSmokePassed',
    'pageSmokePassed',
    'adminPageSmokePassed',
    'gatewayCutoverApproved',
  ],
};

const requiredImportScopes = {
  profile: ['user-profiles', 'user-achievements'],
  notifications: ['notifications', 'reward-claims'],
  farm: ['farm-v2'],
  cards: ['cards'],
};

function readJson(file) {
  if (!existsSync(file)) {
    throw new Error(`evidence file not found: ${file}`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

function isPlaceholder(value) {
  return typeof value === 'string' && value.startsWith('replace-with-');
}

function isBlank(value) {
  return typeof value !== 'string' || value.trim() === '';
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
  const looksSensitiveKey = /(cookie|token|secret|password|authorization)/.test(lowerKey);
  const looksSensitiveValue = /(eyJ[a-zA-Z0-9_-]{20,}|Bearer\s+|session=|cf_clearance=|sk-[a-zA-Z0-9])/i.test(value);

  if (looksSensitiveKey || looksSensitiveValue) {
    violations.push({
      path: path.join('.'),
      reason: '证据文件只允许记录复核状态和本地文件路径，不能写入 Cookie、Token、Secret 或 Authorization 值',
    });
  }
  return violations;
}

function requireBoolean(value, path, errors) {
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be boolean`);
  }
}

function requireArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be array`);
  }
}

function includesAll(actual, expected) {
  return expected.every((item) => actual.includes(item));
}

let evidence;
try {
  evidence = readJson(evidenceFile);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'production-cutover-evidence-audit',
    evidenceFile,
    error: error.message,
  }, null, 2));
  process.exit(1);
}

const schemaErrors = [];
if (evidence.version !== 1) {
  schemaErrors.push('version must be 1');
}
if (typeof evidence.generatedAt !== 'string') {
  schemaErrors.push('generatedAt must be string');
}
if (typeof evidence.reviewOwner !== 'string') {
  schemaErrors.push('reviewOwner must be string');
}
if (!evidence.database || typeof evidence.database !== 'object') {
  schemaErrors.push('database must be object');
} else {
  if (!['fresh-zeabur', 'd1-import'].includes(evidence.database.mode)) {
    schemaErrors.push('database.mode must be fresh-zeabur or d1-import');
  }
  requireBoolean(evidence.database.migrationsApplied, 'database.migrationsApplied', schemaErrors);
  requireBoolean(evidence.database.seedDataReviewed, 'database.seedDataReviewed', schemaErrors);
}
const deploymentMode = evidence.database?.mode === 'd1-import' ? 'd1-import' : 'fresh-zeabur';
if (evidence.d1Export && typeof evidence.d1Export === 'object') {
  requireBoolean(evidence.d1Export.dryRunReviewed, 'd1Export.dryRunReviewed', schemaErrors);
  requireArray(evidence.d1Export.importScopesApplied, 'd1Export.importScopesApplied', schemaErrors);
} else if (deploymentMode === 'd1-import') {
  schemaErrors.push('d1Export must be object when database.mode is d1-import');
}
if (!evidence.zeaburEnv || typeof evidence.zeaburEnv !== 'object') {
  schemaErrors.push('zeaburEnv must be object');
} else {
  requireBoolean(evidence.zeaburEnv.runtimeEnvAuditPassed, 'zeaburEnv.runtimeEnvAuditPassed', schemaErrors);
  requireBoolean(evidence.zeaburEnv.remoteRuntimeSmokePassed, 'zeaburEnv.remoteRuntimeSmokePassed', schemaErrors);
}
if (!evidence.modules || typeof evidence.modules !== 'object') {
  schemaErrors.push('modules must be object');
}

const moduleResults = [];
const approvalViolations = [];
for (const [moduleName, requiredFlags] of Object.entries(requiredModules)) {
  const moduleEvidence = evidence.modules?.[moduleName];
  const blockers = [];
  if (!moduleEvidence || typeof moduleEvidence !== 'object') {
    moduleResults.push({
      name: moduleName,
      ready: false,
      blockers: [`缺少 modules.${moduleName}`],
    });
    continue;
  }

  for (const flag of requiredFlags) {
    requireBoolean(moduleEvidence[flag], `modules.${moduleName}.${flag}`, schemaErrors);
    if (moduleEvidence[flag] !== true) {
      blockers.push(`modules.${moduleName}.${flag} 未通过`);
    }
  }

  const scopes = requiredImportScopes[moduleName] || [];
  if (deploymentMode === 'd1-import' && scopes.length > 0) {
    const declaredScopes = moduleEvidence.requiredImportScopes || [];
    requireArray(declaredScopes, `modules.${moduleName}.requiredImportScopes`, schemaErrors);
    if (Array.isArray(declaredScopes) && !includesAll(declaredScopes, scopes)) {
      blockers.push(`modules.${moduleName}.requiredImportScopes 缺少 ${scopes.filter((scope) => !declaredScopes.includes(scope)).join(', ')}`);
    }
    const appliedScopes = evidence.d1Export?.importScopesApplied || [];
    if (Array.isArray(appliedScopes) && !includesAll(appliedScopes, scopes)) {
      blockers.push(`d1Export.importScopesApplied 缺少 ${scopes.join(', ')}`);
    }
  }

  if (deploymentMode === 'd1-import' && evidence.d1Export?.dryRunReviewed !== true && moduleName !== 'wallet') {
    blockers.push('d1Export.dryRunReviewed 未通过');
  }
  if (evidence.database?.migrationsApplied !== true) {
    blockers.push('database.migrationsApplied 未通过');
  }
  if (evidence.database?.seedDataReviewed !== true) {
    blockers.push('database.seedDataReviewed 未通过');
  }
  if (evidence.zeaburEnv?.runtimeEnvAuditPassed !== true) {
    blockers.push('zeaburEnv.runtimeEnvAuditPassed 未通过');
  }
  if (evidence.zeaburEnv?.remoteRuntimeSmokePassed !== true) {
    blockers.push('zeaburEnv.remoteRuntimeSmokePassed 未通过');
  }

  if (moduleEvidence.gatewayCutoverApproved === true && blockers.length > 0) {
    approvalViolations.push({
      module: moduleName,
      blockers,
    });
  }

  moduleResults.push({
    name: moduleName,
    ready: blockers.length === 0,
    blockers,
  });
}

const sensitiveViolations = checkNoSensitiveValues(evidence);
const templateViolations = [];
const realEvidenceViolations = [];
const inputConsistencyViolations = [];
if (templateMode) {
  if (!isPlaceholder(evidence.generatedAt)) {
    templateViolations.push('example generatedAt must use replace-with-* placeholder');
  }
  if (!isPlaceholder(evidence.reviewOwner)) {
    templateViolations.push('example reviewOwner must use replace-with-* placeholder');
  }
  if (evidence.d1Export?.file && !isPlaceholder(evidence.d1Export.file)) {
    templateViolations.push('example d1Export.file must use replace-with-* placeholder when present');
  }
  if (!isPlaceholder(evidence.zeaburEnv?.envFile)) {
    templateViolations.push('example zeaburEnv.envFile must use replace-with-* placeholder');
  }
} else {
  if (isPlaceholder(evidence.generatedAt) || Number.isNaN(Date.parse(evidence.generatedAt))) {
    realEvidenceViolations.push('generatedAt must be a real parseable timestamp in non-template evidence');
  }
  if (isBlank(evidence.reviewOwner) || isPlaceholder(evidence.reviewOwner)) {
    realEvidenceViolations.push('reviewOwner must be a real reviewer identifier in non-template evidence');
  }
  if (deploymentMode === 'd1-import' && (isBlank(evidence.d1Export?.file) || isPlaceholder(evidence.d1Export?.file))) {
    realEvidenceViolations.push('d1Export.file must be a real local D1 export path in non-template evidence');
  } else if (deploymentMode === 'd1-import' && !existsSync(evidence.d1Export.file)) {
    realEvidenceViolations.push(`d1Export.file does not exist: ${evidence.d1Export.file}`);
  }
  if (isBlank(evidence.zeaburEnv?.envFile) || isPlaceholder(evidence.zeaburEnv?.envFile)) {
    realEvidenceViolations.push('zeaburEnv.envFile must be a real local Zeabur env path in non-template evidence');
  } else if (!existsSync(evidence.zeaburEnv.envFile)) {
    realEvidenceViolations.push(`zeaburEnv.envFile does not exist: ${evidence.zeaburEnv.envFile}`);
  }
  if (
    process.env.ZEABUR_ENV_FILE &&
    !isBlank(evidence.zeaburEnv?.envFile) &&
    !isPlaceholder(evidence.zeaburEnv?.envFile) &&
    resolve(process.env.ZEABUR_ENV_FILE) !== resolve(evidence.zeaburEnv.envFile)
  ) {
    inputConsistencyViolations.push('ZEABUR_ENV_FILE must match zeaburEnv.envFile in evidence');
  }
  if (
    process.env.D1_EXPORT_SQL &&
    !isBlank(evidence.d1Export?.file) &&
    !isPlaceholder(evidence.d1Export?.file) &&
    resolve(process.env.D1_EXPORT_SQL) !== resolve(evidence.d1Export.file)
  ) {
    inputConsistencyViolations.push('D1_EXPORT_SQL must match d1Export.file in evidence');
  }
}

if (
  schemaErrors.length > 0 ||
  sensitiveViolations.length > 0 ||
  templateViolations.length > 0 ||
  realEvidenceViolations.length > 0 ||
  inputConsistencyViolations.length > 0 ||
  approvalViolations.length > 0
) {
  console.error(JSON.stringify({
    ok: false,
    mode: 'production-cutover-evidence-audit',
    evidenceFile,
    templateMode,
    schemaErrors,
    sensitiveViolations,
    templateViolations,
    realEvidenceViolations,
    inputConsistencyViolations,
    approvalViolations,
  }, null, 2));
  process.exit(1);
}

const readyModules = moduleResults.filter((module) => module.ready).map((module) => module.name);
const blockedModules = moduleResults.filter((module) => !module.ready).map((module) => module.name);
const ready = blockedModules.length === 0;

if (strict && !ready) {
  console.error(JSON.stringify({
    ok: false,
    ready,
    mode: 'production-cutover-evidence-audit',
    evidenceFile,
    templateMode,
    readyModules,
    blockedModules,
    modules: moduleResults,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  ready,
  mode: 'production-cutover-evidence-audit',
  evidenceFile,
  templateMode,
  readyModules,
  blockedModules,
  modules: moduleResults,
  note: ready ? '生产切流证据已齐全' : 'ready=false 表示证据仍未齐全；默认非 strict 模式不会失败',
}, null, 2));
