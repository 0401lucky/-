'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FarmStatusResponse, CropIdV2, ShopItemKey, PetType, PetTask,
  HarvestResult, StealCandidate,
} from '@/lib/types/farm-v2';

interface UseFarmGameReturn {
  status: FarmStatusResponse | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  toast: { type: 'info' | 'success' | 'error'; text: string } | null;
  setToast: (t: UseFarmGameReturn['toast']) => void;
  refresh: () => Promise<void>;
  plant: (plotIndex: number, cropId: CropIdV2) => Promise<void>;
  water: (plotIndex: number) => Promise<void>;
  waterAll: () => Promise<void>;
  harvest: (plotIndex: number) => Promise<HarvestResult | null>;
  harvestAll: () => Promise<{ results: HarvestResult[]; total: number } | null>;
  removeWithered: (plotIndex: number) => Promise<void>;
  buyLand: (landIndex: number) => Promise<void>;
  buyItem: (key: ShopItemKey, qty?: number) => Promise<void>;
  buySeed: (cropId: CropIdV2, qty?: number) => Promise<void>;
  useItem: (key: ShopItemKey, plotIndex?: number) => Promise<void>;
  adoptPet: (type: PetType, name?: string) => Promise<void>;
  feedPet: (kind: 'normal' | 'premium') => Promise<void>;
  drinkPet: (itemKey?: ShopItemKey) => Promise<void>;
  carePet: (itemKey?: ShopItemKey) => Promise<void>;
  restPet: (itemKey?: ShopItemKey) => Promise<void>;
  playPet: (itemKey?: ShopItemKey) => Promise<void>;
  dispatchPet: (task: Exclude<PetTask, null>) => Promise<void>;
  loadStealList: () => Promise<StealCandidate[]>;
  doSteal: (targetUserId: number, landIndex: number) => Promise<{ success: boolean; amount?: number; lucky?: boolean } | null>;
}

async function callApi<T = unknown>(url: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    credentials: 'include',
  });
  const data = await res.json() as { success: boolean; message?: string } & T;
  if (!res.ok || !data.success) {
    throw new Error(data?.message || '操作失败');
  }
  return data;
}

export function useFarmGame(): UseFarmGameReturn {
  const [status, setStatus] = useState<FarmStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<UseFarmGameReturn['toast']>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/status');
      setStatus(r.data);
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '加载失败';
      setError(msg);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try { await refresh(); } finally { if (mounted) setLoading(false); }
    })();
    tickerRef.current = setInterval(() => { refresh().catch(() => {}); }, 30_000);
    return () => {
      mounted = false;
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [refresh]);

  const wrap = useCallback(async <T>(fn: () => Promise<T>): Promise<T | null> => {
    setActionLoading(true);
    try {
      const r = await fn();
      return r;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '操作失败';
      setToast({ type: 'error', text: msg });
      return null;
    } finally {
      setActionLoading(false);
    }
  }, []);

  const plant = useCallback(async (plotIndex: number, cropId: CropIdV2) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/plant', { plotIndex, cropId });
      setStatus(r.data);
      setToast({ type: 'success', text: '种植成功' });
    });
  }, [wrap]);

  const water = useCallback(async (plotIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; bonus?: number }>('/api/farm/water', { plotIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: r.bonus ? `浇水成功 +${r.bonus} 引导奖励` : '浇水完成' });
    });
  }, [wrap]);

  const waterAll = useCallback(async () => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; count: number }>('/api/farm/water-all');
      setStatus(r.data);
      setToast({ type: 'success', text: r.count > 0 ? `一键浇水 ${r.count} 块` : '没有需要浇水的作物' });
    });
  }, [wrap]);

  const harvest = useCallback(async (plotIndex: number) => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; harvest: HarvestResult }>('/api/farm/harvest', { plotIndex });
      setStatus(r.data);
      return r.harvest;
    });
  }, [wrap]);

  const harvestAll = useCallback(async () => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; harvests: HarvestResult[]; total: number }>('/api/farm/harvest-all');
      setStatus(r.data);
      return { results: r.harvests, total: r.total };
    });
  }, [wrap]);

  const removeWithered = useCallback(async (plotIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/remove', { plotIndex });
      setStatus(r.data);
    });
  }, [wrap]);

  const buyLand = useCallback(async (landIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/buy-land', { landIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: `第 ${landIndex} 块土地已开垦` });
    });
  }, [wrap]);

  const buyItem = useCallback(async (key: ShopItemKey, qty = 1) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/shop/buy', { key, qty });
      setStatus(r.data);
      setToast({ type: 'success', text: `购买成功 x${qty}` });
    });
  }, [wrap]);

  const buySeed = useCallback(async (cropId: CropIdV2, qty = 1) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/seeds/buy', { cropId, qty });
      setStatus(r.data);
      setToast({ type: 'success', text: `种子购买成功 x${qty}` });
    });
  }, [wrap]);

  const useItem = useCallback(async (key: ShopItemKey, plotIndex?: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/shop/use', { key, plotIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: '使用成功' });
    });
  }, [wrap]);

  const adoptPet = useCallback(async (type: PetType, name?: string) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/adopt', { type, name });
      setStatus(r.data);
      setToast({ type: 'success', text: '成功领养宠物' });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('farm:pet-updated'));
      }
    });
  }, [wrap]);

  const feedPet = useCallback(async (kind: 'normal' | 'premium') => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/feed', { kind });
      setStatus(r.data);
    });
  }, [wrap]);

  const carePet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/wash', { itemKey });
      setStatus(r.data);
    });
  }, [wrap]);

  const drinkPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/drink', { itemKey });
      setStatus(r.data);
    });
  }, [wrap]);

  const restPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/play', { mode: 'rest', itemKey });
      setStatus(r.data);
    });
  }, [wrap]);

  const playPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/play', { mode: 'play', itemKey });
      setStatus(r.data);
    });
  }, [wrap]);

  const dispatchPet = useCallback(async (task: Exclude<PetTask, null>) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; message?: string }>('/api/farm/pet/dispatch', { task });
      setStatus(r.data);
      setToast({ type: 'success', text: r.message ?? '宠物技能已发动' });
    });
  }, [wrap]);

  const loadStealList = useCallback(async (): Promise<StealCandidate[]> => {
    try {
      const r = await callApi<{ data: { candidates: StealCandidate[] } }>('/api/farm/steal/list', undefined, 'GET');
      return r.data.candidates;
    } catch {
      return [];
    }
  }, []);

  const doSteal = useCallback(async (targetUserId: number, landIndex: number) => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; steal: { success: boolean; amount?: number; lucky?: boolean } }>(
        '/api/farm/steal/do', { targetUserId, landIndex },
      );
      setStatus(r.data);
      return r.steal;
    });
  }, [wrap]);

  return {
    status, loading, actionLoading, error, toast, setToast, refresh,
    plant, water, waterAll, harvest, harvestAll, removeWithered, buyLand,
    buyItem, buySeed, useItem, adoptPet, feedPet, drinkPet, carePet, restPet, playPet,
    dispatchPet, loadStealList, doSteal,
  };
}
