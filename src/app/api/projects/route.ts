import { NextResponse } from "next/server";
import { getAllProjects } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await getAllProjects();
    
    // 只返回非暂停状态的项目给普通用户
    const activeProjects = projects.filter(p => p.status !== "paused");
    
    return NextResponse.json({
      success: true,
      projects: activeProjects,
    });
  } catch (error) {
    console.error("Get projects error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目列表失败" },
      { status: 500 }
    );
  }
}
