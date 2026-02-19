/**
 * 游戏路由工厂函数
 *
 * 将 cancel / start 路由中重复的 认证、限流、dailyStats 获取、错误处理 等模板代码
 * 统一收敛到两个工厂函数中，各游戏路由只需提供差异化的业务逻辑。
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, type AuthUser } from './auth';
import { getDailyStats } from './daily-stats';
import { getDailyPointsLimit } from './config';
import { withUserRateLimit, type RateLimitAction } from './rate-limit';
import type { DailyGameStats } from './types/game';

// ---------------------------------------------------------------------------
// Cancel 路由工厂
// ---------------------------------------------------------------------------

type CancelGameFn = (userId: number) => Promise<{ success: boolean; message?: string }>;

/**
 * 创建标准的游戏取消路由处理器。
 *
 * 内部统一处理：认证校验 → 调用 cancelFn → 格式化响应 → 错误兜底。
 */
export function createCancelRoute(
  cancelFn: CancelGameFn,
  logLabel = 'game',
) {
  async function POST() {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
    }

    try {
      const result = await cancelFn(user.id);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: '游戏已取消' });
    } catch (error) {
      console.error(`Cancel ${logLabel} error:`, error);
      return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
    }
  }

  return { POST };
}

// ---------------------------------------------------------------------------
// Start 路由工厂
// ---------------------------------------------------------------------------

/** 工厂注入给业务 handler 的预处理上下文 */
export interface StartRouteContext {
  user: AuthUser;
  dailyStats: DailyGameStats;
  dailyPointsLimit: number;
  pointsLimitReached: boolean;
}

/**
 * 业务 handler —— 返回成功时要写入 `data` 的对象，
 * 或者直接返回一个 NextResponse（用于提前中断，如参数校验失败）。
 */
type StartGameHandler = (
  request: NextRequest,
  ctx: StartRouteContext,
) => Promise<NextResponse | Record<string, unknown>>;

interface StartRouteOptions {
  /** 限流动作，默认 'game:start' */
  rateLimitAction?: RateLimitAction;
  /** 未登录提示文案 */
  unauthorizedMessage?: string;
  /** 日志标签 */
  logLabel?: string;
}

/**
 * 创建标准的游戏开始路由处理器。
 *
 * 统一处理：鉴权 + 限流（withUserRateLimit）→ 获取 dailyStats / dailyPointsLimit →
 * 调用业务 handler → 包装成 `{ success, data }` 响应 → 错误兜底。
 *
 * handler 返回一个普通对象时，工厂自动包装为 `{ success: true, data: { ...obj } }`；
 * handler 也可以直接返回 NextResponse 来完全控制响应（例如参数校验失败返回 400）。
 */
export function createStartRoute(
  handler: StartGameHandler,
  options: StartRouteOptions = {},
) {
  const {
    rateLimitAction = 'game:start',
    unauthorizedMessage = '请先登录',
    logLabel = 'game',
  } = options;

  const POST = withUserRateLimit(
    rateLimitAction,
    async (request: NextRequest, user: AuthUser) => {
      try {
        const [dailyStats, dailyPointsLimit] = await Promise.all([
          getDailyStats(user.id),
          getDailyPointsLimit(),
        ]);

        const pointsLimitReached = dailyStats.pointsEarned >= dailyPointsLimit;

        const result = await handler(request, {
          user,
          dailyStats,
          dailyPointsLimit,
          pointsLimitReached,
        });

        // handler 直接返回 NextResponse —— 透传
        if (result instanceof NextResponse) {
          return result;
        }

        // 普通对象 —— 包装成功响应
        return NextResponse.json({ success: true, data: result });
      } catch (error) {
        console.error(`Start ${logLabel} error:`, error);
        return NextResponse.json({ success: false, message: '服务器错误' }, { status: 500 });
      }
    },
    { unauthorizedMessage },
  );

  return { POST };
}

/** 用于 handler 中快速返回失败响应的辅助函数 */
export function fail(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}
