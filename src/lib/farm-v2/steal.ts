// 偷菜系统：候选列表 + 结算

import { kv } from '@/lib/d1-kv';
import { getCustomUserProfile } from '@/lib/user-profile';
import { nanoid } from 'nanoid';
import type { FarmStateV2, StealCandidate } from '@/lib/types/farm-v2';
import { CROPS_V2, PET_GUARD_STEAL_MULTIPLIER, PET_STEAL_BASE_SUCCESS, STEAL_LIMITS } from './config';
import { isPetGuarding, isBellActive } from './engine';
import { pushEvent } from './season';

export const FARM_V2_STATE_KEY = (userId: number) => `farmv2:state:${userId}`;

/** 扫描其他玩家，返回有成熟作物的候选 */
export async function listStealCandidates(currentUserId: number, max = 8): Promise<StealCandidate[]> {
  const candidates: StealCandidate[] = [];
  const currentState = await kv.get<FarmStateV2>(FARM_V2_STATE_KEY(currentUserId));
  let cursor = 0;
  let scanned = 0;
  const seen = new Set<number>();
  while (scanned < 200 && candidates.length < max * 3) {
    const [next, keys] = await kv.scan(cursor, { match: 'farmv2:state:*', count: 100 });
    scanned += keys.length;
    for (const key of keys) {
      const m = key.match(/^farmv2:state:(\d+)$/);
      if (!m) continue;
      const uid = parseInt(m[1], 10);
      if (uid === currentUserId || seen.has(uid)) continue;
      seen.add(uid);
      const stolenByMe = currentState?.myStealMap?.[String(uid)] ?? 0;
      if (stolenByMe >= STEAL_LIMITS.perThiefDailyPerTarget) continue;
      const state = await kv.get<FarmStateV2>(key);
      if (!state) continue;
      if ((state.stolenTodayCount ?? 0) >= STEAL_LIMITS.perPlayerDailyMaxBeingStolen) continue;
      if (getStealableMatureIndexes(state).length === 0) continue;
      const profile = await getStealCandidateProfile(uid);
      candidates.push({
        userId: uid,
        nickname: profile.nickname,
        avatarUrl: profile.avatarUrl,
      });
    }
    cursor = next;
    if (cursor === 0) break;
  }
  // 随机洗牌取 max 个
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, max);
}

async function getStealCandidateProfile(userId: number): Promise<{ nickname: string; avatarUrl: string | null }> {
  const [userResult, profileResult] = await Promise.allSettled([
    kv.get<{ nickname?: string; displayName?: string; username?: string; email?: string }>(`user:${userId}`),
    getCustomUserProfile(userId),
  ]);
  const user = userResult.status === 'fulfilled' ? userResult.value : null;
  const profile = profileResult.status === 'fulfilled' ? profileResult.value : {};
  return {
    nickname: profile.displayName
      || user?.nickname
      || user?.displayName
      || user?.username
      || user?.email?.split('@')[0]
      || `玩家${userId}`,
    avatarUrl: profile.avatarUrl ?? null,
  };
}

export function getStealableMatureIndexes(state: FarmStateV2): number[] {
  return state.lands
    .map((land, index) => (land.status === 'mature' && land.crop ? index : -1))
    .filter((index) => index >= 0);
}

export function pickRandomStealableMatureIndex(state: FarmStateV2, rng: () => number = Math.random): number | null {
  const indexes = getStealableMatureIndexes(state);
  if (indexes.length === 0) return null;
  return indexes[Math.floor(rng() * indexes.length)];
}

/** 计算当前偷菜成功率（含目标守护、自身情绪与健康状态等） */
export function computeStealSuccessRate(thiefState: FarmStateV2, targetState: FarmStateV2, now: number): number {
  if (!thiefState.pet) return 0;
  const pet = thiefState.pet;
  const base = PET_STEAL_BASE_SUCCESS[pet.type];
  // 情绪修正
  let moodMul: number;
  if (pet.mood >= 70) moodMul = 1.15;
  else if (pet.mood >= 30) moodMul = 1.0;
  else moodMul = 0.8;
  // 状态修正
  let statusMul = 1.0;
  if (pet.hunger < 25 || pet.cleanliness < 25 || pet.thirst < 20 || pet.health < 35 || pet.mood < 25) return 0;
  if (pet.hunger < 40 || pet.cleanliness < 40 || pet.thirst < 40 || pet.health < 50 || pet.mood < 40) statusMul = 0.5;
  // 防守修正
  let guardMul = 1.0;
  if (isPetGuarding(targetState, now)) {
    guardMul = targetState.pet ? PET_GUARD_STEAL_MULTIPLIER[targetState.pet.type] : 1.0;
  }
  if (isBellActive(targetState, now)) {
    guardMul *= 0.5;
  }
  return base * moodMul * statusMul * guardMul;
}

/** 在目标 state 上记录整棵作物被偷，并清空土地 */
export function applyWholeStealOnTarget(targetState: FarmStateV2, thiefId: number, landIndex: number, amount: number, ts: number): boolean {
  const land = targetState.lands[landIndex];
  if (!land?.crop) return false;
  if (land.status !== 'mature') return false;
  const cropId = land.crop.cropId;
  const cropName = CROPS_V2[cropId].name;
  land.status = 'empty';
  land.crop = null;
  targetState.stolenTodayCount += 1;
  targetState.stolenByMap[String(thiefId)] = (targetState.stolenByMap[String(thiefId)] ?? 0) + 1;
  pushEvent(targetState, {
    id: nanoid(),
    ts,
    type: 'stolen_in',
    text: `你的 ${cropName} 被整棵偷走了，本次没有获得收益`,
    cropId,
    amount,
  });
  return true;
}
