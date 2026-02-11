import { NextResponse } from "next/server";
import { getAllProjects, updateProject, getAvailableCodesCount } from "@/lib/kv";
import { withAdmin } from "@/lib/api-guards";

export const dynamic = "force-dynamic";

/**
 * 修复项目的 codesCount 字段
 * 之前的 bug 导致 codesCount 被计算了两次（创建时设置一次 + addCodesToProject 又加一次）
 * 此 API 将根据实际可用兑换码数量 + 已领取数量来重新计算正确的 codesCount
 * 
 * 安全措施：需要设置环境变量 ENABLE_FIX_CODES_COUNT=true 才能使用
 * 使用完成后建议删除此文件
 */
export const POST = withAdmin(
  async () => {
    try {
      // 环境变量开关检查（数据已修复，此接口已禁用）
      if (process.env.ENABLE_FIX_CODES_COUNT !== "true") {
        return NextResponse.json(
          { success: false, message: "此接口已禁用。请设置环境变量 ENABLE_FIX_CODES_COUNT=true 启用。" },
          { status: 403 }
        );
      }

      const projects = await getAllProjects();
      const results: Array<{
        id: string;
        name: string;
        oldCount: number;
        newCount: number;
        fixed: boolean;
      }> = [];

      for (const project of projects) {
        // 直充项目不依赖兑换码库存，跳过
        if (project.rewardType === "direct") {
          results.push({
            id: project.id,
            name: project.name,
            oldCount: project.codesCount,
            newCount: project.codesCount,
            fixed: false,
          });
          continue;
        }
        // 获取当前可用的兑换码数量
        const availableCodes = await getAvailableCodesCount(project.id);
        // 正确的 codesCount = 可用数量 + 已领取数量
        const correctCount = availableCodes + project.claimedCount;

        if (project.codesCount !== correctCount) {
          await updateProject(project.id, { codesCount: correctCount });
          results.push({
            id: project.id,
            name: project.name,
            oldCount: project.codesCount,
            newCount: correctCount,
            fixed: true,
          });
        } else {
          results.push({
            id: project.id,
            name: project.name,
            oldCount: project.codesCount,
            newCount: correctCount,
            fixed: false,
          });
        }
      }

      const fixedCount = results.filter((r) => r.fixed).length;

      return NextResponse.json({
        success: true,
        message: `修复完成，共修复 ${fixedCount} 个项目`,
        results,
      });
    } catch (error) {
      console.error("Fix codes count error:", error);
      return NextResponse.json(
        { success: false, message: "修复失败" },
        { status: 500 }
      );
    }
  },
  { forbiddenMessage: "无权限操作" }
);
