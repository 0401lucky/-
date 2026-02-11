import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";
import { getAuthUser, type AuthUser } from "./auth";

export interface RateLimitConfig {
  /** 时间窗口（秒），默认 60 */
  windowSeconds?: number;
  /** 窗口内最大请求数，默认 10 */
  maxRequests?: number;
  /** 限制标识前缀 */
  prefix?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_WINDOW = 60; // 1 分钟
const DEFAULT_MAX_REQUESTS = 10;

/**
 * 预定义的速率限制规则
 */
export const RATE_LIMITS = {
  // 认证相关
  'auth:login:ip': { windowSeconds: 60, maxRequests: 5, prefix: 'ratelimit:auth:login:ip' },
  'auth:login:user': { windowSeconds: 60 * 60, maxRequests: 10, prefix: 'ratelimit:auth:login:user' },

  // 抽奖相关
  'lottery:spin': { windowSeconds: 60, maxRequests: 10, prefix: 'ratelimit:lottery:spin' },
  'lottery:records': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:lottery:records' },

  // 卡牌相关
  'cards:purchase': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:cards:purchase' },
  'cards:exchange': { windowSeconds: 60, maxRequests: 20, prefix: 'ratelimit:cards:exchange' },

  // 游戏相关
  'game:start': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:game:start' },
  'game:submit': { windowSeconds: 60, maxRequests: 60, prefix: 'ratelimit:game:submit' },
  'slot:spin': { windowSeconds: 60, maxRequests: 120, prefix: 'ratelimit:slot:spin' },

  // 兑换码相关
  'project:claim': { windowSeconds: 60, maxRequests: 10, prefix: 'ratelimit:project:claim' },

  // 商店相关
  'store:exchange': { windowSeconds: 60, maxRequests: 20, prefix: 'ratelimit:store:exchange' },

  // 签到
  'checkin': { windowSeconds: 60, maxRequests: 5, prefix: 'ratelimit:checkin' },

  // 排行榜
  'rankings:games': { windowSeconds: 60, maxRequests: 40, prefix: 'ratelimit:rankings:games' },
  'rankings:points': { windowSeconds: 60, maxRequests: 40, prefix: 'ratelimit:rankings:points' },
  'rankings:checkin': { windowSeconds: 60, maxRequests: 40, prefix: 'ratelimit:rankings:checkin' },
  'rankings:history': { windowSeconds: 60, maxRequests: 40, prefix: 'ratelimit:rankings:history' },
  'rankings:settle': { windowSeconds: 60, maxRequests: 20, prefix: 'ratelimit:rankings:settle' },

  // 通知与公告
  'notifications:list': { windowSeconds: 60, maxRequests: 60, prefix: 'ratelimit:notifications:list' },
  'notifications:read': { windowSeconds: 60, maxRequests: 60, prefix: 'ratelimit:notifications:read' },
  'announcements:list': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:announcements:list' },
  'announcements:admin': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:announcements:admin' },

  // 个人主页与运营看板
  'profile:overview': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:profile:overview' },
  'admin:dashboard': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:admin:dashboard' },
  'admin:alerts': { windowSeconds: 60, maxRequests: 30, prefix: 'ratelimit:admin:alerts' },

  // 通用 API
  'api:default': { windowSeconds: 60, maxRequests: 100, prefix: 'ratelimit:api' },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/**
 * 检查速率限制（原子操作）
 * 使用滑动窗口计数器算法
 */
export async function checkRateLimit(
  userId: string,
  config: RateLimitConfig = {}
): Promise<RateLimitResult> {
  const {
    windowSeconds = DEFAULT_WINDOW,
    maxRequests = DEFAULT_MAX_REQUESTS,
    prefix = "ratelimit:cards",
  } = config;

  const key = `${prefix}:${userId}`;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowSeconds;

  // Lua 脚本：原子性地清理过期记录、检查限制、添加新记录
  const luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local windowStart = tonumber(ARGV[2])
    local maxRequests = tonumber(ARGV[3])
    local windowSeconds = tonumber(ARGV[4])

    -- 清理过期的请求记录
    redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)

    -- 获取当前窗口内的请求数
    local currentCount = redis.call('ZCARD', key)

    if currentCount >= maxRequests then
      -- 超过限制，返回失败
      local oldestScore = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
      local resetAt = now + windowSeconds
      if #oldestScore >= 2 then
        resetAt = tonumber(oldestScore[2]) + windowSeconds
      end
      return {0, maxRequests - currentCount, resetAt}
    end

    -- 添加新请求记录
    redis.call('ZADD', key, now, now .. ':' .. math.random(1000000))
    
    -- 设置过期时间（窗口时间 + 1秒缓冲）
    redis.call('EXPIRE', key, windowSeconds + 1)

    return {1, maxRequests - currentCount - 1, now + windowSeconds}
  `;

  try {
    const raw = await kv.eval(
      luaScript,
      [key],
      [now, windowStart, maxRequests, windowSeconds]
    );

    if (!Array.isArray(raw) || raw.length < 3) {
      throw new Error("Invalid rate limit response");
    }

    const [successRaw, remainingRaw, resetAtRaw] = raw as unknown[];
    const success = Number(successRaw);
    const remaining = Number(remainingRaw);
    const resetAt = Number(resetAtRaw);

    if (!Number.isFinite(success) || !Number.isFinite(remaining) || !Number.isFinite(resetAt)) {
      throw new Error("Invalid rate limit response");
    }

    return {
      success: success === 1,
      remaining: Math.max(0, Math.floor(remaining)),
      resetAt: Math.floor(resetAt),
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // 出错时默认允许请求（fail-open）
    return {
      success: true,
      remaining: maxRequests,
      resetAt: now + windowSeconds,
    };
  }
}

/**
 * 创建速率限制错误响应
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = Number.isFinite(result.resetAt) ? result.resetAt : now + DEFAULT_WINDOW;
  const remaining = Number.isFinite(result.remaining) ? result.remaining : 0;
  const retryAfter = Math.max(1, resetAt - now);
  
  return NextResponse.json(
    {
      success: false,
      message: "请求过于频繁，请稍后再试",
      retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfter.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": resetAt.toString(),
      },
    }
  );
}

/**
 * 使用预定义规则检查速率限制
 * @param action 预定义的操作类型
 * @param userId 用户标识
 */

export interface UserRateLimitOptions {
  unauthorizedMessage?: string;
  unauthorizedStatus?: number;
}

export type UserRateLimitHandler<TRequest extends Request = Request, TContext = unknown> = (
  request: TRequest,
  user: AuthUser,
  context: TContext
) => Promise<NextResponse>;

/**
 * 鉴权 + 速率限制 HOF
 * 统一处理：未登录响应、速率限制拦截、通过后回调业务处理器
 */
export function withUserRateLimit<TRequest extends Request = Request, TContext = unknown>(
  action: RateLimitAction,
  handler: UserRateLimitHandler<TRequest, TContext>,
  options: UserRateLimitOptions = {}
): (request: TRequest, context: TContext) => Promise<NextResponse> {
  const {
    unauthorizedMessage = "未登录",
    unauthorizedStatus = 401,
  } = options;

  return async (request: TRequest, context: TContext): Promise<NextResponse> => {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: unauthorizedMessage },
        { status: unauthorizedStatus }
      );
    }

    const limitedResponse = await withRateLimit(action, user.id);
    if (limitedResponse) {
      return limitedResponse;
    }

    return handler(request, user, context);
  };
}

export async function checkRateLimitByAction(
  action: RateLimitAction,
  userId: string | number
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  return checkRateLimit(String(userId), config);
}

/**
 * 速率限制中间件辅助函数
 * 返回 null 表示通过，返回 NextResponse 表示被限制
 */
export async function withRateLimit(
  action: RateLimitAction,
  userId: string | number
): Promise<NextResponse | null> {
  const result = await checkRateLimitByAction(action, userId);
  if (!result.success) {
    return rateLimitResponse(result);
  }
  return null;
}




