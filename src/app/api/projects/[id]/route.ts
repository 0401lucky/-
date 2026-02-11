import { NextRequest, NextResponse } from "next/server";
import {
  getProject,
  claimCode,
  getClaimRecord,
  reserveNewUserBenefit,
  confirmNewUserBenefit,
  rollbackNewUserBenefit,
  recordUser,
  reserveDirectClaim,
  finalizeDirectClaim,
  rollbackDirectClaim,
} from "@/lib/kv";
import { getAuthUser } from "@/lib/auth";
import { creditQuotaToUser } from "@/lib/new-api";
import { withUserRateLimit } from "@/lib/rate-limit";

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
      claimed: claimRecord ? {
        code: claimRecord.code,
        claimedAt: claimRecord.claimedAt,
        directCredit: claimRecord.directCredit,
        creditedDollars: claimRecord.creditedDollars,
        creditStatus: claimRecord.creditStatus,
        creditMessage: claimRecord.creditMessage,
      } : null,
    });
  } catch (error) {
    console.error("Get project error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目失败" },
      { status: 500 }
    );
  }
}

export const POST = withUserRateLimit(
  "project:claim",
  async (
    _request: NextRequest,
    user,
    { params }: { params: Promise<{ id: string }> }
  ) => {
  let reservedNewUserBenefit = false;
  let reservedUserId: number | null = null;
  let reservedProjectId: string | null = null;

  try {
    const { id } = await params;

    const project = await getProject(id);
    if (!project) {
      return NextResponse.json(
        { success: false, message: "项目不存在" },
        { status: 404 }
      );
    }

    if (
      project.rewardType === "direct" &&
      (!Number.isFinite(project.directDollars) || (project.directDollars as number) <= 0)
    ) {
      return NextResponse.json(
        { success: false, message: "项目直充金额配置异常，请联系管理员" },
        { status: 500 }
      );
    }

    const rollbackReservedNewUserBenefit = async () => {
      if (!reservedNewUserBenefit) return;
      try {
        await rollbackNewUserBenefit(user.id, id);
      } catch (rollbackError) {
        console.error("Rollback new user benefit failed:", rollbackError);
      } finally {
        reservedNewUserBenefit = false;
      }
    };

    const confirmReservedNewUserBenefit = async () => {
      if (!reservedNewUserBenefit) return;
      await confirmNewUserBenefit(user.id, id);
      reservedNewUserBenefit = false;
    };

    if (project.newUserOnly) {
      const reserveResult = await reserveNewUserBenefit(user.id, id);
      if (!reserveResult.success) {
        return NextResponse.json(
          { success: false, message: reserveResult.message },
          { status: reserveResult.status === "pending" ? 409 : 403 }
        );
      }
      reservedNewUserBenefit = true;
      reservedUserId = user.id;
      reservedProjectId = id;
    }

    // 直充项目：先原子预占名额，再调用 new-api 直充，最后落库/回滚
    if (project.rewardType === "direct") {

      const reserveResult = await reserveDirectClaim(id, user.id, user.username);
      if (!reserveResult.success) {
        await rollbackReservedNewUserBenefit();
        return NextResponse.json(
          { success: false, message: reserveResult.message || "领取失败" },
          { status: 400 }
        );
      }

      const existing = reserveResult.record;
      if (existing?.creditStatus === "success") {
        await confirmReservedNewUserBenefit();
        await recordUser(user.id, user.username);
        return NextResponse.json({
          success: true,
          message: reserveResult.message,
          directCredit: true,
          creditedDollars: existing.creditedDollars,
          creditStatus: "success",
        });
      }
      if (existing?.creditStatus === "uncertain") {
        await confirmReservedNewUserBenefit();
        await recordUser(user.id, user.username);
        return NextResponse.json({
          success: true,
          message: existing.creditMessage || "充值结果不确定，请稍后检查余额。如有问题请联系管理员",
          directCredit: true,
          creditedDollars: existing.creditedDollars,
          creditStatus: "uncertain",
          uncertain: true,
        });
      }
      if (existing?.creditStatus === "pending" && reserveResult.message.includes("处理中")) {
        return NextResponse.json({
          success: true,
          message: reserveResult.message,
          directCredit: true,
          creditedDollars: existing.creditedDollars,
          creditStatus: "pending",
        });
      }

      const creditResult = await creditQuotaToUser(user.id, project.directDollars as number) as {
        success: boolean;
        message: string;
        newQuota?: number;
        uncertain?: boolean;
      };

      if (creditResult.uncertain) {
        await finalizeDirectClaim(id, user.id, "uncertain", creditResult.message);
        await confirmReservedNewUserBenefit();
        await recordUser(user.id, user.username);
        return NextResponse.json({
          success: true,
          message: "充值结果不确定，请稍后检查余额。如有问题请联系管理员",
          directCredit: true,
          creditedDollars: project.directDollars,
          creditStatus: "uncertain",
          uncertain: true,
        });
      }

      if (!creditResult.success) {
        await rollbackDirectClaim(id, user.id);
        await rollbackReservedNewUserBenefit();
        return NextResponse.json(
          { success: false, message: creditResult.message || "充值失败，请稍后重试" },
          { status: 400 }
        );
      }

      await finalizeDirectClaim(id, user.id, "success", creditResult.message);
      await confirmReservedNewUserBenefit();
      await recordUser(user.id, user.username);
      return NextResponse.json({
        success: true,
        message: `领取成功！已直充 $${project.directDollars} 到您的账户`,
        directCredit: true,
        creditedDollars: project.directDollars,
        creditStatus: "success",
      });
    }

    const result = await claimCode(id, user.id, user.username);

    // 领取成功后记录用户
    if (result.success) {
      await confirmReservedNewUserBenefit();
      await recordUser(user.id, user.username);
    } else {
      await rollbackReservedNewUserBenefit();
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
    });
  } catch (error) {
    if (reservedNewUserBenefit && reservedUserId !== null && reservedProjectId) {
      try {
        await rollbackNewUserBenefit(reservedUserId, reservedProjectId);
      } catch (rollbackError) {
        console.error("Rollback reserved new user benefit on exception failed:", rollbackError);
      }
    }

    console.error("Claim code error:", error);
    return NextResponse.json(
      { success: false, message: "领取失败" },
      { status: 500 }
    );
  }
  },
  { unauthorizedMessage: "请先登录" }
);


