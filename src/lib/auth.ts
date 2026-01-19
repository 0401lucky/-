import { cookies } from "next/headers";

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "lucky").split(",").map(s => s.trim());

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

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("app_session")?.value;
  
  if (!sessionCookie) {
    return null;
  }

  try {
    // 解码 session token
    const sessionData: SessionData = JSON.parse(
      Buffer.from(sessionCookie, "base64").toString("utf-8")
    );

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
