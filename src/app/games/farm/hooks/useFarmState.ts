// src/app/games/farm/hooks/useFarmState.ts

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FarmState, WeatherType, HarvestDetail, FarmLevel } from '@/lib/types/farm';
import { computePlotState, getTodayWeather } from '@/lib/farm-engine';
import type { ComputedPlotState } from '@/lib/types/farm';

export interface BatchHarvestResult {
  harvests: HarvestDetail[];
  totalPointsEarned: number;
  harvestedCount: number;
  newBalance: number;
  dailyEarned: number;
  limitReached: boolean;
  expGained: number;
}

interface FarmData {
  farmState: FarmState | null;
  weather: WeatherType;
  balance: number;
  dailyEarned: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  loading: boolean;
  error: string | null;
  computedPlots: ComputedPlotState[];
  // 操作
  initFarm: () => Promise<void>;
  plant: (plotIndex: number, cropId: string) => Promise<boolean>;
  water: (plotIndex: number) => Promise<boolean>;
  waterAll: () => Promise<number>;
  harvest: (plotIndex: number) => Promise<HarvestResult | null>;
  harvestAll: () => Promise<BatchHarvestResult | null>;
  removePest: (plotIndex: number) => Promise<boolean>;
  removeCrop: (plotIndex: number) => Promise<boolean>;
  removeAllWithered: () => Promise<number>;
  // 操作状态
  actionLoading: boolean;
  lastHarvest: HarvestResult | null;
  clearLastHarvest: () => void;
  lastBatchHarvest: BatchHarvestResult | null;
  clearLastBatchHarvest: () => void;
  levelUpInfo: LevelUpInfo | null;
  clearLevelUp: () => void;
}

export interface HarvestResult {
  harvest: HarvestDetail;
  pointsEarned: number;
  newBalance: number;
  dailyEarned: number;
  limitReached: boolean;
  expGained: number;
}

export interface LevelUpInfo {
  newLevel: FarmLevel;
  title: string;
}

// 简单获取今日日期字符串 (中国时区)
function getTodayDateStr(): string {
  const now = new Date();
  const chinaTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = chinaTime.getUTCFullYear();
  const month = String(chinaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(chinaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function useFarmState(): FarmData {
  const [farmState, setFarmState] = useState<FarmState | null>(null);
  const [weather, setWeather] = useState<WeatherType>(() => getTodayWeather(getTodayDateStr()));
  const [balance, setBalance] = useState(0);
  const [dailyEarned, setDailyEarned] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(2000);
  const [pointsLimitReached, setPointsLimitReached] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastHarvest, setLastHarvest] = useState<HarvestResult | null>(null);
  const [lastBatchHarvest, setLastBatchHarvest] = useState<BatchHarvestResult | null>(null);
  const [levelUpInfo, setLevelUpInfo] = useState<LevelUpInfo | null>(null);
  const [computedPlots, setComputedPlots] = useState<ComputedPlotState[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 客户端每30秒刷新展示状态
  useEffect(() => {
    if (!farmState) return;

    const updateComputed = () => {
      const now = Date.now();
      const plots = farmState.plots.map(plot =>
        computePlotState(plot, now, weather, farmState.userId)
      );
      setComputedPlots(plots);
    };

    updateComputed();
    refreshTimerRef.current = setInterval(updateComputed, 30_000);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [farmState, weather]);

  const updateFromResponse = useCallback((data: {
    farmState?: FarmState;
    balance?: number;
    newBalance?: number;
    dailyEarned?: number;
    dailyLimit?: number;
    pointsLimitReached?: boolean;
    weather?: WeatherType;
  }) => {
    if (data.farmState) setFarmState(data.farmState);
    if (data.balance !== undefined) setBalance(data.balance);
    if (data.newBalance !== undefined) setBalance(data.newBalance);
    if (data.dailyEarned !== undefined) setDailyEarned(data.dailyEarned);
    if (data.dailyLimit !== undefined) setDailyLimit(data.dailyLimit);
    if (data.pointsLimitReached !== undefined) setPointsLimitReached(data.pointsLimitReached);
    if (data.weather) setWeather(data.weather);
  }, []);

  const initFarm = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/games/farm/init', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '初始化失败');
      updateFromResponse(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  }, [updateFromResponse]);

  const syncStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/games/farm/status');
      const data = await res.json();
      if (data.success && data.data.initialized) {
        updateFromResponse(data.data);
      }
    } catch {
      // 静默失败
    }
  }, [updateFromResponse]);

  // 页面获得焦点时同步状态
  useEffect(() => {
    const onFocus = () => {
      if (farmState) {
        void syncStatus();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [farmState, syncStatus]);

  const plant = useCallback(async (plotIndex: number, cropId: string): Promise<boolean> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/plant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIndex, cropId }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return false;
      }
      updateFromResponse(data.data);
      setError(null);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const water = useCallback(async (plotIndex: number): Promise<boolean> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIndex }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return false;
      }
      updateFromResponse(data.data);
      setError(null);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const waterAll = useCallback(async (): Promise<number> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waterAll: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return 0;
      }
      updateFromResponse(data.data);
      setError(null);
      return data.data.wateredCount ?? 0;
    } catch {
      setError('网络错误');
      return 0;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const harvest = useCallback(async (plotIndex: number): Promise<HarvestResult | null> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIndex }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return null;
      }
      updateFromResponse(data.data);
      setError(null);

      const result: HarvestResult = {
        harvest: data.data.harvest,
        pointsEarned: data.data.pointsEarned,
        newBalance: data.data.newBalance,
        dailyEarned: data.data.dailyEarned,
        limitReached: data.data.limitReached,
        expGained: data.data.expGained,
      };
      setLastHarvest(result);

      // 检查升级
      if (data.data.levelUp && data.data.newLevel) {
        const TITLES: Record<number, string> = { 1: '新手农夫', 2: '勤劳农夫', 3: '资深农夫', 4: '农场主', 5: '农业大亨' };
        setLevelUpInfo({
          newLevel: data.data.newLevel,
          title: TITLES[data.data.newLevel] || '',
        });
      }

      return result;
    } catch {
      setError('网络错误');
      return null;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const harvestAllAction = useCallback(async (): Promise<BatchHarvestResult | null> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ harvestAll: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return null;
      }
      updateFromResponse(data.data);
      setError(null);

      const result: BatchHarvestResult = {
        harvests: data.data.harvests,
        totalPointsEarned: data.data.totalPointsEarned,
        harvestedCount: data.data.harvestedCount,
        newBalance: data.data.newBalance,
        dailyEarned: data.data.dailyEarned,
        limitReached: data.data.limitReached,
        expGained: data.data.expGained,
      };
      setLastBatchHarvest(result);

      // 检查升级
      if (data.data.levelUp && data.data.newLevel) {
        const TITLES: Record<number, string> = { 1: '新手农夫', 2: '勤劳农夫', 3: '资深农夫', 4: '农场主', 5: '农业大亨' };
        setLevelUpInfo({
          newLevel: data.data.newLevel,
          title: TITLES[data.data.newLevel] || '',
        });
      }

      return result;
    } catch {
      setError('网络错误');
      return null;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const removeAllWitheredAction = useCallback(async (): Promise<number> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/remove-crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeAllWithered: true }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return 0;
      }
      updateFromResponse(data.data);
      setError(null);
      return data.data.removedCount ?? 0;
    } catch {
      setError('网络错误');
      return 0;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const removePestAction = useCallback(async (plotIndex: number): Promise<boolean> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/remove-pest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIndex }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return false;
      }
      updateFromResponse(data.data);
      setError(null);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  const removeCropAction = useCallback(async (plotIndex: number): Promise<boolean> => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/games/farm/remove-crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plotIndex }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message);
        return false;
      }
      updateFromResponse(data.data);
      setError(null);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setActionLoading(false);
    }
  }, [updateFromResponse]);

  // 初始加载
  useEffect(() => {
    void initFarm();
  }, [initFarm]);

  return {
    farmState,
    weather,
    balance,
    dailyEarned,
    dailyLimit,
    pointsLimitReached,
    loading,
    error,
    computedPlots,
    initFarm,
    plant,
    water,
    waterAll,
    harvest,
    harvestAll: harvestAllAction,
    removePest: removePestAction,
    removeCrop: removeCropAction,
    removeAllWithered: removeAllWitheredAction,
    actionLoading,
    lastHarvest,
    clearLastHarvest: () => setLastHarvest(null),
    lastBatchHarvest,
    clearLastBatchHarvest: () => setLastBatchHarvest(null),
    levelUpInfo,
    clearLevelUp: () => setLevelUpInfo(null),
  };
}
