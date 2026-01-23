import { NextResponse } from "next/server";
import { getAllProjects } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const projects = await getAllProjects();
    
    // 只返回非暂停状态的项目给普通用户
    const activeProjects = projects.filter(p => p.status !== "paused");
    const sortedProjects = [...activeProjects].sort((a, b) => {
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
    console.error("Get projects error:", error);
    return NextResponse.json(
      { success: false, message: "获取项目列表失败" },
      { status: 500 }
    );
  }
}
