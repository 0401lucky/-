import { NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getAllProjects, getProjectRecords, type User } from "@/lib/kv";
import { loginToNewApi, NEW_API_URL, type NewApiUser } from "@/lib/new-api";
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

    // 3. 从 new-api 同步用户状态/用户名（以 new-api 为准）
    let newApiUpdated = 0;
    let newApiRemoved = 0;
    let newApiFailed = 0;
    const adminUsername = process.env.NEW_API_ADMIN_USERNAME;
    const adminPassword = process.env.NEW_API_ADMIN_PASSWORD;
    if (adminUsername && adminPassword) {
      const adminLogin = await loginToNewApi(adminUsername, adminPassword);
      if (adminLogin.success && adminLogin.cookies && adminLogin.user?.id) {
        const adminCookies = adminLogin.cookies;
        const adminUserId = adminLogin.user.id;

        const userIdsRaw = (await kv.smembers('users:all')) as Array<string | number>;
        const userIds = userIdsRaw
          .map((v) => (typeof v === 'number' ? v : parseInt(String(v), 10)))
          .filter((id) => Number.isFinite(id) && id > 0);

        const syncOne = async (userId: number) => {
          try {
            const response = await fetch(`${NEW_API_URL}/api/user/${userId}`, {
              headers: {
                Cookie: adminCookies,
                'New-Api-User': String(adminUserId),
              },
            });

            if (!response.ok) {
              newApiFailed += 1;
              return;
            }

            const data = (await response.json()) as { success?: boolean; data?: NewApiUser };
            if (!data?.success || !data.data) {
              newApiFailed += 1;
              return;
            }

            const remoteUser = data.data;
            const existing = await kv.get<User>(`user:${userId}`);
            if (existing && existing.username !== remoteUser.username) {
              await kv.set(`user:${userId}`, { ...existing, username: remoteUser.username });
              newApiUpdated += 1;
            } else if (!existing) {
              await kv.set(`user:${userId}`, {
                id: userId,
                username: remoteUser.username,
                firstSeen: Date.now(),
              });
              newApiUpdated += 1;
            }

            // new-api：status==1 为启用，其他为禁用/注销
            if (remoteUser.status !== 1) {
              await kv.srem('users:all', userId);
              newApiRemoved += 1;
            }
          } catch (err) {
            console.error('Sync new-api user failed:', { userId, err });
            newApiFailed += 1;
          }
        };

        const CONCURRENCY = 10;
        for (let i = 0; i < userIds.length; i += CONCURRENCY) {
          const batch = userIds.slice(i, i + CONCURRENCY);
          await Promise.all(batch.map(syncOne));
        }
      } else {
        console.error('new-api admin login failed:', adminLogin.message);
      }
    } else {
      console.warn('NEW_API_ADMIN_USERNAME/NEW_API_ADMIN_PASSWORD not set, skip new-api sync');
    }

    return NextResponse.json({
      success: true,
      message: `同步完成：本地发现 ${syncedUsers.size} 个用户；new-api 更新 ${newApiUpdated} 个用户名；移除 ${newApiRemoved} 个已注销用户；失败 ${newApiFailed} 个`,
      count: syncedUsers.size,
      newApi: {
        updated: newApiUpdated,
        removed: newApiRemoved,
        failed: newApiFailed,
        baseUrl: NEW_API_URL,
      },
    });
  } catch (error) {
    console.error("Sync users error:", error);
    return NextResponse.json(
      { success: false, message: "同步失败" },
      { status: 500 }
    );
  }
}
