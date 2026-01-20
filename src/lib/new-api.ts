const NEW_API_URL = process.env.NEW_API_URL || "https://katqnmhfsssn.ap-northeast-1.clawcloudrun.com";

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
    const response = await fetch(`${NEW_API_URL}/api/user/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
      credentials: "include",
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

    console.log("Login response:", { success: data.success, hasCookies: !!cookies, cookiesLength: cookies.length });

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
    const response = await fetch(`${NEW_API_URL}/api/user/self`, {
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
    const headers: Record<string, string> = {
      Cookie: sessionCookie,
    };
    
    // 添加 New-Api-User header（new-api 要求用户ID，必须是数字）
    if (userId !== undefined) {
      headers["New-Api-User"] = String(userId);
    }
    
    const response = await fetch(`${NEW_API_URL}/api/user/checkin`, {
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
