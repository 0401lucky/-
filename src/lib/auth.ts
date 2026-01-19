import { cookies } from "next/headers";
import { getUserFromNewApi, type NewApiUser } from "./new-api";

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || "lucky").split(",").map(s => s.trim());

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("session")?.value;
  
  if (!sessionCookie) {
    return null;
  }

  const user = await getUserFromNewApi(`session=${sessionCookie}`);
  
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    isAdmin: ADMIN_USERNAMES.includes(user.username),
  };
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.isAdmin || false;
}
