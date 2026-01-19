import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getProject, updateProject, deleteProject, addCodesToProject, getProjectRecords } from "@/lib/kv";

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
    const project = await getProject(id);

    if (!project) {
      return NextResponse.json(
        { success: false, message: "项目不存在" },
        { status: 404 }
      );
    }

    const records = await getProjectRecords(id);

    return NextResponse.json({
      success: true,
      project,
      records,
    });
  } catch (error) {
    console.error("Get admin project error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目失败" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const project = await getProject(id);

    if (!project) {
      return NextResponse.json(
        { success: false, message: "项目不存在" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const updates: Partial<typeof project> = {};

    if (body.status && ["active", "paused"].includes(body.status)) {
      updates.status = body.status;
    }
    if (body.name) {
      updates.name = body.name;
    }
    if (body.description !== undefined) {
      updates.description = body.description;
    }
    if (body.maxClaims && typeof body.maxClaims === "number") {
      updates.maxClaims = body.maxClaims;
    }

    await updateProject(id, updates);

    return NextResponse.json({
      success: true,
      message: "项目更新成功",
    });
  } catch (error) {
    console.error("Update project error:", error);
    return NextResponse.json(
      { success: false, message: "更新项目失败" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const { id } = await params;
    await deleteProject(id);

    return NextResponse.json({
      success: true,
      message: "项目已删除",
    });
  } catch (error) {
    console.error("Delete project error:", error);
    return NextResponse.json(
      { success: false, message: "删除项目失败" },
      { status: 500 }
    );
  }
}

// 追加兑换码
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const project = await getProject(id);

    if (!project) {
      return NextResponse.json(
        { success: false, message: "项目不存在" },
        { status: 404 }
      );
    }

    const formData = await request.formData();
    const codesFile = formData.get("codes") as File | null;

    if (!codesFile) {
      return NextResponse.json(
        { success: false, message: "请上传兑换码文件" },
        { status: 400 }
      );
    }

    const text = await codesFile.text();
    const codes = text
      .split(/[\r\n]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (codes.length === 0) {
      return NextResponse.json(
        { success: false, message: "文件中没有有效的兑换码" },
        { status: 400 }
      );
    }

    await addCodesToProject(id, codes);

    return NextResponse.json({
      success: true,
      message: `成功添加 ${codes.length} 个兑换码`,
      codesAdded: codes.length,
    });
  } catch (error) {
    console.error("Add codes error:", error);
    return NextResponse.json(
      { success: false, message: "添加兑换码失败" },
      { status: 500 }
    );
  }
}
