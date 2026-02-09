let _newApiUrl: string | null = null;

function sanitizeEnvValue(value: string | undefined): string {
  if (!value) return '';

  return value
    .replace(/\\r\\n|\\n|\\r/g, '')
    .replace(/[\r\n]/g, '')
    .trim();
}

export function getNewApiUrl(): string {
  if (_newApiUrl) return _newApiUrl;

  const rawUrl = sanitizeEnvValue(process.env.NEW_API_URL);
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

export async function loginToNewApi(username: string, password: string): Promise<{ success: boolean; message: string; cookies?: string; user?: NewApiUser }> {
  try {
    const baseUrl = getNewApiUrl();
    const safeUsername = sanitizeEnvValue(username);
    const safePassword = sanitizeEnvValue(password);
    console.log(`Attempting login to ${baseUrl}/api/user/login with username: ${safeUsername}`);
    
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
      userId: data.data?.id
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
  try {
    const baseUrl = getNewApiUrl();
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
    });

    const data = await response.json();
    
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
      message: "服务连接失败",
    };
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
  // 检查缓存是否有效（提前5分钟过期以保证安全）
  if (adminSessionCache && adminSessionCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return adminSessionCache.cookies;
  }

  const username = sanitizeEnvValue(process.env.NEW_API_ADMIN_USERNAME);
  const password = sanitizeEnvValue(process.env.NEW_API_ADMIN_PASSWORD);

  if (!username || !password) {
    console.error('Admin credentials not configured. Please set NEW_API_ADMIN_USERNAME and NEW_API_ADMIN_PASSWORD.');
    return null;
  }

  console.log('Attempting admin login with username:', username);
  
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
  
  // 缓存会话，假设有效期24小时
  adminSessionCache = {
    cookies: result.cookies,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  return result.cookies;
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
): Promise<{ success: boolean; message: string; newQuota?: number }> {
  const baseUrl = getNewApiUrl();
  const loginResult = await getAdminSessionWithUser();
  if (!loginResult) {
    return { success: false, message: '管理员会话获取失败' };
  }
  
  const { cookies: adminCookies, adminUserId } = loginResult;
  let expectedQuota: number | undefined;

  try {
    // 先获取用户完整信息（必须，因为 PUT 会覆盖所有字段）
    const userResponse = await fetch(`${baseUrl}/api/user/${userId}`, {
      headers: { 
        Cookie: adminCookies,
        'New-Api-User': String(adminUserId),
      },
    });
    const userData = await userResponse.json();
    
    console.log('Get user response:', { success: userData.success, userId, hasData: !!userData.data });
    
    if (!userData.success || !userData.data) {
      return { success: false, message: '获取用户信息失败' };
    }

    const user = userData.data;
    const currentQuota = user.quota || 0;
    // 1 USD = 500000 quota units
    const quotaToAdd = Math.floor(dollars * 500000);
    const newQuota = currentQuota + quotaToAdd;
    expectedQuota = newQuota;

    // 更新用户额度（必须传递完整用户对象，否则其他字段会被清空）
    const updateResponse = await fetch(`${baseUrl}/api/user/`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookies,
        'New-Api-User': String(adminUserId),
      },
      body: JSON.stringify({
        id: userId,
        username: user.username,
        display_name: user.display_name,
        group: user.group || 'default',
        quota: newQuota,
        remark: user.remark || '',
      }),
    });

    let updateData;
    try {
      updateData = await updateResponse.json();
    } catch (parseError) {
      // JSON 解析失败，可能请求已成功但响应异常
      // 重新获取用户 quota 验证是否成功
      console.warn('Update response parse failed, verifying with GET:', parseError);
      const verifyResult = await verifyQuotaUpdate(userId, newQuota, adminCookies, adminUserId);
      return verifyResult;
    }
    
    console.log('Update user response:', { success: updateData.success, message: updateData.message, newQuota });
    
    if (updateData.success) {
      return { 
        success: true, 
        message: `成功充值 $${dollars}`, 
        newQuota 
      };
    } else {
      // 部分 new-api 场景会出现“实际已更新，但返回 success=false / 响应异常”的情况
      // 再次 GET 校验，避免误判为失败导致重复发放
      const verifyResult = await verifyQuotaUpdate(userId, newQuota, adminCookies, adminUserId);
      if (verifyResult.success || verifyResult.uncertain) {
        return verifyResult;
      }
      return { 
        success: false, 
        message: updateData.message || '额度更新失败' 
      };
    }
  } catch (error) {
    console.error('Credit quota error:', error);
    // 网络错误或其他异常，但 PUT 可能已经成功执行
    // 尝试重新获取用户 quota 验证
    console.warn('Credit quota failed with error, attempting verification...');
    try {
      const loginResult = await getAdminSessionWithUser();
      if (loginResult) {
        const verifyResult = await verifyQuotaUpdate(
          userId, 
          expectedQuota,
          loginResult.cookies, 
          loginResult.adminUserId
        );
        if (verifyResult.uncertain) {
          // 不确定状态，不回滚，让调用方知道
          return { 
            success: false, 
            message: '充值结果不确定，请稍后检查余额',
            uncertain: true 
          } as { success: boolean; message: string; newQuota?: number; uncertain?: boolean };
        }
        return verifyResult;
      }
    } catch (verifyError) {
      console.error('Verification also failed:', verifyError);
    }
    return { 
      success: false, 
      message: '服务连接失败，结果不确定，请检查余额',
      uncertain: true 
    } as { success: boolean; message: string; newQuota?: number; uncertain?: boolean };
  }
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
  // 检查缓存是否有效（提前5分钟过期以保证安全）
  if (adminSessionWithUserCache && adminSessionWithUserCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return { cookies: adminSessionWithUserCache.cookies, adminUserId: adminSessionWithUserCache.adminUserId };
  }

  const username = sanitizeEnvValue(process.env.NEW_API_ADMIN_USERNAME);
  const password = sanitizeEnvValue(process.env.NEW_API_ADMIN_PASSWORD);

  if (!username || !password) {
    console.error('Admin credentials not configured');
    return null;
  }

  const result = await loginToNewApi(username, password);
  
  if (!result.success) {
    console.error('Admin login failed:', result.message);
    return null;
  }
  
  if (!result.cookies || !result.user?.id) {
    console.error('Admin login succeeded but no cookies or user ID returned');
    return null;
  }

  // 缓存会话，假设有效期24小时
  adminSessionWithUserCache = {
    cookies: result.cookies,
    adminUserId: result.user.id,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  };
  
  return {
    cookies: result.cookies,
    adminUserId: result.user.id,
  };
}
