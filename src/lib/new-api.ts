import { kv } from '@/lib/d1-kv';
import { maskUserId, maskUsername } from './logging';
import { getRuntimeEnvValue, sanitizeRuntimeEnvValue } from './runtime-env';

let _newApiUrl: string | null = null;
const CHECKIN_TIMEOUT_MS = 4000;

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

    let cookies = response.headers.get("set-cookie") || "";

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

// ============ 管理员接口（access token 模式） ============
//
// new-api 自 2025 年起 /api 路由统一鉴权：
// - middleware/auth.go authHelper 在 session 不存在时回退检查 Authorization header
// - model/user.go ValidateAccessToken 直接以整串 Authorization 值匹配 user.access_token 列
// - 任何模式下都强制要求 New-Api-User header 与认证用户 ID 一致
// 在 Cloudflare Workers / Edge Runtime 中 set-cookie 经常被边缘层吞掉，
// 因此放弃账号密码登录拿 cookie，改用「系统访问令牌」直签头部。

/**
 * 构造管理员 access token 请求 header。
 * 必需环境变量：
 *   NEW_API_ADMIN_ACCESS_TOKEN —— 在 new-api「个人设置 → 系统访问令牌」生成的 32 位 UUID
 *   NEW_API_ADMIN_USER_ID     —— 该令牌所属用户的数字 ID（管理员）
 */
export function getAdminAuthHeaders(): Record<string, string> {
  const token = sanitizeEnvValue(getRuntimeEnvValue("NEW_API_ADMIN_ACCESS_TOKEN"));
  const adminUserId = sanitizeEnvValue(getRuntimeEnvValue("NEW_API_ADMIN_USER_ID"));
  if (!token) {
    throw new Error("NEW_API_ADMIN_ACCESS_TOKEN is not set");
  }
  if (!adminUserId) {
    throw new Error("NEW_API_ADMIN_USER_ID is not set");
  }
  return {
    Authorization: token,
    "New-Api-User": adminUserId,
  };
}

async function verifyQuotaUpdate(
  userId: number,
  expectedQuota: number | undefined,
  authHeaders: Record<string, string>
): Promise<{ success: boolean; message: string; newQuota?: number; uncertain?: boolean }> {
  try {
    const baseUrl = getNewApiUrl();
    const verifyResponse = await fetch(`${baseUrl}/api/user/${userId}`, {
      headers: authHeaders,
    });
    const verifyData = await verifyResponse.json();

    if (verifyData.success && verifyData.data) {
      const currentQuota = verifyData.data.quota || 0;

      if (expectedQuota !== undefined && currentQuota >= expectedQuota) {
        return { success: true, message: '充值已确认成功', newQuota: currentQuota };
      } else if (expectedQuota === undefined) {
        return {
          success: false,
          message: '无法确认充值结果',
          newQuota: currentQuota,
          uncertain: true,
        };
      } else {
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
 * 直接为用户充值额度（管理员级 access token）。
 * @param userId  目标用户在 new-api 中的 ID
 * @param dollars 充值金额（美元，最终乘以 500000 转 quota）
 */
export async function creditQuotaToUser(
  userId: number,
  dollars: number
): Promise<CreditQuotaResult> {
  const baseUrl = getNewApiUrl();

  let authHeaders: Record<string, string>;
  try {
    authHeaders = getAdminAuthHeaders();
  } catch (error) {
    console.error('Admin access token not configured:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : '管理员凭证未配置',
    };
  }

  const lock = await acquireUserQuotaLock(userId);
  if (!lock) {
    return { success: false, message: '系统繁忙，充值请求排队中，请稍后重试' };
  }

  let expectedQuota: number | undefined;

  try {
    try {
      const userResponse = await fetch(`${baseUrl}/api/user/${userId}`, {
        headers: authHeaders,
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

      const updateResponse = await fetch(`${baseUrl}/api/user/manage`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: userId,
          action: 'add_quota',
          mode: 'add',
          value: quotaToAdd,
        }),
      });

      let updateData;
      try {
        updateData = await updateResponse.json();
      } catch (parseError) {
        console.warn('Update response parse failed, verifying with GET:', parseError);
        return await verifyQuotaUpdate(userId, newQuota, authHeaders);
      }

      console.log('Manage user quota response:', {
        success: updateData.success,
        message: updateData.message,
        quotaToAdd,
        newQuota,
      });

      if (updateData.success) {
        return {
          success: true,
          message: `成功充值 $${dollars}`,
          newQuota,
        };
      }

      const verifyResult = await verifyQuotaUpdate(userId, newQuota, authHeaders);
      if (verifyResult.success || verifyResult.uncertain) {
        return verifyResult;
      }
      return {
        success: false,
        message: updateData.message || '额度更新失败',
      };
    } catch (error) {
      console.error('Credit quota error:', error);
      try {
        const verifyResult = await verifyQuotaUpdate(userId, expectedQuota, authHeaders);
        if (verifyResult.uncertain) {
          return {
            success: false,
            message: '充值结果不确定，请稍后检查余额',
            uncertain: true,
          };
        }
        return verifyResult;
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
