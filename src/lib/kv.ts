import { kv } from "@/lib/d1-kv";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getTodayDateString, getSecondsUntilMidnight } from "./time";
import { withUserEconomyLock } from "./economy-lock";
import { createDefaultUserCards, normalizeUserCards, type UserCards } from "./cards/draw";
import {
  getNativeExtraSpinCount,
  getNativeUserCards,
  grantNativeCheckinRewards,
  hasNativeCheckedIn,
  hasNativeHotStoreBinding,
  incrementNativeExtraSpinCount,
  isNativeHotStoreReady,
  listNativeUsers,
  setNativeUserCards,
  upsertNativeUser,
} from "./hot-d1";

const KV_TIMEOUT_PATTERNS = ["timeout", "timed out", "deadline exceeded", "etimedout", "econnaborted"];
const KV_NETWORK_PATTERNS = [
  "network",
  "econnreset",
  "econnrefused",
  "enotfound",
  "socket hang up",
  "fetch failed",
  "connect",
];
const KV_SCHEMA_PATTERNS = [
  "no such table",
  "no such column",
  "duplicate column name",
  "database schema has changed",
];
const KV_DB_LOCK_PATTERNS = [
  "database is locked",
  "database is busy",
  "sql_busy",
  "sqlite_busy",
];

export const KV_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

export type KvAvailabilityReason = "ok" | "missing_binding";

export interface KvAvailabilityStatus {
  available: boolean;
  reason: KvAvailabilityReason;
  provider: "d1" | "vercel" | null;
  missingEnvKeys: string[];
}

export type KvErrorCode =
  | "KV_BINDING_MISSING"
  | "KV_TIMEOUT"
  | "KV_NETWORK"
  | "KV_D1_ERROR"
  | "KV_UNKNOWN"
  | "NON_KV_ERROR";

export interface KvErrorInsight {
  isKvError: boolean;
  isUnavailable: boolean;
  retryable: boolean;
  code: KvErrorCode;
  status: number | null;
  message: string;
}

function hasD1Binding(): boolean {
  try {
    const context = getCloudflareContext() as { env?: { KV_DB?: unknown } } | undefined;
    return !!context?.env?.KV_DB;
  } catch {
    return false;
  }
}

function hasVercelKvEnv(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
}

function includesAnyPattern(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = (error as { status?: unknown; response?: { status?: unknown } }).status
    ?? (error as { response?: { status?: unknown } }).response?.status;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string") {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "unknown kv error";
}

export function getKvAvailabilityStatus(): KvAvailabilityStatus {
  if (hasD1Binding()) {
    return {
      available: true,
      reason: "ok",
      provider: "d1",
      missingEnvKeys: [],
    };
  }

  if (hasVercelKvEnv()) {
    return {
      available: true,
      reason: "ok",
      provider: "vercel",
      missingEnvKeys: [],
    };
  }

  return {
    available: false,
    reason: "missing_binding",
    provider: null,
    missingEnvKeys: ["KV_DB (D1 binding)", "KV_REST_API_URL", "KV_REST_API_TOKEN"],
  };
}

export function isKvAvailable(): boolean {
  return getKvAvailabilityStatus().available;
}

export function getKvErrorInsight(error: unknown): KvErrorInsight {
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();
  const status = getErrorStatus(error);
  const name = error && typeof error === "object" && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  const normalizedMeta = `${name} ${code}`.toLowerCase();
  const fingerprint = `${normalizedMessage} ${normalizedMeta}`;

  const hasD1Fingerprint =
    fingerprint.includes("d1")
    || fingerprint.includes("kv_db")
    || fingerprint.includes("d1 binding")
    || fingerprint.includes("sqlite");

  const hasVercelFingerprint =
    fingerprint.includes("@vercel/kv")
    || fingerprint.includes("kv_rest_api_url")
    || fingerprint.includes("upstash")
    || fingerprint.includes("redis");

  const hasKvFingerprint = hasD1Fingerprint || hasVercelFingerprint;

  if (fingerprint.includes("d1 binding") || fingerprint.includes("kv_db not available")) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: false,
      code: "KV_BINDING_MISSING",
      status,
      message,
    };
  }

  if (fingerprint.includes("@vercel/kv: missing required environment variables")
    || fingerprint.includes("missing required environment variables kv_rest_api_url")) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: false,
      code: "KV_BINDING_MISSING",
      status,
      message,
    };
  }

  if (status === 408 || status === 504 || includesAnyPattern(fingerprint, KV_TIMEOUT_PATTERNS)) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: true,
      code: "KV_TIMEOUT",
      status,
      message,
    };
  }

  if (includesAnyPattern(fingerprint, KV_NETWORK_PATTERNS)) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: true,
      code: "KV_NETWORK",
      status,
      message,
    };
  }

  if (includesAnyPattern(fingerprint, KV_SCHEMA_PATTERNS)) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: false,
      code: "KV_D1_ERROR",
      status,
      message,
    };
  }

  if (includesAnyPattern(fingerprint, KV_DB_LOCK_PATTERNS)) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: true,
      code: "KV_D1_ERROR",
      status,
      message,
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: true,
      code: "KV_D1_ERROR",
      status,
      message,
    };
  }

  if (hasKvFingerprint) {
    return {
      isKvError: true,
      isUnavailable: true,
      retryable: true,
      code: "KV_UNKNOWN",
      status,
      message,
    };
  }

  return {
    isKvError: false,
    isUnavailable: false,
    retryable: false,
    code: "NON_KV_ERROR",
    status,
    message,
  };
}

export function isKvUnavailableError(error: unknown): boolean {
  return getKvErrorInsight(error).isUnavailable;
}

export function buildKvUnavailablePayload(message: string): {
  success: false;
  code: "KV_UNAVAILABLE";
  message: string;
  retryAfter: number;
} {
  return {
    success: false,
    code: "KV_UNAVAILABLE",
    message,
    retryAfter: KV_UNAVAILABLE_RETRY_AFTER_SECONDS,
  };
}

// 项目接口
export interface Project {
  id: string;
  name: string;
  description: string;
  maxClaims: number;
  claimedCount: number;
  codesCount: number;
  status: "active" | "paused" | "exhausted";
  createdAt: number;
  createdBy: string;
  /**
   * 项目奖励类型：
   * - code: 发放兑换码（默认）
   * - direct: 直充到 new-api 账户额度
   */
  rewardType?: "code" | "direct";
  /** rewardType=direct 时每人直充金额（美元） */
  directDollars?: number;
  newUserOnly?: boolean;  // 仅限新人资格用户（独立资格，不受抽奖影响）
  pinned?: boolean; // 置顶项目
  pinnedAt?: number; // 置顶时间（用于排序）
}

// 用户接口
export interface User {
  id: number;
  username: string;
  firstSeen: number;
}

// 领取记录
export interface ClaimRecord {
  id: string;
  projectId: string;
  userId: number;
  username: string;
  code: string;
  claimedAt: number;
  /** 是否直充项目 */
  directCredit?: boolean;
  /** 直充金额（美元） */
  creditedDollars?: number;
  /** 直充状态：pending=处理中，success=成功，uncertain=不确定 */
  creditStatus?: "pending" | "success" | "uncertain";
  /** 直充结果描述（用于审计/展示） */
  creditMessage?: string;
  /** 直充确认时间（毫秒时间戳） */
  creditedAt?: number;
}

const NEW_USER_BENEFIT_KEY = (userId: number) => `user:newbie:benefit:${userId}`;
const NEW_USER_PENDING_PREFIX = "pending:";
const NEW_USER_CLAIMED_PREFIX = "claimed:";
const NEW_USER_PENDING_TTL_SECONDS = 5 * 60;

export interface NewUserEligibility {
  eligible: boolean;
  status: "eligible" | "pending" | "claimed";
  projectId?: string;
  claimedAt?: number;
}

interface NewUserReserveResult {
  success: boolean;
  status: "reserved" | "pending" | "claimed";
  message: string;
}

function parseNewUserEligibilityMarker(raw: string | null | undefined): NewUserEligibility {
  if (!raw) {
    return { eligible: true, status: "eligible" };
  }

  if (raw.startsWith(NEW_USER_PENDING_PREFIX)) {
    return {
      eligible: false,
      status: "pending",
      projectId: raw.slice(NEW_USER_PENDING_PREFIX.length) || undefined,
    };
  }

  if (raw.startsWith(NEW_USER_CLAIMED_PREFIX)) {
    const payload = raw.slice(NEW_USER_CLAIMED_PREFIX.length);
    const [projectId, claimedAtRaw] = payload.split(":");
    const claimedAt = Number.parseInt(claimedAtRaw ?? "", 10);

    return {
      eligible: false,
      status: "claimed",
      projectId: projectId || undefined,
      claimedAt: Number.isFinite(claimedAt) ? claimedAt : undefined,
    };
  }

  return {
    eligible: false,
    status: "claimed",
  };
}

// 项目操作
export async function createProject(project: Project): Promise<void> {
  await kv.set(`projects:${project.id}`, project);
  await kv.lpush("project:list", project.id);
}

export async function getProject(projectId: string): Promise<Project | null> {
  return await kv.get<Project>(`projects:${projectId}`);
}

export async function updateProject(projectId: string, updates: Partial<Project>): Promise<void> {
  const project = await getProject(projectId);
  if (project) {
    await kv.set(`projects:${projectId}`, { ...project, ...updates });
  }
}

export async function getAllProjects(): Promise<Project[]> {
  const projectIds = await kv.lrange<string>("project:list", 0, -1);
  if (projectIds.length === 0) return [];

  // [Perf] 使用 mget 批量获取，避免 N+1 查询
  const keys = projectIds.map(id => `projects:${id}`);
  const results = await kv.mget<Project>(...keys);

  return (results ?? []).filter((p): p is Project => p !== null);
}

export async function deleteProject(projectId: string): Promise<void> {
  await kv.del(`projects:${projectId}`);
  await kv.del(`codes:available:${projectId}`);
  await kv.lrem("project:list", 0, projectId);
}

// 兑换码操作
export async function addCodesToProject(projectId: string, codes: string[]): Promise<number> {
  if (codes.length === 0) return 0;

  const projectKey = `projects:${projectId}`;
  const codesKey = `codes:available:${projectId}`;

  // Push all codes to the list
  const newLength = await kv.lpush(codesKey, ...codes);

  // Update project codesCount
  const project = await kv.get<Project>(projectKey);
  if (project) {
    project.codesCount = (project.codesCount ?? 0) + codes.length;
    await kv.set(projectKey, project);
  }

  return newLength;
}

export async function getAvailableCodesCount(projectId: string): Promise<number> {
  return await kv.llen(`codes:available:${projectId}`);
}

export async function claimCode(projectId: string, userId: number, username: string): Promise<{ success: boolean; code?: string; message: string }> {
  const now = Date.now();
  const recordId = `claim_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const projectKey = `projects:${projectId}`;
  const codesKey = `codes:available:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;
  const recordsKey = `records:${projectId}`;
  const userClaimedKey = `claimed:user:${userId}`;

  // Check existing claim
  const existing = await kv.get<ClaimRecord>(claimKey);
  if (existing) {
    if (existing.code) {
      return { success: true, code: existing.code, message: '你已经领取过了' };
    }
    return { success: false, message: '领取记录异常，请联系管理员' };
  }

  // Check project
  const project = await kv.get<Project>(projectKey);
  if (!project) return { success: false, message: '项目不存在' };

  if (project.status === 'paused') return { success: false, message: '该项目已暂停领取' };

  const claimedCount = project.claimedCount ?? 0;
  const maxClaims = project.maxClaims ?? 0;

  if (project.status === 'exhausted' || (maxClaims > 0 && claimedCount >= maxClaims)) {
    return { success: false, message: '已达到领取上限' };
  }

  // Pop a code
  const code = await kv.rpop(codesKey);
  if (!code) {
    project.status = 'exhausted';
    await kv.set(projectKey, project);
    return { success: false, message: '兑换码已领完' };
  }

  // Update project
  project.claimedCount = claimedCount + 1;
  if (maxClaims > 0 && project.claimedCount >= maxClaims) {
    project.status = 'exhausted';
  }

  const record: ClaimRecord = {
    id: recordId,
    projectId,
    userId,
    username,
    code: String(code),
    claimedAt: now,
  };

  // Atomic writes
  await kv.set(claimKey, record);
  await kv.lpush(recordsKey, record);
  await kv.set(projectKey, project);
  await kv.sadd(userClaimedKey, projectId);

  return { success: true, code: String(code), message: '领取成功' };
}

/**
 * 直充项目：原子预占名额并创建 pending 领取记录
 */
export async function reserveDirectClaim(
  projectId: string,
  userId: number,
  username: string
): Promise<{ success: boolean; message: string; record?: ClaimRecord }> {
  const now = Date.now();
  const recordId = `claim_${now}_${Math.random().toString(36).slice(2, 8)}`;

  const projectKey = `projects:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;
  const recordsKey = `records:${projectId}`;
  const userClaimedKey = `claimed:user:${userId}`;

  // Check existing claim
  const existing = await kv.get<ClaimRecord>(claimKey);
  if (existing) {
    if (existing.creditStatus === 'pending') {
      return { success: true, message: '领取处理中，请稍后刷新', record: existing };
    }
    return { success: true, message: '你已经领取过了', record: existing };
  }

  // Check project
  const project = await kv.get<Project>(projectKey);
  if (!project) return { success: false, message: '项目不存在' };

  if (project.status === 'paused') return { success: false, message: '该项目已暂停领取' };

  const dollars = project.directDollars ?? 0;
  if (dollars <= 0) return { success: false, message: '项目直充金额配置异常，请联系管理员' };

  const claimedCount = project.claimedCount ?? 0;
  const maxClaims = project.maxClaims ?? 0;

  if (project.status === 'exhausted' || (maxClaims > 0 && claimedCount >= maxClaims)) {
    return { success: false, message: '已达到领取上限' };
  }

  // Update project
  project.claimedCount = claimedCount + 1;
  if (maxClaims > 0 && project.claimedCount >= maxClaims) {
    project.status = 'exhausted';
  }

  const record: ClaimRecord = {
    id: recordId,
    projectId,
    userId,
    username,
    code: '',
    claimedAt: now,
    directCredit: true,
    creditedDollars: dollars,
    creditStatus: 'pending',
  };

  // Atomic writes
  await kv.set(claimKey, record);
  await kv.lpush(recordsKey, record);
  await kv.set(projectKey, project);
  await kv.sadd(userClaimedKey, projectId);

  return { success: true, message: 'ok', record };
}

/**
 * 直充项目：更新领取记录状态并写入项目记录列表（幂等）
 */
export async function finalizeDirectClaim(
  projectId: string,
  userId: number,
  status: "success" | "uncertain",
  creditMessage: string
): Promise<{ success: boolean; message: string; record?: ClaimRecord }> {
  const now = Date.now();
  const claimKey = `claimed:${projectId}:${userId}`;
  const recordsKey = `records:${projectId}`;

  const record = await kv.get<ClaimRecord>(claimKey);
  if (!record) return { success: false, message: '领取记录不存在' };

  // Already finalized
  if (record.creditStatus === 'success' || record.creditStatus === 'uncertain') {
    return { success: true, message: 'ok', record };
  }

  record.creditStatus = status;
  record.creditMessage = creditMessage;
  record.creditedAt = now;

  await kv.set(claimKey, record);
  await kv.lpush(recordsKey, record);

  return { success: true, message: 'ok', record };
}

/**
 * 直充项目：直充失败时回滚名额占位（仅对 pending 生效）
 */
export async function rollbackDirectClaim(
  projectId: string,
  userId: number
): Promise<{ success: boolean; message: string }> {
  const projectKey = `projects:${projectId}`;
  const claimKey = `claimed:${projectId}:${userId}`;
  const userClaimedKey = `claimed:user:${userId}`;

  // Check existing claim
  const record = await kv.get<ClaimRecord>(claimKey);
  if (!record) return { success: true, message: 'ok' };

  // Only rollback pending status
  if (record.creditStatus && record.creditStatus !== 'pending') {
    return { success: true, message: 'ok' };
  }

  // Delete claim record and user index
  await kv.del(claimKey);
  await kv.srem(userClaimedKey, projectId);

  // Restore project counter
  const project = await kv.get<Project>(projectKey);
  if (project) {
    const claimedCount = project.claimedCount ?? 0;
    const maxClaims = project.maxClaims ?? 0;

    project.claimedCount = Math.max(0, claimedCount - 1);

    // Restore status if it was exhausted due to reaching max
    if (project.status === 'exhausted' && maxClaims > 0 && project.claimedCount < maxClaims) {
      project.status = 'active';
    }

    await kv.set(projectKey, project);
  }

  return { success: true, message: 'ok' };
}

export async function getClaimRecord(projectId: string, userId: number): Promise<ClaimRecord | null> {
  return await kv.get<ClaimRecord>(`claimed:${projectId}:${userId}`);
}

export async function getProjectRecords(projectId: string, start = 0, end = 49): Promise<ClaimRecord[]> {
  return await kv.lrange<ClaimRecord>(`records:${projectId}`, start, end);
}

// 检查用户是否领取过任何福利（包括兑换码和抽奖）
// [Fix] 对 claimed:user 索引做自愈，避免历史脏索引导致误判
export async function hasUserClaimedAny(userId: number): Promise<boolean> {
  const userClaimedKey = `claimed:user:${userId}`;

  // 快速检查索引集合是否为空
  const claimCount = await kv.scard(userClaimedKey);
  if (claimCount > 0) {
    // 二次校验索引对应的领取记录，规避历史脏数据
    const claimedProjectIds = await kv.smembers(userClaimedKey) as string[];
    if (claimedProjectIds.length > 0) {
      const claimKeys = claimedProjectIds.map((projectId) => `claimed:${projectId}:${userId}`);
      const records = await kv.mget<ClaimRecord>(...claimKeys);

      const staleProjectIds = claimedProjectIds.filter((_, index) => records?.[index] == null);
      if (staleProjectIds.length > 0) {
        await kv.srem(userClaimedKey, ...staleProjectIds as [string, ...string[]]);
      }

      const hasValidClaim = (records ?? []).some((record) => record !== null);
      if (hasValidClaim) return true;
    }
  }

  // 检查抽奖记录
  const lotteryRecords = await kv.lrange(`lottery:user:records:${userId}`, 0, 0);
  if (lotteryRecords && lotteryRecords.length > 0) return true;

  return false;
}

export async function getNewUserEligibility(userId: number): Promise<NewUserEligibility> {
  const marker = await kv.get<string>(NEW_USER_BENEFIT_KEY(userId));
  return parseNewUserEligibilityMarker(marker ?? null);
}

export async function getNewUserEligibilityMap(
  userIds: number[]
): Promise<Record<number, boolean>> {
  if (userIds.length === 0) return {};

  const keys = userIds.map((userId) => NEW_USER_BENEFIT_KEY(userId));
  const markers = await kv.mget<string>(...keys);

  const result: Record<number, boolean> = {};
  userIds.forEach((userId, index) => {
    const raw = markers?.[index] ?? null;
    const marker = typeof raw === 'string' ? raw : null;
    const eligibility = parseNewUserEligibilityMarker(marker);
    result[userId] = eligibility.eligible;
  });

  return result;
}

export async function reserveNewUserBenefit(
  userId: number,
  projectId: string
): Promise<NewUserReserveResult> {
  const markerKey = NEW_USER_BENEFIT_KEY(userId);

  const marker = await kv.get<string>(markerKey);

  if (!marker) {
    // No marker exists — reserve it
    const setResult = await kv.set(
      markerKey,
      `${NEW_USER_PENDING_PREFIX}${projectId}`,
      { ex: NEW_USER_PENDING_TTL_SECONDS, nx: true }
    );

    if (setResult === "OK") {
      return { success: true, status: "reserved", message: "ok" };
    }

    // Race condition: another request set it first
    return { success: false, status: "pending", message: "新人资格校验处理中，请稍后重试" };
  }

  if (typeof marker === "string" && marker.startsWith(NEW_USER_CLAIMED_PREFIX)) {
    return { success: false, status: "claimed", message: "该福利仅限新用户领取" };
  }

  if (typeof marker === "string" && marker.startsWith(NEW_USER_PENDING_PREFIX)) {
    return { success: false, status: "pending", message: "新人资格校验处理中，请稍后重试" };
  }

  return { success: false, status: "pending", message: "新人资格校验处理中，请稍后重试" };
}

export async function confirmNewUserBenefit(
  userId: number,
  projectId: string
): Promise<void> {
  const markerKey = NEW_USER_BENEFIT_KEY(userId);
  const now = Date.now();

  const marker = await kv.get<string>(markerKey);
  if (typeof marker === "string" && marker.startsWith(NEW_USER_CLAIMED_PREFIX)) {
    return; // Already claimed
  }

  await kv.set(markerKey, `${NEW_USER_CLAIMED_PREFIX}${projectId}:${now}`);
}

export async function rollbackNewUserBenefit(
  userId: number,
  projectId: string
): Promise<void> {
  const markerKey = NEW_USER_BENEFIT_KEY(userId);

  const marker = await kv.get<string>(markerKey);
  if (!marker) return;

  if (typeof marker === "string" && marker.startsWith(NEW_USER_PENDING_PREFIX)) {
    const pendingProject = marker.slice(NEW_USER_PENDING_PREFIX.length);
    if (pendingProject === projectId) {
      await kv.del(markerKey);
    }
  }
}

export interface NewUserEligibilityMigrationResult {
  dryRun: boolean;
  scopedProjects: number;
  scannedRecords: number;
  candidateUsers: number;
  migratedUsers: number;
  skippedClaimedUsers: number;
  skippedPendingUsers: number;
}

export interface NewUserEligibilityMigrationOptions {
  dryRun?: boolean;
  chunkSize?: number;
}

export async function migrateNewUserEligibilityFromHistory(
  options: NewUserEligibilityMigrationOptions = {}
): Promise<NewUserEligibilityMigrationResult> {
  const dryRun = options.dryRun ?? false;
  const chunkSize = Math.max(100, Math.min(1000, Math.floor(options.chunkSize ?? 500)));

  const projects = await getAllProjects();
  const scopedProjects = projects.filter((project) => project.newUserOnly);

  const userFirstClaim = new Map<number, { projectId: string; claimedAt: number }>();
  let scannedRecords = 0;

  for (const project of scopedProjects) {
    for (let offset = 0; ; offset += chunkSize) {
      const records = await getProjectRecords(project.id, offset, offset + chunkSize - 1);
      if (!records || records.length === 0) {
        break;
      }

      scannedRecords += records.length;

      records.forEach((record) => {
        const userId = Number(record.userId);
        if (!Number.isFinite(userId) || userId <= 0) {
          return;
        }

        const claimedAt = Number.isFinite(record.claimedAt)
          ? record.claimedAt
          : Date.now();

        const existing = userFirstClaim.get(userId);
        if (!existing || claimedAt < existing.claimedAt) {
          userFirstClaim.set(userId, {
            projectId: project.id,
            claimedAt,
          });
        }
      });

      if (records.length < chunkSize) {
        break;
      }
    }
  }

  const candidateUsers = Array.from(userFirstClaim.keys());
  if (candidateUsers.length === 0) {
    return {
      dryRun,
      scopedProjects: scopedProjects.length,
      scannedRecords,
      candidateUsers: 0,
      migratedUsers: 0,
      skippedClaimedUsers: 0,
      skippedPendingUsers: 0,
    };
  }

  const markerKeys = candidateUsers.map((userId) => NEW_USER_BENEFIT_KEY(userId));
  const markers = await kv.mget<string>(...markerKeys);

  let migratedUsers = 0;
  let skippedClaimedUsers = 0;
  let skippedPendingUsers = 0;

  for (let index = 0; index < candidateUsers.length; index += 1) {
    const userId = candidateUsers[index];
    const marker = markers?.[index] ?? null;

    if (typeof marker === "string" && marker.startsWith(NEW_USER_CLAIMED_PREFIX)) {
      skippedClaimedUsers += 1;
      continue;
    }

    if (typeof marker === "string" && marker.startsWith(NEW_USER_PENDING_PREFIX)) {
      skippedPendingUsers += 1;
      continue;
    }

    if (dryRun) {
      migratedUsers += 1;
      continue;
    }

    const firstClaim = userFirstClaim.get(userId);
    if (!firstClaim) {
      continue;
    }

    await kv.set(
      NEW_USER_BENEFIT_KEY(userId),
      `${NEW_USER_CLAIMED_PREFIX}${firstClaim.projectId}:${firstClaim.claimedAt}`
    );
    migratedUsers += 1;
  }

  return {
    dryRun,
    scopedProjects: scopedProjects.length,
    scannedRecords,
    candidateUsers: candidateUsers.length,
    migratedUsers,
    skippedClaimedUsers,
    skippedPendingUsers,
  };
}

// 记录用户（首次登录时调用）
export async function recordUser(userId: number, username: string): Promise<void> {
  const userKey = `user:${userId}`;
  const usersAllKey = 'users:all';
  const now = Date.now();

  if (hasNativeHotStoreBinding()) {
    await upsertNativeUser(userId, username, now);
  }

  const existing = await kv.get<User>(userKey);

  const user: User = existing
    ? {
        id: existing.id ?? userId,
        username,
        firstSeen: existing.firstSeen ?? now,
      }
    : {
        id: userId,
        username,
        firstSeen: now,
      };

  await kv.set(userKey, user);
  await kv.sadd(usersAllKey, userId);
}
// 获取所有用户
export async function getAllUsers(): Promise<User[]> {
  if (await isNativeHotStoreReady()) {
    const users = await listNativeUsers();
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      firstSeen: user.firstSeen,
    }));
  }

  const userIds = await kv.smembers('users:all') as number[];
  if (userIds.length === 0) return [];

  // [Perf] 使用 mget 批量获取，避免 N+1 查询
  const keys = userIds.map(id => `user:${id}`);
  const results = await kv.mget<User>(...keys);

  return (results ?? []).filter((u): u is User => u !== null);
}

// 获取用户的所有领取记录
export async function getUserAllClaims(userId: number): Promise<ClaimRecord[]> {
  const projects = await getAllProjects();
  if (projects.length === 0) return [];

  // [Perf] 使用 mget 批量获取，避免 N+1 查询
  const keys = projects.map(project => `claimed:${project.id}:${userId}`);
  const results = await kv.mget<ClaimRecord>(...keys);

  return (results ?? []).filter((r): r is ClaimRecord => r !== null);
}

// 获取用户的抽奖记录数
export async function getUserLotteryCount(userId: number): Promise<number> {
  return await kv.llen(`lottery:user:records:${userId}`);
}

const LOTTERY_DAILY_PREFIX = "lottery:daily:";

// [C3修复] 原子性占用每日免费次数 - 使用 SET NX 防止并发
// 返回 true 表示成功占用（之前没用过），false 表示已被占用
export async function tryClaimDailyFree(userId: number): Promise<boolean> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  const ttl = getSecondsUntilMidnight();
  
  // SET key value NX EX ttl - 仅当key不存在时设置
  // D1 adapter returns "OK" for successful set, null when key already exists
  const result = await kv.set(key, "1", { nx: true, ex: ttl });
  return result === "OK";
}

// [C3修复] 释放每日免费次数（失败补偿用）
export async function releaseDailyFree(userId: number): Promise<void> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  await kv.del(key);
}

// 检查今日是否已抽（只读检查，不修改）
export async function checkDailyLimit(userId: number): Promise<boolean> {
  const today = getTodayDateString();
  const key = `${LOTTERY_DAILY_PREFIX}${userId}:${today}`;
  const result = await kv.get(key);
  return result !== null;
}

// 额外抽奖次数管理
export async function getExtraSpinCount(userId: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return getNativeExtraSpinCount(userId);
  }

  const count = await kv.get<number>(`user:extra_spins:${userId}`);
  return count || 0;
}

// [C3修复] 原子性增加额外次数
export async function addExtraSpinCount(userId: number, count: number): Promise<number> {
  if (await isNativeHotStoreReady()) {
    return incrementNativeExtraSpinCount(userId, count);
  }

  // 使用 INCRBY 原子增加
  const newCount = await kv.incrby(`user:extra_spins:${userId}`, count);
  return newCount;
}

// [C3修复] 原子性消耗额外次数 - 使用 DECR 并检查结果
// 返回 { success: boolean, remaining: number }
export async function tryUseExtraSpin(userId: number): Promise<{ success: boolean; remaining: number }> {
  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const currentCount = await getNativeExtraSpinCount(userId);
      if (currentCount <= 0) {
        return { success: false, remaining: 0 };
      }

      const remaining = await incrementNativeExtraSpinCount(userId, -1);
      return { success: true, remaining };
    }

    const key = `user:extra_spins:${userId}`;
    const current = await kv.get<number>(key);
    const currentCount = current ?? 0;

    if (currentCount <= 0) {
      return { success: false, remaining: Math.max(0, currentCount) };
    }

    const remaining = await kv.decrby(key, 1);
    if (remaining < 0) {
      await kv.incrby(key, 1);
      return { success: false, remaining: 0 };
    }

    return { success: true, remaining: Math.max(0, remaining) };
  });
}

// [C3修复] 回滚额外次数（失败补偿用）
export async function rollbackExtraSpin(userId: number): Promise<void> {
  if (await isNativeHotStoreReady()) {
    await incrementNativeExtraSpinCount(userId, 1);
    return;
  }

  await kv.incrby(`user:extra_spins:${userId}`, 1);
}

// 签到状态管理 - 使用中国时区
const CHECKIN_HISTORY_RETENTION_DAYS = 400;
const CHECKIN_HISTORY_RETENTION_SECONDS = CHECKIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60;

export async function hasCheckedInToday(userId: number): Promise<boolean> {
  const dateStr = getTodayDateString();
  if (await isNativeHotStoreReady()) {
    return hasNativeCheckedIn(userId, dateStr);
  }
  const result = await kv.get(`user:checkin:${userId}:${dateStr}`);
  return !!result;
}

export async function setCheckedInToday(userId: number): Promise<void> {
  const dateStr = getTodayDateString();
  const ttl = CHECKIN_HISTORY_RETENTION_SECONDS;
  if (await isNativeHotStoreReady()) {
    await grantNativeCheckinRewards(
      userId,
      dateStr,
      0,
      normalizeUserCards(await getNativeUserCards(userId)),
    );
    return;
  }
  await kv.set(`user:checkin:${userId}:${dateStr}`, true, { ex: ttl });
}

export async function grantCheckinLocalRewards(
  userId: number,
  { extraSpins = 1, cardDraws = 1 }: { extraSpins?: number; cardDraws?: number } = {}
): Promise<{
  granted: boolean;
  alreadyCheckedIn: boolean;
  extraSpins: number;
  drawsAvailable: number;
}> {
  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const previousCardDataRaw = await getNativeUserCards(userId);
      const nextCardData = previousCardDataRaw === null
        ? createDefaultUserCards(1 + cardDraws)
        : normalizeUserCards(previousCardDataRaw);

      if (previousCardDataRaw !== null) {
        nextCardData.drawsAvailable = Math.max(0, nextCardData.drawsAvailable + cardDraws);
      }

      const nativeResult = await grantNativeCheckinRewards(
        userId,
        getTodayDateString(),
        extraSpins,
        nextCardData,
      );

      return {
        granted: nativeResult.granted,
        alreadyCheckedIn: !nativeResult.granted,
        extraSpins: nativeResult.extraSpins,
        drawsAvailable: nativeResult.cards.drawsAvailable,
      };
    }

    const dateStr = getTodayDateString();
    const ttl = CHECKIN_HISTORY_RETENTION_SECONDS;
    const checkinKey = `user:checkin:${userId}:${dateStr}`;
    const extraSpinsKey = `user:extra_spins:${userId}`;
    const cardsKey = `cards:user:${userId}`;

    const setResult = await kv.set(checkinKey, '1', { nx: true, ex: ttl });
    if (setResult !== 'OK') {
      const currentSpins = await kv.get<number>(extraSpinsKey);
      const existingCardData = normalizeUserCards(await kv.get<Partial<UserCards>>(cardsKey));
      return {
        granted: false,
        alreadyCheckedIn: true,
        extraSpins: currentSpins ?? 0,
        drawsAvailable: existingCardData.drawsAvailable,
      };
    }

    const previousCardDataRaw = await kv.get<Partial<UserCards>>(cardsKey);
    const nextCardData = previousCardDataRaw === null
      ? createDefaultUserCards(1 + cardDraws)
      : normalizeUserCards(previousCardDataRaw);

    if (previousCardDataRaw !== null) {
      nextCardData.drawsAvailable = Math.max(0, nextCardData.drawsAvailable + cardDraws);
    }

    try {
      await kv.set(cardsKey, nextCardData);
      const newSpins = await kv.incrby(extraSpinsKey, extraSpins);

      return {
        granted: true,
        alreadyCheckedIn: false,
        extraSpins: newSpins,
        drawsAvailable: nextCardData.drawsAvailable,
      };
    } catch (error) {
      try {
        if (previousCardDataRaw === null) {
          await kv.del(cardsKey);
        } else {
          await kv.set(cardsKey, normalizeUserCards(previousCardDataRaw));
        }
        await kv.del(checkinKey);
      } catch (rollbackError) {
        console.error('回滚签到本地奖励失败:', rollbackError);
      }
      throw error;
    }
  });
}

/**
 * 增加用户卡牌抽奖次数（用于商店兑换）
 */
export async function addCardDraws(
  userId: number,
  amount: number
): Promise<{ success: boolean; drawsAvailable: number }> {
  return withUserEconomyLock(userId, async () => {
    if (await isNativeHotStoreReady()) {
      const cardData = await getNativeUserCards(userId);

      const nextCardData = cardData === null
        ? createDefaultUserCards(Math.max(0, 1 + amount))
        : normalizeUserCards(cardData);

      if (cardData !== null) {
        nextCardData.drawsAvailable = Math.max(0, nextCardData.drawsAvailable + amount);
      }

      await setNativeUserCards(userId, nextCardData);
      return { success: true, drawsAvailable: nextCardData.drawsAvailable };
    }

    const cardsKey = `cards:user:${userId}`;
    const cardData = await kv.get<Partial<UserCards>>(cardsKey);

    const nextCardData = cardData === null
      ? createDefaultUserCards(Math.max(0, 1 + amount))
      : normalizeUserCards(cardData);

    if (cardData !== null) {
      nextCardData.drawsAvailable = Math.max(0, nextCardData.drawsAvailable + amount);
    }

    await kv.set(cardsKey, nextCardData);
    return { success: true, drawsAvailable: nextCardData.drawsAvailable };
  });
}

