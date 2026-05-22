// 季节切换处理 / 雨天浇水 / 缺水推进等子模块

import { nanoid } from 'nanoid';
import type { FarmStateV2, FarmEvent, Season, WeatherV2 } from '@/lib/types/farm-v2';
import { SEASON_LABEL, MAX_EVENTS, WEATHERS_V2 } from './config';
import {
  getCurrentSeason, getChinaDateString, getWeatherForDate,
  computeActualWaterIntervalMs, computeWaterMissesAfterWindow,
} from './engine';

/** 应用跨季节：上一季种下且未收获的作物全部枯萎 */
export function applySeasonChanges(state: FarmStateV2, now: number): FarmStateV2 {
  const newSeason = getCurrentSeason(now);
  let withered = 0;
  state.lands.forEach((land) => {
    if (!land.crop) return;
    if (land.status === 'locked' || land.status === 'empty') return;
    if (land.crop.plantedSeason !== newSeason) {
      land.status = 'withered';
      withered += 1;
    }
  });
  if (withered > 0) {
    pushEvent(state, {
      id: nanoid(),
      ts: now,
      type: 'season_change',
      text: `换季到「${SEASON_LABEL[newSeason]}」，${withered} 块上一季作物枯萎`,
    });
  }
  state.lastSeasonProcessedAt = now;
  return state;
}

/** 检查是否需要应用换季 */
export function maybeApplySeasonChange(state: FarmStateV2, now: number): FarmStateV2 {
  const last = state.lastSeasonProcessedAt;
  if (!last) {
    state.lastSeasonProcessedAt = now;
    return state;
  }
  const lastSeason = getCurrentSeason(last);
  const nowSeason = getCurrentSeason(now);
  if (lastSeason !== nowSeason) {
    return applySeasonChanges(state, now);
  }
  return state;
}

/** 应用雨天自动浇水（懒结算） */
export function applyRainAutoWater(state: FarmStateV2, lastTickAt: number, now: number): FarmStateV2 {
  // 按当前天气判断（此处用 now 的天气；跨日的边界由 daily reset 处理）
  const date = getChinaDateString(now);
  const season = getCurrentSeason(now);
  const weather = getWeatherForDate(date, season);
  const def = WEATHERS_V2[weather];
  if (def.autoWaterMinutes <= 0) return state;
  const stepMs = def.autoWaterMinutes * 60 * 1000;
  // 步进：从 lastTickAt 开始，每过 stepMs 就给所有未成熟作物浇一次水
  const startTick = Math.max(lastTickAt, now - 6 * 60 * 60 * 1000); // 最多回溯 6 小时
  let cursor = Math.ceil(startTick / stepMs) * stepMs;
  while (cursor <= now) {
    state.lands.forEach((land) => {
      if (!land.crop || land.status !== 'growing' && land.status !== 'thirsty') return;
      const crop = land.crop;
      if (cursor < crop.plantedAt) return;
      if (cursor >= crop.matureAt) return;
      const intervalMs = computeActualWaterIntervalMs(crop.cropId, season, weather);
      crop.lastWaterAt = cursor;
      crop.nextWaterDueAt = cursor + intervalMs;
      land.status = 'growing';
    });
    cursor += stepMs;
  }
  return state;
}

/** 推进缺水计数（基于当前时间和最新浇水时间） */
export function advanceWaterMisses(state: FarmStateV2, now: number, season: Season, weather: WeatherV2): FarmStateV2 {
  state.lands.forEach((land) => {
    if (!land.crop) return;
    if (land.status === 'withered' || land.status === 'eaten') return;
    const crop = land.crop;
    if (now >= crop.matureAt) return;
    const intervalMs = computeActualWaterIntervalMs(crop.cropId, season, weather);
    const prevMissCount = crop.waterMissCount;
    const r = computeWaterMissesAfterWindow(crop, intervalMs, now);
    crop.waterMissCount = r.newMissCount;
    crop.nextWaterDueAt = r.newNextDue;
    if (crop.waterMissCount >= 3) {
      land.status = 'withered';
    } else if (crop.waterMissCount > prevMissCount) {
      land.status = 'thirsty';
    }
  });
  return state;
}

export function pushEvent(state: FarmStateV2, event: FarmEvent) {
  state.events = [event, ...(state.events ?? [])].slice(0, MAX_EVENTS);
}

export function pushEvents(state: FarmStateV2, events: FarmEvent[]) {
  state.events = [...events, ...(state.events ?? [])].slice(0, MAX_EVENTS);
}

/** 检查是否进入新的一日（中国时区），用于宠物衰减、每日次数清零 */
export function isNewChinaDay(prev: number, now: number): boolean {
  return getChinaDateString(prev) !== getChinaDateString(now);
}
