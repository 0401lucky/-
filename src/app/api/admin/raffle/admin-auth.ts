import { getAuthUser, isAdmin } from "@/lib/auth";

export async function checkRaffleAdmin() {
  const user = await getAuthUser();

  if (!user) {
    return { error: "请先登录", status: 401 } as const;
  }

  if (!isAdmin(user)) {
    return { error: "无权限访问", status: 403 } as const;
  }

  return { userId: user.id } as const;
}
