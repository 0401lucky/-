import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getAllUsers, getUserAllClaims, hasUserClaimedAny, getUserLotteryCount } from "@/lib/kv";

export const dynamic = "force-dynamic";

export interface UserWithStats {
  id: number;
  username: string;
  firstSeen: number;
  claimsCount: number;
  lotteryCount: number;
  isNewUser: boolean;
}

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const users = await getAllUsers();
    
    // 获取每个用户的统计信息
    const usersWithStats: UserWithStats[] = await Promise.all(
      users.map(async (u) => {
        const claims = await getUserAllClaims(u.id);
        const lotteryCount = await getUserLotteryCount(u.id);
        const hasClaimed = await hasUserClaimedAny(u.id);
        
        return {
          id: u.id,
          username: u.username,
          firstSeen: u.firstSeen,
          claimsCount: claims.length,
          lotteryCount,
          isNewUser: !hasClaimed,
        };
      })
    );

    // 按首次访问时间降序排序
    usersWithStats.sort((a, b) => b.firstSeen - a.firstSeen);

    return NextResponse.json({
      success: true,
      users: usersWithStats,
    });
  } catch (error) {
    console.error("Get users error:", error);
    return NextResponse.json(
      { success: false, message: "获取用户列表失败" },
      { status: 500 }
    );
  }
}
