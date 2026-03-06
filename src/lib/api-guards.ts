import { NextResponse } from "next/server";
import { getAuthUser, type AuthUser } from "./auth";

export interface AuthGuardOptions {
  unauthorizedMessage?: string;
  unauthorizedStatus?: number;
}

export interface AdminGuardOptions extends AuthGuardOptions {
  forbiddenMessage?: string;
  forbiddenStatus?: number;
}

export type AuthGuardHandler<TRequest extends Request = Request> = (
  request: TRequest,
  user: AuthUser,
) => Promise<NextResponse>;

export type AuthGuardHandlerWithContext<TRequest extends Request = Request, TContext = unknown> = (
  request: TRequest,
  user: AuthUser,
  context: TContext
) => Promise<NextResponse>;

type GuardedHandler<TRequest extends Request, TContext> = (
  request: TRequest,
  context: TContext
) => Promise<NextResponse>;

type GuardedHandlerNoContext<TRequest extends Request> = (
  request: TRequest,
) => Promise<NextResponse>;

export function withAuth<TRequest extends Request = Request>(
  handler: AuthGuardHandler<TRequest>,
  options?: AuthGuardOptions,
): GuardedHandlerNoContext<TRequest>;

export function withAuth<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandlerWithContext<TRequest, TContext>,
  options?: AuthGuardOptions,
): GuardedHandler<TRequest, TContext>;

export function withAuth<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandler<TRequest> | AuthGuardHandlerWithContext<TRequest, TContext>,
  options: AuthGuardOptions = {}
): GuardedHandlerNoContext<TRequest> | GuardedHandler<TRequest, TContext> {
  const {
    unauthorizedMessage = "未登录",
    unauthorizedStatus = 401,
  } = options;

  return (async (request: TRequest, context?: TContext): Promise<NextResponse> => {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: unauthorizedMessage },
        { status: unauthorizedStatus }
      );
    }

    try {
      return await (handler as AuthGuardHandlerWithContext<TRequest, TContext>)(
        request,
        user,
        context as TContext,
      );
    } catch (error) {
      console.error('API handler error:', error);
      return NextResponse.json(
        { success: false, message: '服务器错误' },
        { status: 500 }
      );
    }
  }) as GuardedHandlerNoContext<TRequest> | GuardedHandler<TRequest, TContext>;
}

export function withAdmin<TRequest extends Request = Request>(
  handler: AuthGuardHandler<TRequest>,
  options?: AdminGuardOptions,
): GuardedHandlerNoContext<TRequest>;

export function withAdmin<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandlerWithContext<TRequest, TContext>,
  options?: AdminGuardOptions,
): GuardedHandler<TRequest, TContext>;

export function withAdmin<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandler<TRequest> | AuthGuardHandlerWithContext<TRequest, TContext>,
  options: AdminGuardOptions = {}
): GuardedHandlerNoContext<TRequest> | GuardedHandler<TRequest, TContext> {
  const {
    unauthorizedMessage = "请先登录",
    unauthorizedStatus = 401,
    forbiddenMessage = "无权限",
    forbiddenStatus = 403,
  } = options;

  return withAuth(
    async (request: TRequest, user: AuthUser, context: TContext) => {
      if (!user.isAdmin) {
        return NextResponse.json(
          { success: false, message: forbiddenMessage },
          { status: forbiddenStatus }
        );
      }

      return handler(request, user, context);
    },
    { unauthorizedMessage, unauthorizedStatus }
  );
}
