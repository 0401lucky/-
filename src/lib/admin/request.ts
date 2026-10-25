export async function adminRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new Error('网络连接失败，请检查连接后重试');
  }
  let data: T & { success?: boolean; message?: string; error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error(
      response.status === 401
        ? '登录已过期，请重新登录'
        : '服务器响应异常，请稍后重试',
    );
  }
  if (!response.ok || !data?.success)
    throw new Error(
      data?.message ||
        data?.error ||
        (response.status === 401
          ? '登录已过期，请重新登录'
          : '操作失败，请稍后重试'),
    );
  return data;
}
