import { kv } from '@/lib/d1-kv';
import {
  ACHIEVEMENT_DEFINITIONS,
  buildAchievements,
  getAutomaticAchievementIds,
  getPublicAchievementById,
  isAchievementId,
  isActiveAchievementGrant,
  type AchievementDef,
  type AchievementId,
  type ProfileAchievementOverviewData,
  type PublicAchievement,
  type UserAchievementGrant,
} from './profile-achievements';

const USER_ACHIEVEMENTS_KEY = (userId: number) => `user:achievements:${userId}`;
const USER_EQUIPPED_ACHIEVEMENT_KEY = (userId: number) => `user:achievement:equipped:${userId}`;
const PEAK_FIRST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface UserAchievementSummary {
  grants: UserAchievementGrant[];
  equippedId: AchievementId | null;
  equipped: PublicAchievement | null;
  items: AchievementDef[];
}

export interface GrantAchievementInput {
  source: UserAchievementGrant['source'];
  reason?: string;
  expiresAt?: number | null;
  grantedBy?: {
    id: number;
    username: string;
  } | null;
  metadata?: Record<string, unknown>;
  grantedAt?: number;
}

function sanitizeGrant(raw: unknown): UserAchievementGrant | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  if (!isAchievementId(item.id)) return null;

  const source =
    item.source === 'admin' || item.source === 'ranking_monthly' || item.source === 'auto'
      ? item.source
      : 'auto';

  const grantedAt = typeof item.grantedAt === 'number' && Number.isFinite(item.grantedAt)
    ? item.grantedAt
    : Date.now();

  const expiresAt = typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt)
    ? item.expiresAt
    : null;

  const grantedByRaw = item.grantedBy;
  const grantedBy =
    grantedByRaw && typeof grantedByRaw === 'object'
      ? {
          id: Number((grantedByRaw as Record<string, unknown>).id) || 0,
          username: String((grantedByRaw as Record<string, unknown>).username ?? ''),
        }
      : null;

  return {
    id: item.id,
    source,
    grantedAt,
    expiresAt,
    reason: typeof item.reason === 'string' ? item.reason : undefined,
    grantedBy,
    metadata: item.metadata && typeof item.metadata === 'object'
      ? item.metadata as Record<string, unknown>
      : undefined,
  };
}

export async function getUserAchievementGrants(userId: number): Promise<UserAchievementGrant[]> {
  const raw = await kv.get<unknown>(USER_ACHIEVEMENTS_KEY(userId));
  if (!raw || typeof raw !== 'object') return [];

  if (Array.isArray(raw)) {
    return raw.map(sanitizeGrant).filter((item): item is UserAchievementGrant => item !== null);
  }

  return Object.values(raw as Record<string, unknown>)
    .map(sanitizeGrant)
    .filter((item): item is UserAchievementGrant => item !== null);
}

async function saveUserAchievementGrants(userId: number, grants: UserAchievementGrant[]): Promise<void> {
  const map: Partial<Record<AchievementId, UserAchievementGrant>> = {};
  for (const grant of grants) {
    map[grant.id] = grant;
  }
  await kv.set(USER_ACHIEVEMENTS_KEY(userId), map);
}

export async function getEquippedAchievementId(userId: number): Promise<AchievementId | null> {
  const raw = await kv.get<unknown>(USER_EQUIPPED_ACHIEVEMENT_KEY(userId));
  return isAchievementId(raw) ? raw : null;
}

export async function getEquippedAchievementForUser(userId: number): Promise<PublicAchievement | null> {
  const [equippedId, grants] = await Promise.all([
    getEquippedAchievementId(userId),
    getUserAchievementGrants(userId),
  ]);
  if (!equippedId) return null;

  const grant = grants.find((item) => item.id === equippedId && isActiveAchievementGrant(item));
  if (!grant) {
    return null;
  }

  return getPublicAchievementById(equippedId, grant);
}

export async function grantUserAchievement(
  userId: number,
  achievementId: AchievementId,
  input: GrantAchievementInput
): Promise<UserAchievementGrant> {
  const definition = ACHIEVEMENT_DEFINITIONS.find((item) => item.id === achievementId);
  if (!definition) {
    throw new Error('未知成就');
  }

  const grants = await getUserAchievementGrants(userId);
  const now = input.grantedAt ?? Date.now();
  const existing = grants.find((item) => item.id === achievementId);
  const next: UserAchievementGrant = {
    id: achievementId,
    source: input.source,
    grantedAt: existing?.grantedAt ?? now,
    expiresAt: input.expiresAt ?? existing?.expiresAt ?? null,
    reason: input.reason ?? existing?.reason,
    grantedBy: input.grantedBy ?? existing?.grantedBy ?? null,
    metadata: input.metadata ?? existing?.metadata,
  };

  if (existing?.expiresAt && input.expiresAt) {
    next.expiresAt = Math.max(existing.expiresAt, input.expiresAt);
  }

  const merged = grants.filter((item) => item.id !== achievementId);
  merged.push(next);
  await saveUserAchievementGrants(userId, merged);
  return next;
}

export async function revokeUserAchievement(userId: number, achievementId: AchievementId): Promise<void> {
  const grants = await getUserAchievementGrants(userId);
  await saveUserAchievementGrants(userId, grants.filter((item) => item.id !== achievementId));
  const equippedId = await getEquippedAchievementId(userId);
  if (equippedId === achievementId) {
    await kv.del(USER_EQUIPPED_ACHIEVEMENT_KEY(userId));
  }
}

export async function syncAutomaticAchievementGrants(
  userId: number,
  data: ProfileAchievementOverviewData
): Promise<UserAchievementGrant[]> {
  const automaticIds = getAutomaticAchievementIds(data);
  const grants = await getUserAchievementGrants(userId);
  const existingIds = new Set(grants.map((item) => item.id));
  const now = Date.now();
  let changed = false;

  for (const id of automaticIds) {
    if (!existingIds.has(id)) {
      grants.push({
        id,
        source: 'auto',
        grantedAt: now,
        expiresAt: null,
      });
      changed = true;
    }
  }

  if (changed) {
    await saveUserAchievementGrants(userId, grants);
  }

  return grants;
}

export async function buildUserAchievementSummary(
  userId: number,
  data: ProfileAchievementOverviewData
): Promise<UserAchievementSummary> {
  const grants = await syncAutomaticAchievementGrants(userId, data);
  let equippedId = await getEquippedAchievementId(userId);
  const items = buildAchievements({
    ...data,
    achievements: {
      grants,
      equippedId,
    },
  });
  const equippedItem = equippedId
    ? items.find((item) => item.id === equippedId && item.unlocked) ?? null
    : null;

  if (equippedId && !equippedItem) {
    await kv.del(USER_EQUIPPED_ACHIEVEMENT_KEY(userId));
    equippedId = null;
  }

  return {
    grants,
    equippedId,
    equipped: equippedItem ? getPublicAchievementById(equippedItem.id, grants.find((g) => g.id === equippedItem.id)) : null,
    items: items.map((item) => ({
      ...item,
      equipped: equippedId === item.id && item.unlocked,
    })),
  };
}

export async function setEquippedAchievement(
  userId: number,
  achievementId: AchievementId | null,
  availableItems: AchievementDef[]
): Promise<PublicAchievement | null> {
  if (achievementId === null) {
    await kv.del(USER_EQUIPPED_ACHIEVEMENT_KEY(userId));
    return null;
  }

  const item = availableItems.find((achievement) => achievement.id === achievementId);
  if (!item || !item.unlocked) {
    throw new Error('只能佩戴已解锁的成就');
  }

  await kv.set(USER_EQUIPPED_ACHIEVEMENT_KEY(userId), achievementId);
  return getPublicAchievementById(achievementId, {
    id: achievementId,
    source: 'auto',
    grantedAt: item.grantedAt ?? Date.now(),
    expiresAt: item.expiresAt ?? null,
  });
}

export async function grantPeakFirstAchievement(input: {
  userId: number;
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  grantedAt?: number;
}): Promise<UserAchievementGrant> {
  const grantedAt = input.grantedAt ?? Date.now();
  return grantUserAchievement(input.userId, 'peak_first', {
    source: 'ranking_monthly',
    grantedAt,
    expiresAt: grantedAt + PEAK_FIRST_TTL_MS,
    reason: `风云榜月榜第一：${input.periodLabel}`,
    metadata: {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      periodLabel: input.periodLabel,
    },
  });
}

export async function getAdminUserAchievementList(userId: number): Promise<AchievementDef[]> {
  const [grants, equippedId] = await Promise.all([
    getUserAchievementGrants(userId),
    getEquippedAchievementId(userId),
  ]);
  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const grant = grants.find((item) => item.id === definition.id && isActiveAchievementGrant(item));
    return {
      id: definition.id,
      emoji: definition.emoji,
      name: definition.name,
      desc: definition.desc,
      series: definition.series,
      unlockMode: definition.unlockMode,
      unlocked: Boolean(grant),
      shine: Boolean(definition.shine && grant),
      grantedAt: grant?.grantedAt ?? null,
      expiresAt: grant?.expiresAt ?? null,
      equipped: equippedId === definition.id && Boolean(grant),
    };
  });
}
