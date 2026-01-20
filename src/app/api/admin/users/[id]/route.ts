import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getUserAllClaims, getAllProjects } from "@/lib/kv";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

interface LotteryRecord {
  lotteryId: string;
  lotteryName: string;
  prizeId: string;
  prizeName: string;
  wonAt: number;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { success: false, message: "无效的用户ID" },
        { status: 400 }
      );
    }

    // 获取兑换码领取记录
    const claims = await getUserAllClaims(userId);
    const projects = await getAllProjects();
    
    // 为领取记录添加项目名称
    const claimsWithProject = claims.map(claim => {
      const project = projects.find(p => p.id === claim.projectId);
      return {
        ...claim,
        projectName: project?.name || '未知项目',
      };
    });

    // 获取抽奖记录
    const lotteryRecords = await kv.lrange<LotteryRecord>(`lottery:user:records:${userId}`, 0, -1) || [];

    return NextResponse.json({
      success: true,
      claims: claimsWithProject,
      lotteryRecords,
    });
  } catch (error) {
    console.error("Get user detail error:", error);
    return NextResponse.json(
      { success: false, message: "获取用户详情失败" },
      { status: 500 }
    );
  }
}
