import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, isAdmin } from "@/lib/auth";
import { getAllUsers } from "@/lib/kv";
import { getUserCardData } from "@/lib/cards/draw";

export const dynamic = "force-dynamic";

export interface UserWithCardStats {
  id: number;
  username: string;
  firstSeen: number;
  cardCount: number;
  fragments: number;
  drawsAvailable: number;
  pityCounter: number;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser();

    if (!isAdmin(user)) {
      return NextResponse.json(
        { success: false, message: "无权限访问" },
        { status: 403 }
      );
    }

    // 分页参数
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const search = searchParams.get("search") || "";

    const allUsers = await getAllUsers();
    
    // 按首次访问时间降序排序
    allUsers.sort((a, b) => b.firstSeen - a.firstSeen);
    
    // 搜索过滤
    let filteredUsers = allUsers;
    if (search.trim()) {
      const query = search.toLowerCase();
      filteredUsers = allUsers.filter(u => 
        u.username.toLowerCase().includes(query) ||
        u.id.toString().includes(query)
      );
    }
    
    // 计算分页
    const total = filteredUsers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedUsers = filteredUsers.slice(startIndex, endIndex);
    
    // 获取卡牌数据
    const usersWithStats: UserWithCardStats[] = await Promise.all(
      paginatedUsers.map(async (u) => {
        const cardData = await getUserCardData(u.id.toString());
        
        return {
          id: u.id,
          username: u.username,
          firstSeen: u.firstSeen,
          cardCount: cardData.inventory.length,
          fragments: cardData.fragments || 0,
          drawsAvailable: cardData.drawsAvailable,
          pityCounter: cardData.pityCounter,
        };
      })
    );

    return NextResponse.json({
      success: true,
      users: usersWithStats,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: endIndex < total,
      },
    });
  } catch (error) {
    console.error("Get card users error:", error);
    return NextResponse.json(
      { success: false, message: "获取用户列表失败" },
      { status: 500 }
    );
  }
}
