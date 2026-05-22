// 乌鸦判定系统

import seedrandom from 'seedrandom';
import { nanoid } from 'nanoid';
import type { FarmStateV2, FarmEvent } from '@/lib/types/farm-v2';
import {
  CROW_BASE_CHANCE, CROW_CHECK_WINDOW, CROW_INITIAL_DELAY,
  WEATHERS_V2, SEASON_MODIFIERS, PROTECTION_FACTORS, MAX_EVENTS, CROPS_V2,
  PET_CHASE_SUCCESS_RATE, PET_TYPE_LABEL,
} from './config';
import {
  getWeatherForDate, getChinaDateString, getCurrentSeason,
  isPetGuarding, isScarecrowActive, isPetChasing,
} from './engine';

/** 单次乌鸦判定窗口 */
function singleCrowCheck(state: FarmStateV2, ts: number, rng: () => number): FarmEvent | null {
  const date = getChinaDateString(ts);
  const season = getCurrentSeason(ts);
  const weather = getWeatherForDate(date, season);
  const wf = WEATHERS_V2[weather].crowFactor;
  if (wf <= 0) return null;
  const sf = SEASON_MODIFIERS[season].crow;
  const scarecrow = isScarecrowActive(state, ts);
  const guarding = isPetGuarding(state, ts);
  let pf: number;
  if (scarecrow && guarding) pf = PROTECTION_FACTORS.scarecrowAndPet;
  else if (scarecrow) pf = PROTECTION_FACTORS.scarecrow;
  else if (guarding) pf = PROTECTION_FACTORS.petGuard;
  else pf = PROTECTION_FACTORS.none;

  const chance = CROW_BASE_CHANCE * wf * sf * pf;
  if (rng() >= chance) return null;

  // 找出可攻击的土地：种植中或成熟未收获，未被防鸟网保护
  const attackable: number[] = [];
  state.lands.forEach((land, i) => {
    if (land.status !== 'growing' && land.status !== 'thirsty' && land.status !== 'mature') return;
    if (!land.crop) return;
    const crop = land.crop;
    // 种植后必须超过初始保护期
    if (ts - crop.plantedAt < CROW_INITIAL_DELAY) return;
    if (crop.birdNetUntil && crop.birdNetUntil > ts) return;
    attackable.push(i);
  });
  if (attackable.length === 0) return null;
  const targetIdx = attackable[Math.floor(rng() * attackable.length)];
  const land = state.lands[targetIdx];
  if (!land.crop) return null;

  // 宠物赶乌鸦判定
  if (isPetChasing(state, ts)) {
    const pet = state.pet!;
    const success = PET_CHASE_SUCCESS_RATE[pet.type];
    if (rng() < success) {
      return {
        id: nanoid(),
        ts,
        type: 'crow_chased',
        text: `${pet.name || PET_TYPE_LABEL[pet.type]} 成功赶走了乌鸦！保住了 ${CROPS_V2[land.crop.cropId].name}`,
        cropId: land.crop.cropId,
      };
    }
  }

  // 乌鸦得手
  const cropName = CROPS_V2[land.crop.cropId].name;
  land.status = 'eaten';
  land.crop = null;
  return {
    id: nanoid(),
    ts,
    type: 'crow_eat',
    text: `乌鸦吃掉了你的 ${cropName}`,
  };
}

/** 多窗口乌鸦判定（懒结算） */
export function runCrowChecks(state: FarmStateV2, lastTickAt: number, now: number): FarmStateV2 {
  // 基于稳定 seed 推动 rng；以用户 id + 窗口起点保证同段时间不被重复利用
  const start = Math.max(lastTickAt, now - 24 * 60 * 60 * 1000);
  let cursor = Math.ceil(start / CROW_CHECK_WINDOW) * CROW_CHECK_WINDOW;
  const added: FarmEvent[] = [];
  while (cursor <= now) {
    const rng = seedrandom(`crow:${state.userId}:${cursor}`);
    const evt = singleCrowCheck(state, cursor, rng);
    if (evt) added.push(evt);
    cursor += CROW_CHECK_WINDOW;
  }
  if (added.length > 0) {
    state.events = [...added.reverse(), ...(state.events ?? [])].slice(0, MAX_EVENTS);
  }
  return state;
}
