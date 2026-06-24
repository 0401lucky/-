import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import type { AuthUser } from "@/lib/auth";
import {
  getAllProjects,
  getAllUsers,
  getNewUserEligibility,
  getUserAllClaims,
} from "@/lib/kv";
import { getUserLotteryRecords } from "@/lib/lottery";
import { getProfileOverview } from "@/lib/profile";
import { getExchangeLogs } from "@/lib/store";
import { getAdminUserAchievementList } from "@/lib/user-achievements";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async (
  _request: NextRequest,
  _user: AuthUser,
  context: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await context.params;
    const userId = Number.parseInt(id, 10);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return NextResponse.json(
        { success: false, message: "无效的用户ID" },
        { status: 400 }
      );
    }

    const [claims, projects, allUsers] = await Promise.all([
      getUserAllClaims(userId),
      getAllProjects(),
      getAllUsers(),
    ]);

    const baseUser = allUsers.find((item) => item.id === userId) ?? {
      id: userId,
      username: `#${userId}`,
      firstSeen: 0,
    };

    const claimsWithProject = claims
      .map((claim) => {
        const project = projects.find((item) => item.id === claim.projectId);
        return {
          ...claim,
          projectName: project?.name || "未知项目",
        };
      })
      .sort((left, right) => right.claimedAt - left.claimedAt);

    const [lotteryRecords, achievements, overview, eligibility, exchangeLogs] =
      await Promise.all([
        getUserLotteryRecords(userId, 50),
        getAdminUserAchievementList(userId),
        getProfileOverview({ id: userId, username: baseUser.username }),
        getNewUserEligibility(userId),
        getExchangeLogs(userId, 20),
      ]);

    return NextResponse.json({
      success: true,
      user: {
        id: baseUser.id,
        username: baseUser.username,
        firstSeen: baseUser.firstSeen,
        displayName: overview.user.customDisplayName,
        avatarUrl: overview.user.customAvatarUrl,
        qqEmail: overview.user.customQqEmail,
        isNewUser: eligibility.eligible,
        newUserStatus: eligibility.status,
        newUserProjectId: eligibility.projectId ?? null,
        newUserClaimedAt: eligibility.claimedAt ?? null,
      },
      overview,
      claims: claimsWithProject,
      lotteryRecords: lotteryRecords || [],
      exchangeLogs: exchangeLogs || [],
      achievements,
    });
  } catch (error) {
    console.error("Get user detail error:", error);
    return NextResponse.json(
      { success: false, message: "获取用户详情失败" },
      { status: 500 }
    );
  }
});
