import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { createProject, getAllProjects, addCodesToProject, type Project } from "@/lib/kv";
import { generateId } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    const projects = await getAllProjects();
    const sortedProjects = [...projects].sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0;
      const bPinned = b.pinned ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      const aPinnedAt = a.pinnedAt ?? 0;
      const bPinnedAt = b.pinnedAt ?? 0;
      if (aPinnedAt !== bPinnedAt) return bPinnedAt - aPinnedAt;

      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });

    return NextResponse.json({
      success: true,
      projects: sortedProjects,
    });
  } catch (error) {
    console.error("Get admin projects error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目列表失败" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const name = formData.get("name") as string;
    const description = formData.get("description") as string || "";
    const maxClaimsParsed = parseInt(formData.get("maxClaims") as string, 10);
    const maxClaims = Number.isFinite(maxClaimsParsed) ? maxClaimsParsed : 100;
    const codesFile = formData.get("codes") as File | null;
    const newUserOnly = formData.get("newUserOnly") === "true";
    const rewardTypeRaw = (formData.get("rewardType") as string | null) || "code";
    const rewardType = rewardTypeRaw === "direct" ? "direct" : "code";
    const directDollarsRaw = formData.get("directDollars") as string | null;
    const directDollars = directDollarsRaw ? parseFloat(directDollarsRaw) : undefined;

    if (!name) {
      return NextResponse.json(
        { success: false, message: "项目名称不能为空" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(maxClaims) || maxClaims < 1) {
      return NextResponse.json(
        { success: false, message: "限领人数必须是正整数（≥1）" },
        { status: 400 }
      );
    }
    if (rewardType === "direct") {
      if (!Number.isFinite(directDollars) || (directDollars as number) <= 0) {
        return NextResponse.json(
          { success: false, message: "直充金额必须是正数" },
          { status: 400 }
        );
      }
    }

    // 解析兑换码文件
    let codes: string[] = [];
    if (rewardType === "code" && codesFile) {
      const text = await codesFile.text();
      codes = text
        .split(/[\r\n]+/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
    }

    const projectId = generateId();
    const project: Project = {
      id: projectId,
      name,
      description,
      maxClaims,
      claimedCount: 0,
      codesCount: rewardType === "direct" ? maxClaims : 0,  // 直充项目用作名额总量；兑换码项目由 addCodesToProject 统一处理计数
      status: "active",
      createdAt: Date.now(),
      createdBy: user!.username,
      rewardType,
      directDollars: rewardType === "direct" ? (directDollars as number) : undefined,
      newUserOnly,
    };

    await createProject(project);

    if (rewardType === "code" && codes.length > 0) {
      await addCodesToProject(projectId, codes);
    }

    return NextResponse.json({
      success: true,
      message: "项目创建成功",
      project,
      codesAdded: codes.length,
    });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json(
      { success: false, message: "创建项目失败" },
      { status: 500 }
    );
  }
}
