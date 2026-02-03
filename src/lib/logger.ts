// src/lib/logger.ts
// 结构化日志系统

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  userId?: number;
  action?: string;
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

// 日志级别优先级
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 从环境变量获取日志级别，默认为 info
const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatError(err: unknown): LogEntry['error'] | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    };
  }
  return { name: 'Unknown', message: String(err) };
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: unknown
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    context,
    error: formatError(error),
  };
}

function output(entry: LogEntry): void {
  // 生产环境输出 JSON 格式，便于日志聚合
  // 开发环境输出可读格式
  if (process.env.NODE_ENV === 'production') {
    const logFn = entry.level === 'error' ? console.error :
                  entry.level === 'warn' ? console.warn : console.log;
    logFn(JSON.stringify(entry));
  } else {
    const prefix = `[${entry.level.toUpperCase()}]`;
    const time = entry.timestamp.split('T')[1].split('.')[0];
    const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
    const err = entry.error ? ` Error: ${entry.error.message}` : '';

    const logFn = entry.level === 'error' ? console.error :
                  entry.level === 'warn' ? console.warn :
                  entry.level === 'debug' ? console.debug : console.log;
    logFn(`${time} ${prefix} ${entry.message}${ctx}${err}`);
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      output(createLogEntry('debug', message, context));
    }
  },

  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      output(createLogEntry('info', message, context));
    }
  },

  warn(message: string, context?: LogContext, error?: unknown): void {
    if (shouldLog('warn')) {
      output(createLogEntry('warn', message, context, error));
    }
  },

  error(message: string, context?: LogContext, error?: unknown): void {
    if (shouldLog('error')) {
      output(createLogEntry('error', message, context, error));
    }
  },

  // 创建带有预设上下文的子日志器
  child(defaultContext: LogContext) {
    return {
      debug: (msg: string, ctx?: LogContext) =>
        logger.debug(msg, { ...defaultContext, ...ctx }),
      info: (msg: string, ctx?: LogContext) =>
        logger.info(msg, { ...defaultContext, ...ctx }),
      warn: (msg: string, ctx?: LogContext, err?: unknown) =>
        logger.warn(msg, { ...defaultContext, ...ctx }, err),
      error: (msg: string, ctx?: LogContext, err?: unknown) =>
        logger.error(msg, { ...defaultContext, ...ctx }, err),
    };
  },
};

export default logger;
