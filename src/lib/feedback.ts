import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';

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
}

export interface FeedbackMessage {
  id: string;
  feedbackId: string;
  role: FeedbackRole;
  content: string;
  createdAt: number;
  createdBy: string;
}

interface ListOptions {
  page?: number;
  limit?: number;
  status?: FeedbackStatus;
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

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value as number));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.floor(value as number)));
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

export async function createFeedback(
  userId: number,
  username: string,
  content: string,
  contact?: string
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
    createdAt: now,
    createdBy: username,
  };

  await Promise.all([
    kv.set(FEEDBACK_ITEM_KEY(feedbackId), feedback),
    kv.lpush(FEEDBACK_LIST_KEY, feedbackId),
    kv.lpush(FEEDBACK_USER_LIST_KEY(userId), feedbackId),
    kv.lpush(FEEDBACK_MESSAGES_KEY(feedbackId), message),
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
  createdBy: string
): Promise<{ feedback: FeedbackItem; message: FeedbackMessage }> {
  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) {
    throw new Error('反馈不存在');
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

  const updatedFeedback: FeedbackItem = {
    ...feedback,
    status,
    updatedAt: Date.now(),
  };

  await kv.set(FEEDBACK_ITEM_KEY(feedbackId), updatedFeedback);
  return updatedFeedback;
}

export async function listUserFeedback(
  userId: number,
  options: ListOptions = {}
): Promise<{ items: FeedbackItem[]; pagination: Pagination }> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const status = options.status;
  const listKey = FEEDBACK_USER_LIST_KEY(userId);

  if (!status) {
    const total = await kv.llen(listKey);
    if (total === 0) {
      return { items: [], pagination: buildPagination(page, limit, 0) };
    }

    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const ids = await kv.lrange<string>(listKey, start, end);
    const items = await getFeedbackByIds(ids ?? []);

    return { items, pagination: buildPagination(page, limit, total) };
  }

  const allIds = await kv.lrange<string>(listKey, 0, -1);
  const allItems = await getFeedbackByIds(allIds ?? []);
  const filtered = allItems.filter((item) => item.status === status);

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = filtered.slice(start, end);

  return { items, pagination: buildPagination(page, limit, total) };
}

export async function listAllFeedback(
  options: ListOptions = {}
): Promise<{ items: FeedbackItem[]; pagination: Pagination }> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const status = options.status;

  if (!status) {
    const total = await kv.llen(FEEDBACK_LIST_KEY);
    if (total === 0) {
      return { items: [], pagination: buildPagination(page, limit, 0) };
    }

    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const ids = await kv.lrange<string>(FEEDBACK_LIST_KEY, start, end);
    const items = await getFeedbackByIds(ids ?? []);

    return { items, pagination: buildPagination(page, limit, total) };
  }

  const allIds = await kv.lrange<string>(FEEDBACK_LIST_KEY, 0, -1);
  const allItems = await getFeedbackByIds(allIds ?? []);
  const filtered = allItems.filter((item) => item.status === status);

  const total = filtered.length;
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = filtered.slice(start, end);

  return { items, pagination: buildPagination(page, limit, total) };
}
