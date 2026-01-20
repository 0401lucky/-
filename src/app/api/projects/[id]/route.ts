import { NextRequest, NextResponse } from "next/server";
import { getProject, claimCode, getClaimRecord, hasUserClaimedAny, recordUser } from "@/lib/kv";
import { getAuthUser } from "@/lib/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await getProject(id);

    if (!project) {
      return NextResponse.json(
        { success: false, message: "项目不存在" },
        { status: 404 }
      );
    }

    // 检查用户是否已领取
    const user = await getAuthUser();
    let claimRecord = null;
    
    if (user) {
      claimRecord = await getClaimRecord(id, user.id);
    }

    return NextResponse.json({
      success: true,
      project,
      claimed: claimRecord ? { code: claimRecord.code, claimedAt: claimRecord.claimedAt } : null,
    });
  } catch (error) {
    console.error("Get project error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目失败" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "请先登录" },
        { status: 401 }
      );
    }

    // 获取项目检查是否仅限新用户
    const project = await getProject(id);
    if (project?.newUserOnly) {
      const hasClaimed = await hasUserClaimedAny(user.id);
      if (hasClaimed) {
        return NextResponse.json(
          { success: false, message: "该福利仅限新用户领取" },
          { status: 403 }
        );
      }
    }

    const result = await claimCode(id, user.id, user.username);

    // 领取成功后记录用户
    if (result.success) {
      await recordUser(user.id, user.username);
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    console.error("Claim code error:", error);
    return NextResponse.json(
      { success: false, message: "领取失败" },
      { status: 500 }
    );
  }
}
