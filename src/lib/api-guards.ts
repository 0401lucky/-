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

export type AuthGuardHandler<TRequest extends Request = Request, TContext = unknown> = (
  request: TRequest,
  user: AuthUser,
  context: TContext
) => Promise<NextResponse>;

export function withAuth<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandler<TRequest, TContext>,
  options: AuthGuardOptions = {}
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

    return handler(request, user, context);
  };
}

export function withAdmin<TRequest extends Request = Request, TContext = unknown>(
  handler: AuthGuardHandler<TRequest, TContext>,
  options: AdminGuardOptions = {}
): (request: TRequest, context: TContext) => Promise<NextResponse> {
  const {
    unauthorizedMessage = "请先登录",
    unauthorizedStatus = 401,
    forbiddenMessage = "无权限",
    forbiddenStatus = 403,
  } = options;

  return withAuth(
    async (request, user, context) => {
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
