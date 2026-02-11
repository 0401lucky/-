import { kv } from '@vercel/kv';
import { nanoid } from 'nanoid';
import { fanoutAnnouncementNotification } from './notifications';

export type AnnouncementStatus = 'draft' | 'published' | 'archived';

export interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  status: AnnouncementStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  createdById: number;
  createdBy: string;
  updatedById: number;
  updatedBy: string;
}

export interface AnnouncementPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AnnouncementListOptions {
  page?: number;
  limit?: number;
  status?: AnnouncementStatus | 'all';
}

export interface SaveAnnouncementInput {
  title: string;
  content: string;
  status?: AnnouncementStatus;
}

export interface UpdateAnnouncementInput {
  title?: string;
  content?: string;
  status?: AnnouncementStatus;
}

export interface SaveAnnouncementResult {
  announcement: AnnouncementItem;
  notifiedUsers: number;
}

const ANNOUNCEMENT_ITEM_KEY = (id: string) => `announcement:item:${id}`;
const ANNOUNCEMENT_ALL_INDEX_KEY = 'announcement:index:all';
const ANNOUNCEMENT_PUBLISHED_INDEX_KEY = 'announcement:index:published';

const MAX_PAGE_SIZE = 50;

function normalizePage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value as number));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value as number)));
}

function buildPagination(page: number, limit: number, total: number): AnnouncementPagination {
  const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  };
}

function sanitizeText(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function normalizeStatus(status: AnnouncementStatus | undefined): AnnouncementStatus {
  if (status === 'draft' || status === 'archived') {
    return status;
  }
  return 'published';
}

async function getAnnouncementsByIds(ids: string[]): Promise<AnnouncementItem[]> {
  if (ids.length === 0) return [];

  const keys = ids.map((id) => ANNOUNCEMENT_ITEM_KEY(id));
  const raw = await kv.mget<(AnnouncementItem | null)[]>(...keys);
  const map = new Map<string, AnnouncementItem>();

  for (const item of raw ?? []) {
    if (item?.id) {
      map.set(item.id, item);
    }
  }

  const result: AnnouncementItem[] = [];
  for (const id of ids) {
    const item = map.get(id);
    if (item) {
      result.push(item);
    }
  }

  return result;
}

export async function getAnnouncementById(id: string): Promise<AnnouncementItem | null> {
  return await kv.get<AnnouncementItem>(ANNOUNCEMENT_ITEM_KEY(id));
}

export async function createAnnouncement(
  input: SaveAnnouncementInput,
  operator: { id: number; username: string }
): Promise<SaveAnnouncementResult> {
  const title = sanitizeText(input.title, 200);
  const content = sanitizeText(input.content, 5000);
  if (!title) {
    throw new Error('公告标题不能为空');
  }
  if (!content) {
    throw new Error('公告内容不能为空');
  }

  const now = Date.now();
  const status = normalizeStatus(input.status);

  const announcement: AnnouncementItem = {
    id: nanoid(12),
    title,
    content,
    status,
    createdAt: now,
    updatedAt: now,
    publishedAt: status === 'published' ? now : undefined,
    createdById: operator.id,
    createdBy: operator.username,
    updatedById: operator.id,
    updatedBy: operator.username,
  };

  await Promise.all([
    kv.set(ANNOUNCEMENT_ITEM_KEY(announcement.id), announcement),
    kv.zadd(ANNOUNCEMENT_ALL_INDEX_KEY, {
      score: announcement.updatedAt,
      member: announcement.id,
    }),
    status === 'published'
      ? kv.zadd(ANNOUNCEMENT_PUBLISHED_INDEX_KEY, {
          score: announcement.publishedAt ?? announcement.updatedAt,
          member: announcement.id,
        })
      : Promise.resolve(0),
  ]);

  let notifiedUsers = 0;
  if (status === 'published') {
    const fanoutResult = await fanoutAnnouncementNotification({
      id: announcement.id,
      title: announcement.title,
      content: announcement.content,
    });
    notifiedUsers = fanoutResult.notifiedUsers;
  }

  return {
    announcement,
    notifiedUsers,
  };
}

export async function updateAnnouncement(
  id: string,
  input: UpdateAnnouncementInput,
  operator: { id: number; username: string }
): Promise<SaveAnnouncementResult | null> {
  const current = await getAnnouncementById(id);
  if (!current) return null;

  const title = input.title !== undefined ? sanitizeText(input.title, 200) : current.title;
  const content = input.content !== undefined ? sanitizeText(input.content, 5000) : current.content;

  if (!title) {
    throw new Error('公告标题不能为空');
  }
  if (!content) {
    throw new Error('公告内容不能为空');
  }

  const nextStatus = input.status ?? current.status;
  const now = Date.now();
  const becamePublished = current.status !== 'published' && nextStatus === 'published';

  const next: AnnouncementItem = {
    ...current,
    title,
    content,
    status: nextStatus,
    updatedAt: now,
    updatedById: operator.id,
    updatedBy: operator.username,
    publishedAt:
      nextStatus === 'published'
        ? current.publishedAt ?? now
        : undefined,
  };

  await Promise.all([
    kv.set(ANNOUNCEMENT_ITEM_KEY(id), next),
    kv.zadd(ANNOUNCEMENT_ALL_INDEX_KEY, {
      score: next.updatedAt,
      member: id,
    }),
    nextStatus === 'published'
      ? kv.zadd(ANNOUNCEMENT_PUBLISHED_INDEX_KEY, {
          score: next.publishedAt ?? next.updatedAt,
          member: id,
        })
      : kv.zrem(ANNOUNCEMENT_PUBLISHED_INDEX_KEY, id),
  ]);

  let notifiedUsers = 0;
  if (becamePublished) {
    const fanoutResult = await fanoutAnnouncementNotification({
      id: next.id,
      title: next.title,
      content: next.content,
    });
    notifiedUsers = fanoutResult.notifiedUsers;
  }

  return {
    announcement: next,
    notifiedUsers,
  };
}

export async function archiveAnnouncement(
  id: string,
  operator: { id: number; username: string }
): Promise<AnnouncementItem | null> {
  const current = await getAnnouncementById(id);
  if (!current) return null;

  const next: AnnouncementItem = {
    ...current,
    status: 'archived',
    updatedAt: Date.now(),
    updatedById: operator.id,
    updatedBy: operator.username,
  };

  await Promise.all([
    kv.set(ANNOUNCEMENT_ITEM_KEY(id), next),
    kv.zadd(ANNOUNCEMENT_ALL_INDEX_KEY, {
      score: next.updatedAt,
      member: id,
    }),
    kv.zrem(ANNOUNCEMENT_PUBLISHED_INDEX_KEY, id),
  ]);

  return next;
}

export async function listAnnouncementsForAdmin(
  options: AnnouncementListOptions = {}
): Promise<{ items: AnnouncementItem[]; pagination: AnnouncementPagination }> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);
  const status = options.status ?? 'all';

  const ids = await kv.zrange<string[]>(ANNOUNCEMENT_ALL_INDEX_KEY, 0, 1000, { rev: true });
  const allItems = await getAnnouncementsByIds(ids ?? []);
  const filtered =
    status === 'all' ? allItems : allItems.filter((item) => item.status === status);

  const total = filtered.length;
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);

  return {
    items,
    pagination: buildPagination(page, limit, total),
  };
}

export async function listPublishedAnnouncements(
  options: { page?: number; limit?: number } = {}
): Promise<{ items: AnnouncementItem[]; pagination: AnnouncementPagination }> {
  const page = normalizePage(options.page);
  const limit = normalizeLimit(options.limit);

  const totalRaw = await kv.zcard(ANNOUNCEMENT_PUBLISHED_INDEX_KEY);
  const total = Number(totalRaw) || 0;

  const start = (page - 1) * limit;
  const end = start + limit - 1;

  const ids = await kv.zrange<string[]>(
    ANNOUNCEMENT_PUBLISHED_INDEX_KEY,
    start,
    end,
    { rev: true }
  );

  const items = (await getAnnouncementsByIds(ids ?? [])).filter(
    (item) => item.status === 'published'
  );

  return {
    items,
    pagination: buildPagination(page, limit, total),
  };
}
