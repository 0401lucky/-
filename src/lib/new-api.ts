import { kv } from '@/lib/d1-kv';
import { maskUserId, maskUsername } from './logging';
import { getRuntimeEnvValue, sanitizeRuntimeEnvValue } from './runtime-env';

let _newApiUrl: string | null = null;
const CHECKIN_TIMEOUT_MS = 4000;
const ADMIN_SESSION_CACHE_KEY = 'newapi:admin:session';
const ADMIN_SESSION_CACHE_TTL_SECONDS = 24 * 60 * 60;

const USER_QUOTA_LOCK_PREFIX = 'newapi:quota:credit:lock:';
const USER_QUOTA_LOCK_TTL_SECONDS = 15;
const USER_QUOTA_LOCK_RETRY_MS = 120;
const USER_QUOTA_LOCK_MAX_RETRIES = 25;

type UserQuotaLock = {
  key: string;
  token: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireUserQuotaLock(userId: number): Promise<UserQuotaLock | null> {
  const key = `${USER_QUOTA_LOCK_PREFIX}${userId}`;
  const token = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  for (let attempt = 0; attempt < USER_QUOTA_LOCK_MAX_RETRIES; attempt += 1) {
    const locked = await kv.set(key, token, { nx: true, ex: USER_QUOTA_LOCK_TTL_SECONDS });
    if (locked === 'OK') {
      return { key, token };
    }
    await sleep(USER_QUOTA_LOCK_RETRY_MS);
  }

  return null;
}

async function releaseUserQuotaLock(lock: UserQuotaLock): Promise<void> {
  try {
    const current = await kv.get<string>(lock.key);
    if (current === lock.token) {
      await kv.del(lock.key);
    }
  } catch (error) {
    console.error('Release quota lock failed:', error);
  }
}

function sanitizeEnvValue(value: string | undefined): string {
  return sanitizeRuntimeEnvValue(value);
}

export function getNewApiUrl(): string {
  if (_newApiUrl) return _newApiUrl;

  const rawUrl = sanitizeEnvValue(getRuntimeEnvValue("NEW_API_URL"));
  if (!rawUrl) {
    throw new Error(
      "NEW_API_URL is not set. Please configure it (e.g. in .env.local / Vercel env vars)."
    );
  }

  _newApiUrl = rawUrl.replace(/\/+$/, "");
  return _newApiUrl;
}

export interface NewApiUser {
  id: number;
  username: string;
  display_name: string;
  role: number;
  status: number;
  email: string;
  quota: number;
  used_quota: number;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  data?: NewApiUser;
}

export interface CreditQuotaResult {
  success: boolean;
  message: string;
  newQuota?: number;
  uncertain?: boolean;
}

interface CachedAdminSession {
  cookies: string;
  adminUserId: number;
  expiresAt: number;
}

export async function loginToNewApi(username: string, password: string): Promise<{ success: boolean; message: string; cookies?: string; user?: NewApiUser }> {
  try {
    const baseUrl = getNewApiUrl();
    const safeUsername = sanitizeEnvValue(username);
    const safePassword = sanitizeEnvValue(password);
    console.log("Attempting login to new-api", { endpoint: `${baseUrl}/api/user/login`, username: maskUsername(safeUsername) });
    
    const response = await fetch(`${baseUrl}/api/user/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: safeUsername, password: safePassword }),
    });

    // 尝试多种方式获取 cookie
    let cookies = response.headers.get("set-cookie") || "";
    
    // 如果 set-cookie 为空，尝试从 headers 遍历获取
    if (!cookies) {
      const setCookieHeader = response.headers.getSetCookie?.();
      if (setCookieHeader && setCookieHeader.length > 0) {
        cookies = setCookieHeader.join("; ");
      }
    }
    
    const data = await response.json();

    console.log("Login response:", { 
      success: data.success, 
      message: data.message,
      hasCookies: !!cookies, 
      cookiesLength: cookies.length,
      hasData: !!data.data,
      userId: maskUserId(data.data?.id)
    });

    if (data.success) {
      // 如果没有 cookies，但登录成功了，尝试构造 session cookie
      // new-api 的 session 通常存储在 data.data 或响应中
      if (!cookies && data.data) {
        // 某些 new-api 版本会在登录成功后返回 session token
        // 这里我们可以尝试用用户信息来验证后续请求
        console.log("No cookies received, attempting alternative session method");
      }
      
      return {
        success: true,
        message: "登录成功",
        cookies,
        user: data.data,
      };
    } else {
      return {
        success: false,
        message: data.message || "登录失败",
      };
    }
  } catch (error) {
    console.error("Login error:", error);
    return {
      success: false,
      message: "服务连接失败",
    };
  }
}

export async function getUserFromNewApi(sessionCookie: string): Promise<NewApiUser | null> {
  try {
    const baseUrl = getNewApiUrl();
    const response = await fetch(`${baseUrl}/api/user/self`, {
      headers: {
        Cookie: sessionCookie,
      },
    });

    const data = await response.json();
    
    if (data.success && data.data) {
      return data.data;
    }
    return null;
  } catch (error) {
    console.error("Get user error:", error);
    return null;
  }
}

export async function checkinToNewApi(sessionCookie: string, userId?: number): Promise<{ success: boolean; message: string; quotaAwarded?: number }> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const baseUrl = getNewApiUrl();
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), CHECKIN_TIMEOUT_MS);
    const headers: Record<string, string> = {
      Cookie: sessionCookie,
    };
    
    // 添加 New-Api-User header（new-api 要求用户ID，必须是数字）
    if (userId !== undefined) {
      headers["New-Api-User"] = String(userId);
    }
    
    const response = await fetch(`${baseUrl}/api/user/checkin`, {
      method: "POST",
      headers,
      signal: controller.signal,
    });

    const data = await response.json();
    clearTimeout(timeout);
    timeout = null;
    
    if (data.success) {
      // new-api 返回 { success: true, message: "签到成功", data: { quota_awarded: 12345 } }
      const quotaAwarded = data.data?.quota_awarded || data.data?.QuotaAwarded || 0;
      return {
        success: true,
        message: data.message || "签到成功",
        quotaAwarded,
      };
    } else {
      return {
        success: false,
        message: data.message || "签到失败",
      };
    }
  } catch (error) {
    console.error("Checkin error:", error);
    return {
      success: false,
      message: error instanceof Error && error.name === "AbortError"
        ? "签到服务超时，请稍后重试"
        : "服务连接失败",
    };
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

// ============ 管理员接口 ============

// 管理员会话缓存（内存中，服务重启后失效）
let adminSessionCache: { cookies: string; expiresAt: number } | null = null;

/**
 * 获取管理员会话（自动缓存，过期自动刷新）
 * 使用环境变量 NEW_API_ADMIN_USERNAME 和 NEW_API_ADMIN_PASSWORD
 */
export async function getAdminSession(): Promise<string | null> {
  const cached = await getAdminSessionWithUser();
  return cached?.cookies ?? null;
}

async function readCachedAdminSession(): Promise<CachedAdminSession | null> {
  const now = Date.now();
  if (adminSessionWithUserCache && adminSessionWithUserCache.expiresAt > now + 5 * 60 * 1000) {
    return {
      cookies: adminSessionWithUserCache.cookies,
      adminUserId: adminSessionWithUserCache.adminUserId,
      expiresAt: adminSessionWithUserCache.expiresAt,
    };
  }

  try {
    const cached = await kv.get<CachedAdminSession>(ADMIN_SESSION_CACHE_KEY);
    if (cached && cached.cookies && cached.adminUserId && cached.expiresAt > now + 5 * 60 * 1000) {
      adminSessionWithUserCache = {
        cookies: cached.cookies,
        adminUserId: cached.adminUserId,
        expiresAt: cached.expiresAt,
      };
      adminSessionCache = {
        cookies: cached.cookies,
        expiresAt: cached.expiresAt,
      };
      return cached;
    }
  } catch (error) {
    console.error('Read cached admin session failed:', error);
  }

  return null;
}

async function writeCachedAdminSession(payload: CachedAdminSession): Promise<void> {
  try {
    await kv.set(ADMIN_SESSION_CACHE_KEY, payload, { ex: ADMIN_SESSION_CACHE_TTL_SECONDS });
  } catch (error) {
    console.error('Write cached admin session failed:', error);
  }
}

/**
 * 获取管理员会话（自动缓存，过期自动刷新）
 * 使用环境变量 NEW_API_ADMIN_USERNAME 和 NEW_API_ADMIN_PASSWORD
 */
async function getAdminSessionSlowPath(): Promise<{ cookies: string; adminUserId: number } | null> {
  // 检查缓存是否有效（提前5分钟过期以保证安全）
  if (adminSessionCache && adminSessionCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    if (adminSessionWithUserCache) {
      return {
        cookies: adminSessionWithUserCache.cookies,
        adminUserId: adminSessionWithUserCache.adminUserId,
      };
    }
  }

  const username = sanitizeEnvValue(getRuntimeEnvValue("NEW_API_ADMIN_USERNAME"));
  const password = sanitizeEnvValue(getRuntimeEnvValue("NEW_API_ADMIN_PASSWORD"));

  if (!username || !password) {
    console.error('Admin credentials not configured. Please set NEW_API_ADMIN_USERNAME and NEW_API_ADMIN_PASSWORD.');
    return null;
  }

  console.log('Attempting admin login to new-api', { username: maskUsername(username) });
  
  const result = await loginToNewApi(username, password);
  
  if (!result.success) {
    console.error('Admin login failed:', result.message);
    return null;
  }
  
  if (!result.cookies) {
    console.error('Admin login succeeded but no cookies returned. This might be a Vercel/Edge environment issue.');
    // 尝试使用 session token 方式（如果 new-api 支持）
    return null;
  }
  if (!result.user?.id) {
    console.error('Admin login succeeded but no user ID returned');
    return null;
  }

  const expiresAt = Date.now() + ADMIN_SESSION_CACHE_TTL_SECONDS * 1000;
  adminSessionCache = {
    cookies: result.cookies,
    expiresAt,
  };
  adminSessionWithUserCache = {
    cookies: result.cookies,
    adminUserId: result.user.id,
    expiresAt,
  };
  await writeCachedAdminSession({
    cookies: result.cookies,
    adminUserId: result.user.id,
    expiresAt,
  });

  return {
    cookies: result.cookies,
    adminUserId: result.user.id,
  };
}

/**
 * 验证 quota 更新是否成功（用于处理响应丢失/超时的情况）
 */
async function verifyQuotaUpdate(
  userId: number,
  expectedQuota: number | undefined,
  adminCookies: string,
  adminUserId: number
): Promise<{ success: boolean; message: string; newQuota?: number; uncertain?: boolean }> {
  try {
    const baseUrl = getNewApiUrl();
    const verifyResponse = await fetch(`${baseUrl}/api/user/${userId}`, {
      headers: { 
        Cookie: adminCookies,
        'New-Api-User': String(adminUserId),
      },
    });
    const verifyData = await verifyResponse.json();
    
    if (verifyData.success && verifyData.data) {
      const currentQuota = verifyData.data.quota || 0;
      
      if (expectedQuota !== undefined && currentQuota >= expectedQuota) {
        // quota 已经是期望值或更高，说明充值成功了
        return { success: true, message: '充值已确认成功', newQuota: currentQuota };
      } else if (expectedQuota === undefined) {
        // 无法确定是否成功，返回 uncertain
        return { 
          success: false, 
          message: '无法确认充值结果',
          newQuota: currentQuota,
          uncertain: true 
        };
      } else {
        // quota 低于期望值，确认失败
        return { success: false, message: '充值确认失败' };
      }
    }
    return { success: false, message: '验证用户信息失败', uncertain: true };
  } catch (error) {
    console.error('Verify quota update error:', error);
    return { success: false, message: '验证失败', uncertain: true };
  }
}

/**
 * 获取管理员会话（包含管理员用户ID，用于 New-Api-User header）
 */
let adminSessionWithUserCache: { cookies: string; adminUserId: number; expiresAt: number } | null = null;

async function getAdminSessionWithUser(): Promise<{ cookies: string; adminUserId: number } | null> {
  const cached = await readCachedAdminSession();
  if (cached) {
    return {
      cookies: cached.cookies,
      adminUserId: cached.adminUserId,
    };
  }

  return getAdminSessionSlowPath();
}

/**
 * 直接为用户充值额度（需要管理员权限）
 * @param userId 目标用户ID（new-api中的用户ID）
 * @param dollars 美元金额
 * @returns 充值结果
 */
export async function creditQuotaToUser(
  userId: number,
  dollars: number
): Promise<CreditQuotaResult> {
  const baseUrl = getNewApiUrl();
  const loginResult = await getAdminSessionWithUser();
  if (!loginResult) {
    return { success: false, message: '管理员会话获取失败' };
  }
  
  const { cookies: adminCookies, adminUserId } = loginResult;
  const lock = await acquireUserQuotaLock(userId);
  if (!lock) {
    return { success: false, message: '系统繁忙，充值请求排队中，请稍后重试' };
  }

  let expectedQuota: number | undefined;

  try {
    try {
      const userResponse = await fetch(`${baseUrl}/api/user/${userId}`, {
        headers: {
          Cookie: adminCookies,
          'New-Api-User': String(adminUserId),
        },
      });
      const userData = await userResponse.json();

      console.log('Get user response:', { success: userData.success, userId: maskUserId(userId), hasData: !!userData.data });

      if (!userData.success || !userData.data) {
        return { success: false, message: '获取用户信息失败' };
      }

      const user = userData.data;
      const currentQuota = user.quota || 0;
      const quotaToAdd = Math.floor(dollars * 500000);
      const newQuota = currentQuota + quotaToAdd;
      expectedQuota = newQuota;

      const updatePayload = {
        ...user,
        id: userId,
        quota: newQuota,
      };
      const sanitizedUpdatePayload = Object.fromEntries(
        Object.entries(updatePayload).filter(([, value]) => value !== undefined)
      );

      const updateResponse = await fetch(`${baseUrl}/api/user/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookies,
          'New-Api-User': String(adminUserId),
        },
        body: JSON.stringify(sanitizedUpdatePayload),
      });

      let updateData;
      try {
        updateData = await updateResponse.json();
      } catch (parseError) {
        console.warn('Update response parse failed, verifying with GET:', parseError);
        const verifyResult = await verifyQuotaUpdate(userId, newQuota, adminCookies, adminUserId);
        return verifyResult;
      }

      console.log('Update user response:', { success: updateData.success, message: updateData.message, newQuota });

      if (updateData.success) {
        return {
          success: true,
          message: `成功充值 $${dollars}`,
          newQuota,
        };
      }

      const verifyResult = await verifyQuotaUpdate(userId, newQuota, adminCookies, adminUserId);
      if (verifyResult.success || verifyResult.uncertain) {
        return verifyResult;
      }
      return {
        success: false,
        message: updateData.message || '额度更新失败',
      };
    } catch (error) {
      console.error('Credit quota error:', error);
      console.warn('Credit quota failed with error, attempting verification...');
      try {
        const nextLoginResult = await getAdminSessionWithUser();
        if (nextLoginResult) {
          const verifyResult = await verifyQuotaUpdate(
            userId,
            expectedQuota,
            nextLoginResult.cookies,
            nextLoginResult.adminUserId
          );
          if (verifyResult.uncertain) {
            return {
              success: false,
              message: '充值结果不确定，请稍后检查余额',
              uncertain: true,
            };
          }
          return verifyResult;
        }
      } catch (verifyError) {
        console.error('Verification also failed:', verifyError);
      }
      return {
        success: false,
        message: '服务连接失败，结果不确定，请检查余额',
        uncertain: true,
      };
    }
  } finally {
    await releaseUserQuotaLock(lock);
  }
}

