import { cookies } from "next/headers";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { kv } from "@vercel/kv";

function sanitizeEnvValue(value: string | undefined): string {
  if (!value) return "";

  return value
    .replace(/\\r\\n|\\n|\\r/g, "")
    .replace(/[\r\n]/g, "")
    .trim();
}

// [P0-1补充] ADMIN_USERNAMES 移除危险默认值
// 生产环境必须配置，否则默认为空（无管理员）
function getAdminUsernames(): string[] {
  const adminEnv = sanitizeEnvValue(process.env.ADMIN_USERNAMES);
  if (!adminEnv) {
    if (process.env.NODE_ENV === "production") {
      console.warn("⚠️ ADMIN_USERNAMES not set in production, no admin users configured!");
    }
    return [];
  }
  return adminEnv
    .split(",")
    .map((name) => sanitizeEnvValue(name))
    .filter((name) => name.length > 0);
}

const ADMIN_USERNAMES = getAdminUsernames();

const SESSION_BLACKLIST_KEY = (jti: string) => `auth:session:blacklist:${jti}`;
const SESSION_REVOKED_AFTER_KEY = (userId: number) => `auth:session:revoked-after:${userId}`;
const SESSION_BLACKLIST_GRACE_SECONDS = 60;
const SESSION_REVOKED_AFTER_TTL_SECONDS = 180 * 24 * 60 * 60;

const LOGIN_FAIL_KEY = (username: string) => `auth:login:fail:${username}`;
const LOGIN_LOCK_KEY = (username: string) => `auth:login:lock:${username}`;
const LOGIN_FAIL_THRESHOLD = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;
const LOGIN_FAIL_WINDOW_SECONDS = 15 * 60;

let developmentFallbackSecret: string | null = null;

// [P0-1修复] 用于签名的密钥，生产环境必须设置 SESSION_SECRET 环境变量
// 不再提供默认值，缺失则 fail-fast
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // 非生产环境允许使用进程级随机密钥（避免硬编码）
    if (process.env.NODE_ENV !== "production") {
      if (!developmentFallbackSecret) {
        developmentFallbackSecret = randomBytes(32).toString("hex");
      }
      console.warn("⚠️ SESSION_SECRET not set, using ephemeral development secret. DO NOT use in production!");
      return developmentFallbackSecret;
    }
    // 生产环境必须配置，否则直接抛错
    throw new Error("FATAL: SESSION_SECRET environment variable is required in production!");
  }

  if (secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("FATAL: SESSION_SECRET must be at least 32 characters in production!");
    }
    console.warn("⚠️ SESSION_SECRET should be at least 32 characters for security");
  }

  return secret;
}

// 延迟获取 secret，避免模块加载时立即抛错（便于测试/构建）
let _sessionSecret: string | null = null;
function getSecret(): string {
  if (!_sessionSecret) {
    _sessionSecret = getSessionSecret();
  }
  return _sessionSecret;
}

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

interface SessionData {
  id: number;
  username: string;
  displayName: string;
  exp: number;
  iat: number;
  jti: string;
}

interface SessionDataInput {
  id: number;
  username: string;
  displayName: string;
  exp: number;
  iat?: number;
  jti?: string;
}

// 生成 HMAC 签名
export function signSession(payload: string): string {
  return createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
}

// 验证签名
export function verifySessionSignature(payload: string, signature: string): boolean {
  const expectedSignature = signSession(payload);

  // 统一长度后再 timingSafeEqual，避免长度分支泄漏差异
  const maxLen = Math.max(expectedSignature.length, signature.length);
  const expectedBuffer = Buffer.alloc(maxLen);
  const actualBuffer = Buffer.alloc(maxLen);
  expectedBuffer.write(expectedSignature, "utf8");
  actualBuffer.write(signature, "utf8");

  const same = timingSafeEqual(expectedBuffer, actualBuffer);
  return same && expectedSignature.length === signature.length;
}

// 创建带签名的 session token
export function createSessionToken(sessionData: SessionDataInput): string {
  const normalizedSessionData: SessionData = {
    ...sessionData,
    iat: sessionData.iat ?? Date.now(),
    jti: sessionData.jti ?? randomUUID(),
  };

  const payload = Buffer.from(JSON.stringify(normalizedSessionData)).toString("base64");
  const signature = signSession(payload);
  return `${payload}.${signature}`;
}

function normalizeLoginIdentity(username: string): string {
  return username.trim().toLowerCase();
}

function isValidSessionData(data: unknown): data is SessionData {
  if (!data || typeof data !== "object") {
    return false;
  }

  const value = data as Record<string, unknown>;
  return (
    typeof value.id === "number" && Number.isFinite(value.id) &&
    typeof value.username === "string" && value.username.length > 0 &&
    typeof value.displayName === "string" &&
    typeof value.exp === "number" && Number.isFinite(value.exp) &&
    typeof value.iat === "number" && Number.isFinite(value.iat) &&
    typeof value.jti === "string" && value.jti.length > 0
  );
}

async function isSessionRevoked(sessionData: SessionData): Promise<boolean> {
  const [blacklisted, revokedAfterRaw] = await Promise.all([
    kv.get<string>(SESSION_BLACKLIST_KEY(sessionData.jti)),
    kv.get<string | number>(SESSION_REVOKED_AFTER_KEY(sessionData.id)),
  ]);

  if (blacklisted !== null) {
    return true;
  }

  const revokedAfter = Number(revokedAfterRaw ?? 0);
  if (Number.isFinite(revokedAfter) && revokedAfter > 0 && sessionData.iat <= revokedAfter) {
    return true;
  }

  return false;
}

async function getValidSessionData(sessionCookie: string): Promise<SessionData | null> {
  const sessionData = parseSessionToken(sessionCookie);
  if (!sessionData) {
    return null;
  }

  if (sessionData.exp < Date.now()) {
    return null;
  }

  if (await isSessionRevoked(sessionData)) {
    return null;
  }

  return sessionData;
}

export async function revokeSessionToken(token: string): Promise<void> {
  const sessionData = parseSessionToken(token);
  if (!sessionData) {
    return;
  }

  const ttlSeconds = Math.max(
    1,
    Math.ceil((sessionData.exp - Date.now()) / 1000) + SESSION_BLACKLIST_GRACE_SECONDS
  );

  await kv.set(SESSION_BLACKLIST_KEY(sessionData.jti), "1", { ex: ttlSeconds });
}

export async function revokeAllUserSessions(userId: number): Promise<void> {
  await kv.set(SESSION_REVOKED_AFTER_KEY(userId), String(Date.now()), {
    ex: SESSION_REVOKED_AFTER_TTL_SECONDS,
  });
}

export async function getLoginLockStatus(username: string): Promise<{ locked: boolean; remainingSeconds: number }> {
  const normalizedUsername = normalizeLoginIdentity(username);
  if (!normalizedUsername) {
    return { locked: false, remainingSeconds: 0 };
  }

  const ttl = await kv.ttl(LOGIN_LOCK_KEY(normalizedUsername));
  if (ttl > 0) {
    return { locked: true, remainingSeconds: ttl };
  }

  return { locked: false, remainingSeconds: 0 };
}

export async function recordLoginFailure(username: string): Promise<{ locked: boolean; remainingSeconds: number; attempts: number }> {
  const normalizedUsername = normalizeLoginIdentity(username);
  if (!normalizedUsername) {
    return { locked: false, remainingSeconds: 0, attempts: 0 };
  }

  const lockStatus = await getLoginLockStatus(normalizedUsername);
  if (lockStatus.locked) {
    return { locked: true, remainingSeconds: lockStatus.remainingSeconds, attempts: LOGIN_FAIL_THRESHOLD };
  }

  const attemptsRaw = await kv.incr(LOGIN_FAIL_KEY(normalizedUsername));
  const attempts = Number(attemptsRaw);

  if (attempts === 1) {
    await kv.expire(LOGIN_FAIL_KEY(normalizedUsername), LOGIN_FAIL_WINDOW_SECONDS);
  }

  if (attempts >= LOGIN_FAIL_THRESHOLD) {
    await Promise.all([
      kv.set(LOGIN_LOCK_KEY(normalizedUsername), "1", { ex: LOGIN_LOCK_SECONDS }),
      kv.del(LOGIN_FAIL_KEY(normalizedUsername)),
    ]);
    return { locked: true, remainingSeconds: LOGIN_LOCK_SECONDS, attempts };
  }

  return { locked: false, remainingSeconds: 0, attempts };
}

export async function clearLoginFailures(username: string): Promise<void> {
  const normalizedUsername = normalizeLoginIdentity(username);
  if (!normalizedUsername) {
    return;
  }

  await Promise.all([
    kv.del(LOGIN_FAIL_KEY(normalizedUsername)),
    kv.del(LOGIN_LOCK_KEY(normalizedUsername)),
  ]);
}

// 解析并验证 session token
export function parseSessionToken(token: string): SessionData | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  
  const [payload, signature] = parts;
  
  // 验证签名
  if (!verifySessionSignature(payload, signature)) {
    console.error("Session signature verification failed");
    return null;
  }
  
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
    if (!isValidSessionData(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("app_session")?.value ?? cookieStore.get("session")?.value;
  
  if (!sessionCookie) {
    return null;
  }

  try {
    // 解析并验证 session token（含签名、过期与吊销校验）
    const sessionData = await getValidSessionData(sessionCookie);
    
    if (!sessionData) {
      return null;
    }

    return {
      id: sessionData.id,
      username: sessionData.username,
      displayName: sessionData.displayName,
      isAdmin: ADMIN_USERNAMES.includes(sessionData.username),
    };
  } catch (error) {
    console.error("Session decode error:", error);
    return null;
  }
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.isAdmin || false;
}

// 同步验证 session cookie（不使用 await cookies()）
export interface SessionPayload {
  userId: number;
  username: string;
  displayName: string;
}

export function verifySession(sessionCookie: string): SessionPayload | null {
  if (!sessionCookie) {
    return null;
  }

  try {
    const sessionData = parseSessionToken(sessionCookie);

    if (!sessionData) {
      return null;
    }

    // 检查是否过期
    if (sessionData.exp < Date.now()) {
      return null;
    }

    return {
      userId: sessionData.id,
      username: sessionData.username,
      displayName: sessionData.displayName,
    };
  } catch {
    return null;
  }
}

export async function verifySessionWithRevocation(sessionCookie: string): Promise<SessionPayload | null> {
  if (!sessionCookie) {
    return null;
  }

  try {
    const sessionData = await getValidSessionData(sessionCookie);
    if (!sessionData) {
      return null;
    }

    return {
      userId: sessionData.id,
      username: sessionData.username,
      displayName: sessionData.displayName,
    };
  } catch {
    return null;
  }
}

// 检查用户名是否为管理员
export function isAdminUsername(username: string): boolean {
  return ADMIN_USERNAMES.includes(username);
}
