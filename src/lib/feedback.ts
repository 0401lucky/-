import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { type FeedbackImage } from '@/lib/feedback-image';

export type FeedbackStatus = 'open' | 'processing' | 'resolved' | 'closed';
export type FeedbackRole = 'user' | 'admin';

export interface FeedbackItem {
  id: string;
  userId: number;
  username: string;
  contact?: string;
  status: FeedbackStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface FeedbackMessage {
  id: string;
  feedbackId: string;
  role: FeedbackRole;
  content: string;
  images?: FeedbackImage[];
  createdAt: number;
  createdBy: string;
}

interface ListOptions {
  page?: number;
  limit?: number;
  status?: FeedbackStatus;
  includeArchived?: boolean;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

const FEEDBACK_LIST_KEY = 'feedback:list';
const FEEDBACK_ITEM_KEY = (feedbackId: string) => `feedback:item:${feedbackId}`;
const FEEDBACK_USER_LIST_KEY = (userId: number) => `feedback:user:${userId}`;
const FEEDBACK_MESSAGES_KEY = (feedbackId: string) => `feedback:messages:${feedbackId}`;

const FEEDBACK_INDEX_ALL_KEY = 'feedback:index:all';
const FEEDBACK_INDEX_ARCHIVED_KEY = 'feedback:index:archived';
const FEEDBACK_INDEX_MIGRATED_KEY = 'feedback:index:migrated:v1';
const FEEDBACK_INDEX_USER_KEY = (userId: number) => `feedback:index:user:${userId}`;
const FEEDBACK_INDEX_STATUS_KEY = (status: FeedbackStatus) => `feedback:index:status:${status}`;
const FEEDBACK_INDEX_USER_STATUS_KEY = (userId: number, status: FeedbackStatus) =>
  `feedback:index:user:${userId}:status:${status}`;

let hasEnsuredIndexes = false;

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value as number));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value as number)));
}

function normalizeArchiveDays(value: number | undefined): number {
  if (!Number.isFinite(value)) return 60;
  return Math.min(365, Math.max(1, Math.floor(value as number)));
}

function normalizeArchiveLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 200;
  return Math.min(500, Math.max(1, Math.floor(value as number)));
}

function buildPagination(page: number, limit: number, total: number): Pagination {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

async function getFeedbackByIds(ids: string[]): Promise<FeedbackItem[]> {
  if (ids.length === 0) return [];

  const keys = ids.map((id) => FEEDBACK_ITEM_KEY(id));
  const items = await kv.mget<(FeedbackItem | null)[]>(...keys);
  return (items ?? []).filter((item): item is FeedbackItem => item !== null);
}

function isArchivedFeedback(item: FeedbackItem): boolean {
  return Number.isFinite(item.archivedAt) && (item.archivedAt as number) > 0;
}

function getIndexKey(userId: number | null, status?: FeedbackStatus, includeArchived: boolean = false): string {
  if (includeArchived) {
    return FEEDBACK_INDEX_ARCHIVED_KEY;
  }

  if (userId !== null) {
    return status
      ? FEEDBACK_INDEX_USER_STATUS_KEY(userId, status)
      : FEEDBACK_INDEX_USER_KEY(userId);
  }

  return status ? FEEDBACK_INDEX_STATUS_KEY(status) : FEEDBACK_INDEX_ALL_KEY;
}

async function addIndexesForItem(item: FeedbackItem): Promise<void> {
  if (isArchivedFeedback(item)) {
    const archivedScore = item.archivedAt as number;
    await Promise.all([
      kv.zrem(FEEDBACK_INDEX_ALL_KEY, item.id),
      kv.zrem(FEEDBACK_INDEX_USER_KEY(item.userId), item.id),
      kv.zrem(FEEDBACK_INDEX_STATUS_KEY(item.status), item.id),
      kv.zrem(FEEDBACK_INDEX_USER_STATUS_KEY(item.userId, item.status), item.id),
      kv.zadd(FEEDBACK_INDEX_ARCHIVED_KEY, { score: archivedScore, member: item.id }),
    ]);
    return;
  }

  await Promise.all([
    kv.zrem(FEEDBACK_INDEX_ARCHIVED_KEY, item.id),
    kv.zadd(FEEDBACK_INDEX_ALL_KEY, { score: item.updatedAt, member: item.id }),
    kv.zadd(FEEDBACK_INDEX_USER_KEY(item.userId), { score: item.updatedAt, member: item.id }),
    kv.zadd(FEEDBACK_INDEX_STATUS_KEY(item.status), { score: item.updatedAt, member: item.id }),
    kv.zadd(FEEDBACK_INDEX_USER_STATUS_KEY(item.userId, item.status), {
      score: item.updatedAt,
      member: item.id,
    }),
  ]);
}

async function removeIndexesForItem(item: FeedbackItem): Promise<void> {
  if (isArchivedFeedback(item)) {
    await kv.zrem(FEEDBACK_INDEX_ARCHIVED_KEY, item.id);
    return;
  }

  await Promise.all([
    kv.zrem(FEEDBACK_INDEX_ALL_KEY, item.id),
    kv.zrem(FEEDBACK_INDEX_USER_KEY(item.userId), item.id),
    kv.zrem(FEEDBACK_INDEX_STATUS_KEY(item.status), item.id),
    kv.zrem(FEEDBACK_INDEX_USER_STATUS_KEY(item.userId, item.status), item.id),
  ]);
}

async function ensureFeedbackIndexes(): Promise<void> {
  if (hasEnsuredIndexes) {
    return;
  }

  const migrated = await kv.get<string>(FEEDBACK_INDEX_MIGRATED_KEY);
  if (migrated === '1') {
    hasEnsuredIndexes = true;
    return;
  }

  const legacyTotal = await kv.llen(FEEDBACK_LIST_KEY);
  if (legacyTotal <= 0) {
    await kv.set(FEEDBACK_INDEX_MIGRATED_KEY, '1');
    hasEnsuredIndexes = true;
    return;
  }

  const chunkSize = 200;
  for (let start = 0; start < legacyTotal; start += chunkSize) {
    const end = Math.min(legacyTotal - 1, start + chunkSize - 1);
    const ids = await kv.lrange<string>(FEEDBACK_LIST_KEY, start, end);
    const items = await getFeedbackByIds(ids ?? []);
    await Promise.all(items.map((item) => addIndexesForItem(item)));
  }

  await kv.set(FEEDBACK_INDEX_MIGRATED_KEY, '1');
  hasEnsuredIndexes = true;
}

async function listFeedbackByIndex(
  key: string,
  page: number,
  limit: number
): Promise<{ ids: string[]; total: number }> {
  const total = await kv.zcard(key);
  if (total <= 0) {
    return { ids: [], total: 0 };
  }

  const start = (page - 1) * limit;
  const end = start + limit - 1;
  const ids = await kv.zrange<string[]>(key, start, end, { rev: true });

  return {
    ids: ids ?? [],
    total,
  };
}

export async function createFeedback(
  userId: number,
  username: string,
  content: string,
  contact?: string,
  images: FeedbackImage[] = []
): Promise<{ feedback: FeedbackItem; message: FeedbackMessage }> {
  const now = Date.now();
  const feedbackId = nanoid(12);
  const messageId = nanoid(12);

  const feedback: FeedbackItem = {
    id: feedbackId,
    userId,
    username,
    contact,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };

  const message: FeedbackMessage = {
    id: messageId,
    feedbackId,
    role: 'user',
    content,
    images: images.length > 0 ? images : undefined,
    createdAt: now,
    createdBy: username,
  };

  await Promise.all([
    kv.set(FEEDBACK_ITEM_KEY(feedbackId), feedback),
    kv.lpush(FEEDBACK_LIST_KEY, feedbackId),
    kv.lpush(FEEDBACK_USER_LIST_KEY(userId), feedbackId),
    kv.lpush(FEEDBACK_MESSAGES_KEY(feedbackId), message),
    addIndexesForItem(feedback),
  ]);

  return { feedback, message };
}

export async function getFeedbackById(feedbackId: string): Promise<FeedbackItem | null> {
  return await kv.get<FeedbackItem>(FEEDBACK_ITEM_KEY(feedbackId));
}

export async function getFeedbackMessages(feedbackId: string, limit: number = 200): Promise<FeedbackMessage[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const messages = await kv.lrange<FeedbackMessage>(FEEDBACK_MESSAGES_KEY(feedbackId), 0, safeLimit - 1);
  return messages ?? [];
}

export async function addFeedbackMessage(
  feedbackId: string,
  role: FeedbackRole,
  content: string,
  createdBy: string,
  images: FeedbackImage[] = []
): Promise<{ feedback: FeedbackItem; message: FeedbackMessage }> {
  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) {
    throw new Error('反馈不存在');
  }

  if (isArchivedFeedback(feedback)) {
    throw new Error('该反馈已归档，不能继续留言');
  }

  if (feedback.status === 'closed') {
    throw new Error('该反馈已关闭，不能继续留言');
  }

  const now = Date.now();
  const message: FeedbackMessage = {
    id: nanoid(12),
    feedbackId,
    role,
    content,
    images: images.length > 0 ? images : undefined,
    createdAt: now,
    createdBy,
  };

  let nextStatus = feedback.status;
  if (role === 'user' && feedback.status === 'resolved') {
    nextStatus = 'open';
  }
  if (role === 'admin' && feedback.status === 'open') {
    nextStatus = 'processing';
  }

  const updatedFeedback: FeedbackItem = {
    ...feedback,
    status: nextStatus,
    updatedAt: now,
  };

  await Promise.all([
    kv.lpush(FEEDBACK_MESSAGES_KEY(feedbackId), message),
    kv.set(FEEDBACK_ITEM_KEY(feedbackId), updatedFeedback),
    removeIndexesForItem(feedback),
    addIndexesForItem(updatedFeedback),
  ]);

  return {
    feedback: updatedFeedback,
    message,
  };
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus
): Promise<FeedbackItem | null> {
  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) return null;

  if (isArchivedFeedback(feedback)) {
    return feedback;
  }

  const updatedFeedback: FeedbackItem = {
    ...feedback,
    status,
    updatedAt: Date.now(),
  };

  await Promise.all([
    kv.set(FEEDBACK_ITEM_KEY(feedbackId), updatedFeedback),
    removeIndexesForItem(feedback),
    addIndexesForItem(updatedFeedback),
  ]);
  return updatedFeedback;
}

export interface ArchiveFeedbackOptions {
  olderThanDays?: number;
  limit?: number;
}

export interface ArchiveFeedbackResult {
  archivedCount: number;
  scannedCount: number;
  thresholdTime: number;
  remainingCount: number;
}

export async function archiveClosedFeedback(
  options: ArchiveFeedbackOptions = {}
): Promise<ArchiveFeedbackResult> {
  await ensureFeedbackIndexes();

  const olderThanDays = normalizeArchiveDays(options.olderThanDays);
  const limit = normalizeArchiveLimit(options.limit);
  const thresholdTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const candidateIds = await kv.zrange<string[]>(
    FEEDBACK_INDEX_STATUS_KEY('closed'),
    '-inf',
    thresholdTime,
    {
      byScore: true,
      offset: 0,
      count: limit,
    }
  );

  let archivedCount = 0;
  for (const feedbackId of candidateIds ?? []) {
    const feedback = await getFeedbackById(feedbackId);
    if (!feedback) {
      continue;
    }

    if (isArchivedFeedback(feedback)) {
      continue;
    }

    if (feedback.status !== 'closed' || feedback.updatedAt > thresholdTime) {
      continue;
    }

    const archivedFeedback: FeedbackItem = {
      ...feedback,
      archivedAt: Date.now(),
    };

    await Promise.all([
      kv.set(FEEDBACK_ITEM_KEY(feedbackId), archivedFeedback),
      removeIndexesForItem(feedback),
      addIndexesForItem(archivedFeedback),
    ]);
    archivedCount += 1;
  }

  const remainingCount = await kv.zcount(
    FEEDBACK_INDEX_STATUS_KEY('closed'),
    '-inf',
    thresholdTime
  );

  return {
    archivedCount,
    scannedCount: (candidateIds ?? []).length,
    thresholdTime,
    remainingCount,
  };
}

export async function listUserFeedback(
  userId: number,
  options: ListOptions = {}
): Promise<{ items: FeedbackItem[]; pagination: Pagination }> {
  await ensureFeedbackIndexes();

  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const status = options.status;

  const indexKey = getIndexKey(userId, status, options.includeArchived ?? false);
  const { ids, total } = await listFeedbackByIndex(indexKey, page, limit);
  const items = await getFeedbackByIds(ids);

  return {
    items,
    pagination: buildPagination(page, limit, total),
  };
}

export async function listAllFeedback(
  options: ListOptions = {}
): Promise<{ items: FeedbackItem[]; pagination: Pagination }> {
  await ensureFeedbackIndexes();

  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const status = options.status;

  const indexKey = getIndexKey(null, status, options.includeArchived ?? false);
  const { ids, total } = await listFeedbackByIndex(indexKey, page, limit);
  const items = await getFeedbackByIds(ids);

  return {
    items,
    pagination: buildPagination(page, limit, total),
  };
}
