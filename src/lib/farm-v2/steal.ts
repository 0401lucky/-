// 偷菜系统：候选列表 + 结算

import { kv } from '@/lib/d1-kv';
import { nanoid } from 'nanoid';
import type { FarmStateV2, StealCandidate } from '@/lib/types/farm-v2';
import { CROPS_V2, PET_GUARD_STEAL_MULTIPLIER, PET_STEAL_BASE_SUCCESS, STEAL_LIMITS } from './config';
import { isPetGuarding, isBellActive } from './engine';
import { pushEvent } from './season';

export const FARM_V2_STATE_KEY = (userId: number) => `farmv2:state:${userId}`;

/** 扫描其他玩家，返回有成熟作物的候选 */
export async function listStealCandidates(currentUserId: number, max = 8): Promise<StealCandidate[]> {
  const candidates: StealCandidate[] = [];
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
      const state = await kv.get<FarmStateV2>(key);
      if (!state) continue;
      const matures = state.lands
        .map((land, i) => ({ land, i }))
        .filter(({ land }) => land.status === 'mature' && land.crop && land.crop.stolenCount < STEAL_LIMITS.perCropMaxTimes);
      if (matures.length === 0) continue;
      const nickname = await getNickname(uid);
      candidates.push({
        userId: uid,
        nickname,
        matureLands: matures.slice(0, 3).map(({ land, i }) => ({
          landIndex: i,
          cropId: land.crop!.cropId,
          cropName: CROPS_V2[land.crop!.cropId].name,
          baseYield: CROPS_V2[land.crop!.cropId].baseYield,
        })),
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

async function getNickname(userId: number): Promise<string> {
  try {
    const u = await kv.get<{ nickname?: string; email?: string }>(`user:${userId}`);
    return u?.nickname || u?.email?.split('@')[0] || `玩家${userId}`;
  } catch {
    return `玩家${userId}`;
  }
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

/** 计算偷菜收益（按目标作物 baseYield 的 15%，小白猫有额外收益概率） */
export function computeStealAmount(cropId: import('@/lib/types/farm-v2').CropIdV2, isCat: boolean): { amount: number; lucky: boolean } {
  const base = CROPS_V2[cropId].baseYield;
  let pct = STEAL_LIMITS.catRate;
  let lucky = false;
  if (isCat && Math.random() < STEAL_LIMITS.catLuckyChance) {
    pct = STEAL_LIMITS.catRate + STEAL_LIMITS.catLuckyExtra;
    lucky = true;
  }
  return { amount: Math.floor(base * pct), lucky };
}

/** 在目标 state 上记录被偷 */
export function applyStolenOnTarget(targetState: FarmStateV2, thiefId: number, landIndex: number, amount: number, ts: number): boolean {
  const land = targetState.lands[landIndex];
  if (!land?.crop) return false;
  if (land.status !== 'mature') return false;
  const max = Math.floor(CROPS_V2[land.crop.cropId].baseYield * STEAL_LIMITS.perCropMaxRatio);
  if (land.crop.stolenAmount >= max) return false;
  const allow = Math.min(amount, max - land.crop.stolenAmount);
  land.crop.stolenAmount += allow;
  land.crop.stolenCount += 1;
  targetState.stolenTodayCount += 1;
  targetState.stolenByMap[String(thiefId)] = (targetState.stolenByMap[String(thiefId)] ?? 0) + 1;
  pushEvent(targetState, {
    id: nanoid(),
    ts,
    type: 'stolen_in',
    text: `你的 ${CROPS_V2[land.crop.cropId].name} 被偷走了 ${allow} 积分`,
    cropId: land.crop.cropId,
    amount: allow,
  });
  return true;
}
