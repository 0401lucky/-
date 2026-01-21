import { cookies } from "next/headers";
import { createHmac } from "crypto";

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "lucky").split(",").map(s => s.trim());

// 用于签名的密钥，生产环境必须设置 SESSION_SECRET 环境变量
const SESSION_SECRET = process.env.SESSION_SECRET || "default-secret-please-change-in-production";

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
}

// 生成 HMAC 签名
export function signSession(payload: string): string {
  return createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("hex");
}

// 验证签名
export function verifySessionSignature(payload: string, signature: string): boolean {
  const expectedSignature = signSession(payload);
  // 使用时间常量比较防止时序攻击
  if (expectedSignature.length !== signature.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    result |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

// 创建带签名的 session token
export function createSessionToken(sessionData: SessionData): string {
  const payload = Buffer.from(JSON.stringify(sessionData)).toString("base64");
  const signature = signSession(payload);
  return `${payload}.${signature}`;
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
    return JSON.parse(Buffer.from(payload, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("app_session")?.value;
  
  if (!sessionCookie) {
    return null;
  }

  try {
    // 解析并验证 session token（含签名校验）
    const sessionData = parseSessionToken(sessionCookie);
    
    if (!sessionData) {
      return null;
    }

    // 检查是否过期
    if (sessionData.exp < Date.now()) {
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
