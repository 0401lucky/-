import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getAllProjects, getProjectRecords } from "@/lib/kv";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";

/**
 * 从现有领取记录中同步用户数据
 * 遍历所有项目的领取记录和抽奖记录，将用户添加到用户列表
 */
export async function POST() {
  try {
    const user = await getAuthUser();
    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限操作" },
        { status: 403 }
      );
    }

    const syncedUsers = new Set<string>();

    // 1. 从项目领取记录中同步
    const projects = await getAllProjects();
    for (const project of projects) {
      const records = await getProjectRecords(project.id, 0, -1);
      for (const record of records) {
        const key = `${record.userId}`;
        if (!syncedUsers.has(key)) {
          // 使用领取时间作为 firstSeen（如果用户不存在）
          const existing = await kv.get(`user:${record.userId}`);
          if (!existing) {
            await kv.set(`user:${record.userId}`, {
              id: record.userId,
              username: record.username,
              firstSeen: record.claimedAt
            });
            await kv.sadd('users:all', record.userId);
          }
          syncedUsers.add(key);
        }
      }
    }

    // 2. 从抽奖记录中同步
    const lotteryRecords = await kv.lrange('lottery:records', 0, -1);
    if (lotteryRecords) {
      for (const record of lotteryRecords as any[]) {
        const key = `${record.oderId}`;
        if (!syncedUsers.has(key)) {
          const existing = await kv.get(`user:${record.oderId}`);
          if (!existing) {
            await kv.set(`user:${record.oderId}`, {
              id: record.oderId,
              username: record.username,
              firstSeen: record.createdAt
            });
            await kv.sadd('users:all', record.oderId);
          }
          syncedUsers.add(key);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `同步完成，共同步 ${syncedUsers.size} 个用户`,
      count: syncedUsers.size
    });
  } catch (error) {
    console.error("Sync users error:", error);
    return NextResponse.json(
      { success: false, message: "同步失败" },
      { status: 500 }
    );
  }
}
