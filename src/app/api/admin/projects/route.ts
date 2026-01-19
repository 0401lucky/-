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

    return NextResponse.json({
      success: true,
      projects,
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
    const maxClaims = parseInt(formData.get("maxClaims") as string) || 100;
    const codesFile = formData.get("codes") as File | null;

    if (!name) {
      return NextResponse.json(
        { success: false, message: "项目名称不能为空" },
        { status: 400 }
      );
    }

    // 解析兑换码文件
    let codes: string[] = [];
    if (codesFile) {
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
      codesCount: codes.length,
      status: "active",
      createdAt: Date.now(),
      createdBy: user!.username,
    };

    await createProject(project);

    if (codes.length > 0) {
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
