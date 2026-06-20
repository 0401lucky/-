import { kv } from '@/lib/d1-kv';

// 自定义昵称长度限制
export const CUSTOM_DISPLAY_NAME_MAX_LENGTH = 30;
export const CUSTOM_DISPLAY_NAME_MIN_LENGTH = 1;
// 头像数据上限（压缩后的 dataURL 或 http(s) URL）
// dataURL 96x96 WebP/JPEG 通常 < 12KB，留出冗余到 80KB
export const CUSTOM_AVATAR_MAX_LENGTH = 80 * 1024;
export const QQ_EMAIL_MAX_LENGTH = 254;

export interface CustomUserProfile {
  // 自定义显示名称，未设置时使用 session 中的 username
  displayName?: string;
  // 头像 URL：data:image/...;base64,xxx 或 https://xxx
  avatarUrl?: string;
  // QQ 邮箱：用于农场作物成熟邮件提醒
  qqEmail?: string;
  updatedAt?: number;
}

export interface PublicSessionUserProfile {
  username?: string;
  displayName?: string;
  updatedAt?: number;
}

function customProfileKey(userId: number): string {
  return `user:profile:custom:${userId}`;
}

function publicSessionProfileKey(userId: number): string {
  return `user:profile:session:${userId}`;
}

/**
 * 读取用户自定义资料；不存在时返回空对象（不报错）
 */
export async function getCustomUserProfile(userId: number): Promise<CustomUserProfile> {
  const raw = await kv.get<CustomUserProfile>(customProfileKey(userId));
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const result: CustomUserProfile = {};
  if (typeof raw.displayName === 'string' && raw.displayName.length > 0) {
    result.displayName = raw.displayName;
  }
  if (typeof raw.avatarUrl === 'string' && raw.avatarUrl.length > 0) {
    result.avatarUrl = raw.avatarUrl;
  }
  if (typeof raw.qqEmail === 'string' && raw.qqEmail.length > 0) {
    const validated = validateQqEmail(raw.qqEmail);
    if (validated.valid && validated.value) {
      result.qqEmail = validated.value;
    }
  }
  if (typeof raw.updatedAt === 'number') {
    result.updatedAt = raw.updatedAt;
  }
  return result;
}

export async function getPublicSessionUserProfile(userId: number): Promise<PublicSessionUserProfile> {
  const raw = await kv.get<PublicSessionUserProfile>(publicSessionProfileKey(userId));
  if (!raw || typeof raw !== 'object') return {};
  const result: PublicSessionUserProfile = {};
  if (typeof raw.username === 'string' && raw.username.length > 0) {
    result.username = raw.username;
  }
  if (typeof raw.displayName === 'string' && raw.displayName.length > 0) {
    result.displayName = raw.displayName;
  }
  if (typeof raw.updatedAt === 'number') {
    result.updatedAt = raw.updatedAt;
  }
  return result;
}

export async function updatePublicSessionUserProfile(
  userId: number,
  profile: { username?: string | null; displayName?: string | null },
): Promise<void> {
  const next: PublicSessionUserProfile = { updatedAt: Date.now() };
  const username = typeof profile.username === 'string' ? profile.username.trim() : '';
  const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
  if (username) next.username = username;
  if (displayName) next.displayName = displayName;
  await kv.set(publicSessionProfileKey(userId), next);
}

/**
 * 校验头像值：仅允许 https URL 或 data:image/* base64 格式
 */
export function validateAvatarValue(input: unknown): { valid: true; value: string | null } | { valid: false; message: string } {
  // 允许显式传入 null/空串清空头像
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: null };
  }
  if (typeof input !== 'string') {
    return { valid: false, message: '头像格式无效' };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  if (trimmed.length > CUSTOM_AVATAR_MAX_LENGTH) {
    return { valid: false, message: '头像数据过大，请使用更小的图片' };
  }
  // dataURL 校验：只允许 image/* 类型
  if (trimmed.startsWith('data:')) {
    const dataUrlPattern = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i;
    if (!dataUrlPattern.test(trimmed)) {
      return { valid: false, message: '本地图片格式不被支持' };
    }
    return { valid: true, value: trimmed };
  }
  // http(s) URL 校验
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { valid: false, message: '图床链接必须是 http 或 https' };
    }
    return { valid: true, value: trimmed };
  } catch {
    return { valid: false, message: '头像链接格式无效' };
  }
}

/**
 * 校验显示名称
 */
export function validateDisplayName(input: unknown): { valid: true; value: string | null } | { valid: false; message: string } {
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: null };
  }
  if (typeof input !== 'string') {
    return { valid: false, message: '昵称格式无效' };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  if (trimmed.length < CUSTOM_DISPLAY_NAME_MIN_LENGTH) {
    return { valid: false, message: `昵称长度不能少于 ${CUSTOM_DISPLAY_NAME_MIN_LENGTH} 个字符` };
  }
  if (trimmed.length > CUSTOM_DISPLAY_NAME_MAX_LENGTH) {
    return { valid: false, message: `昵称长度不能超过 ${CUSTOM_DISPLAY_NAME_MAX_LENGTH} 个字符` };
  }
  // 禁止控制字符（保留普通空格、可见字符、Emoji）
  const controlCharRegex = /[\x00-\x1f\x7f]/;
  if (controlCharRegex.test(trimmed)) {
    return { valid: false, message: '昵称包含非法字符' };
  }
  return { valid: true, value: trimmed };
}

/**
 * 校验 QQ 邮箱；空值表示清除提醒邮箱
 */
export function validateQqEmail(input: unknown): { valid: true; value: string | null } | { valid: false; message: string } {
  if (input === null || input === undefined || input === '') {
    return { valid: true, value: null };
  }
  if (typeof input !== 'string') {
    return { valid: false, message: 'QQ 邮箱格式无效' };
  }
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { valid: true, value: null };
  }
  if (trimmed.length > QQ_EMAIL_MAX_LENGTH) {
    return { valid: false, message: 'QQ 邮箱长度过长' };
  }
  const controlCharRegex = /[\x00-\x1f\x7f]/;
  if (controlCharRegex.test(trimmed)) {
    return { valid: false, message: 'QQ 邮箱包含非法字符' };
  }
  const qqEmailRegex = /^[1-9][0-9]{4,11}@qq\.com$/;
  if (!qqEmailRegex.test(trimmed)) {
    return { valid: false, message: '请输入有效的 QQ 邮箱，例如 123456@qq.com' };
  }
  return { valid: true, value: trimmed };
}

/**
 * 更新用户自定义资料
 * - 仅更新提供了的字段
 * - displayName / avatarUrl / qqEmail 显式传 null 表示清空
 */
export async function updateCustomUserProfile(
  userId: number,
  patch: { displayName?: string | null; avatarUrl?: string | null; qqEmail?: string | null }
): Promise<CustomUserProfile> {
  const current = await getCustomUserProfile(userId);
  const next: CustomUserProfile = { ...current };

  if ('displayName' in patch) {
    if (patch.displayName === null) {
      delete next.displayName;
    } else if (typeof patch.displayName === 'string') {
      next.displayName = patch.displayName;
    }
  }
  if ('avatarUrl' in patch) {
    if (patch.avatarUrl === null) {
      delete next.avatarUrl;
    } else if (typeof patch.avatarUrl === 'string') {
      next.avatarUrl = patch.avatarUrl;
    }
  }
  if ('qqEmail' in patch) {
    if (patch.qqEmail === null) {
      delete next.qqEmail;
    } else if (typeof patch.qqEmail === 'string') {
      next.qqEmail = patch.qqEmail;
    }
  }
  next.updatedAt = Date.now();

  await kv.set(customProfileKey(userId), next);
  return next;
}
