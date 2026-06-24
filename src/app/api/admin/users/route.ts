import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import {
  getAllUsers,
  getUserAllClaims,
  getUserLotteryCount,
  getNewUserEligibilityMap,
} from "@/lib/kv";
import { getDailyStats } from "@/lib/daily-stats";
import { getUserLotteryRecords } from "@/lib/lottery";
import { getPointsLogs, getUserPoints } from "@/lib/points";

export const dynamic = "force-dynamic";

export interface UserWithStats {
  id: number;
  username: string;
  firstSeen: number;
  claimsCount: number;
  lotteryCount: number;
  isNewUser: boolean;
  pointsBalance: number;
  todayGamesPlayed: number;
  todayPointsEarned: number;
  latestPointChange: number | null;
  latestPointChangeAt: number | null;
  lastClaimAt: number | null;
  lastLotteryAt: number | null;
  lastActivityAt: number;
}

export const GET = withAdmin(async (request: NextRequest) => {
  try {
    // 分页参数
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "all";

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

    const filteredUserIds = filteredUsers.map((u) => u.id);
    const eligibilityMap = await getNewUserEligibilityMap(filteredUserIds);

    if (status === "new") {
      filteredUsers = filteredUsers.filter((u) => eligibilityMap[u.id] ?? true);
    } else if (status === "claimed") {
      filteredUsers = filteredUsers.filter((u) => !(eligibilityMap[u.id] ?? true));
    }

    // 计算分页
    const total = filteredUsers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);

    // 只获取当前页用户的统计信息（减少查询量）
    const usersWithStats: UserWithStats[] = await Promise.all(
      paginatedUsers.map(async (u) => {
        const [
          claims,
          lotteryCount,
          recentLotteryRecords,
          pointsBalance,
          recentPointLogs,
          dailyStats,
        ] = await Promise.all([
          getUserAllClaims(u.id),
          getUserLotteryCount(u.id),
          getUserLotteryRecords(u.id, 1),
          getUserPoints(u.id),
          getPointsLogs(u.id, 1),
          getDailyStats(u.id),
        ]);

        const lastClaimAt = claims.reduce<number | null>((latest, claim) => {
          if (!Number.isFinite(claim.claimedAt)) return latest;
          return latest == null ? claim.claimedAt : Math.max(latest, claim.claimedAt);
        }, null);
        const latestPointLog = recentPointLogs[0] ?? null;
        const latestLottery = recentLotteryRecords[0] ?? null;
        const lastLotteryAt = Number.isFinite(latestLottery?.createdAt)
          ? latestLottery.createdAt
          : null;
        const latestPointChangeAt = Number.isFinite(latestPointLog?.createdAt)
          ? latestPointLog.createdAt
          : null;
        const lastActivityAt = Math.max(
          u.firstSeen,
          lastClaimAt ?? 0,
          lastLotteryAt ?? 0,
          latestPointChangeAt ?? 0,
          dailyStats.lastGameAt ?? 0,
        );

        return {
          id: u.id,
          username: u.username,
          firstSeen: u.firstSeen,
          claimsCount: claims.length,
          lotteryCount,
          isNewUser: eligibilityMap[u.id] ?? true,
          pointsBalance,
          todayGamesPlayed: dailyStats.gamesPlayed,
          todayPointsEarned: dailyStats.pointsEarned,
          latestPointChange: latestPointLog?.amount ?? null,
          latestPointChangeAt,
          lastClaimAt,
          lastLotteryAt,
          lastActivityAt,
        };
      })
    );

    // 统计：用于顶部卡片显示（不依赖是否加载更多）
    const newUserCount = filteredUserIds.reduce((count, userId) => {
      return count + (eligibilityMap[userId] ? 1 : 0);
    }, 0);

    const stats = {
      total: filteredUserIds.length,
      newUserCount,
      claimedUserCount: filteredUserIds.length - newUserCount,
    };

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
});
