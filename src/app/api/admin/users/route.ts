import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import {
  getAllUsers,
  getUserAllClaims,
  getUserLotteryCount,
  getAllProjects,
  getClaimRecord,
} from "@/lib/kv";

export const dynamic = "force-dynamic";

export interface UserWithStats {
  id: number;
  username: string;
  firstSeen: number;
  claimsCount: number;
  lotteryCount: number;
  isNewUser: boolean;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    // 分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const search = searchParams.get("search") || "";

    const allUsers = await getAllUsers();
    
    // 按首次访问时间降序排序
    allUsers.sort((a, b) => b.firstSeen - a.firstSeen);
    
    // 搜索过滤
    let filteredUsers = allUsers;
    if (search.trim()) {
      const query = search.toLowerCase();
      filteredUsers = allUsers.filter(u => 
        u.username.toLowerCase().includes(query) ||
        u.id.toString().includes(query)
      );
    }
    
    // 计算分页
    const total = filteredUsers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
    
    // 只获取当前页用户的统计信息（减少查询量）
    const usersWithStats: UserWithStats[] = await Promise.all(
      paginatedUsers.map(async (u) => {
        const claims = await getUserAllClaims(u.id);
        const lotteryCount = await getUserLotteryCount(u.id);
        
        return {
          id: u.id,
          username: u.username,
          firstSeen: u.firstSeen,
          claimsCount: claims.length,
          lotteryCount,
          isNewUser: claims.length === 0 && lotteryCount === 0,
        };
      })
    );

    // 统计：用于顶部卡片显示（不依赖是否加载更多）
    let stats:
      | { total: number; newUserCount: number; claimedUserCount: number }
      | undefined;
    if (page === 1) {
      const projects = await getAllProjects();
      const userIds = filteredUsers.map((u) => u.id);

      let newUserCount = 0;
      const CONCURRENCY = 10;
      for (let i = 0; i < userIds.length; i += CONCURRENCY) {
        const batch = userIds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async (userId) => {
            const lotteryCount = await getUserLotteryCount(userId);
            if (lotteryCount > 0) return false;
            for (const project of projects) {
              const record = await getClaimRecord(project.id, userId);
              if (record) return false;
            }
            return true;
          })
        );
        newUserCount += batchResults.filter(Boolean).length;
      }
      stats = {
        total,
        newUserCount,
        claimedUserCount: total - newUserCount,
      };
    }

    return NextResponse.json({
      success: true,
      users: usersWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: endIndex < total,
      },
      stats,
    });
  } catch (error) {
    console.error("Get users error:", error);
    return NextResponse.json(
      { success: false, message: "获取用户列表失败" },
      { status: 500 }
    );
  }
}
