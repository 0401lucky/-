import { NextRequest, NextResponse } from "next/server";
import { withAdmin } from "@/lib/api-guards";
import { createProject, getAllProjects, type Project } from "@/lib/kv";
import { generateId } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const GET = withAdmin(async () => {
  try {
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
});

export const POST = withAdmin(async (request: NextRequest, user) => {
  try {
    const formData = await request.formData();
    const name = formData.get("name") as string;
    const description = formData.get("description") as string || "";
    const maxClaimsParsed = parseInt(formData.get("maxClaims") as string, 10);
    const maxClaims = Number.isFinite(maxClaimsParsed) ? maxClaimsParsed : 100;
    const newUserOnly = formData.get("newUserOnly") === "true";
    const directPointsRaw = formData.get("directPoints") as string | null;
    const directPoints = directPointsRaw ? Number.parseInt(directPointsRaw, 10) : NaN;

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
    if (!Number.isSafeInteger(directPoints) || directPoints <= 0) {
      return NextResponse.json(
        { success: false, message: "直充积分必须是正整数" },
        { status: 400 }
      );
    }

    const projectId = generateId();
    const project: Project = {
      id: projectId,
      name,
      description,
      maxClaims,
      claimedCount: 0,
      codesCount: maxClaims,
      status: "active",
      createdAt: Date.now(),
      createdBy: user.username,
      rewardType: "direct",
      directPoints,
      newUserOnly,
    };

    await createProject(project);

    return NextResponse.json({
      success: true,
      message: "项目创建成功",
      project,
      codesAdded: 0,
    });
  } catch (error) {
    console.error("Create project error:", error);
    return NextResponse.json(
      { success: false, message: "创建项目失败" },
      { status: 500 }
    );
  }
});
