// src/lib/types/result.ts
// 统一的结果类型定义

/**
 * 统一的操作结果类型
 * 用于标准化所有函数的返回值格式
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E; code?: ErrorCode };

/**
 * 错误码枚举
 */
export enum ErrorCode {
  // 通用错误
  UNKNOWN = 'UNKNOWN',
  INVALID_INPUT = 'INVALID_INPUT',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  RATE_LIMITED = 'RATE_LIMITED',

  // 业务错误
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  DAILY_LIMIT_REACHED = 'DAILY_LIMIT_REACHED',
  ALREADY_CLAIMED = 'ALREADY_CLAIMED',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
  CONFIG_ERROR = 'CONFIG_ERROR',

  // 系统错误
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

/**
 * 创建成功结果的辅助函数
 */
export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * 创建失败结果的辅助函数
 */
export function err<E = string>(error: E, code?: ErrorCode): Result<never, E> {
  return { success: false, error, code };
}

/**
 * 判断结果是否成功
 */
export function isOk<T, E>(result: Result<T, E>): result is { success: true; data: T } {
  return result.success;
}

/**
 * 判断结果是否失败
 */
export function isErr<T, E>(result: Result<T, E>): result is { success: false; error: E; code?: ErrorCode } {
  return !result.success;
}

/**
 * 从 Result 中提取数据，失败时抛出异常
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data;
  }
  throw new Error(String(result.error));
}

/**
 * 从 Result 中提取数据，失败时返回默认值
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.success) {
    return result.data;
  }
  return defaultValue;
}
