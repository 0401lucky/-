'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FarmStatusResponse, CropIdV2, ShopItemKey, PetType, PetTask,
  HarvestResult, StealCandidate, FarmEvent,
} from '@/lib/types/farm-v2';

interface UseFarmGameReturn {
  status: FarmStatusResponse | null;
  loading: boolean;
  actionLoading: boolean;
  error: string | null;
  toast: { type: 'info' | 'success' | 'error'; text: string } | null;
  setToast: (t: UseFarmGameReturn['toast']) => void;
  refresh: () => Promise<void>;
  plant: (plotIndex: number, cropId: CropIdV2) => Promise<boolean>;
  water: (plotIndex: number) => Promise<void>;
  waterAll: () => Promise<void>;
  harvest: (plotIndex: number) => Promise<HarvestResult | null>;
  harvestAll: () => Promise<{ results: HarvestResult[]; total: number } | null>;
  removeWithered: (plotIndex: number) => Promise<void>;
  buyLand: (landIndex: number) => Promise<void>;
  buyItem: (key: ShopItemKey, qty?: number) => Promise<boolean>;
  buySeed: (cropId: CropIdV2, qty?: number) => Promise<boolean>;
  useItem: (key: ShopItemKey, plotIndex?: number) => Promise<void>;
  adoptPet: (type: PetType, name?: string) => Promise<void>;
  feedPet: (kind: 'normal' | 'premium') => Promise<void>;
  drinkPet: (itemKey?: ShopItemKey) => Promise<void>;
  carePet: (itemKey?: ShopItemKey) => Promise<void>;
  restPet: (itemKey?: ShopItemKey) => Promise<void>;
  playPet: (itemKey?: ShopItemKey) => Promise<void>;
  dispatchPet: (task: Exclude<PetTask, null>) => Promise<void>;
  loadStealList: () => Promise<StealCandidate[]>;
  doSteal: (targetUserId: number) => Promise<{ success: boolean; amount?: number; cropName?: string } | null>;
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

const PASSIVE_EVENT_TOAST_WINDOW_MS = 15_000;

function isPassivePetEvent(event: FarmEvent): boolean {
  return event.type === 'pet_task'
    && (event.text.includes('宠物收菜被动触发') || event.text.includes('宠物种菜被动触发'));
}

function summarizePassivePetEvents(events: FarmEvent[]): string {
  const eventPriority = (event: FarmEvent) => event.text.includes('宠物收菜被动触发') ? 0 : 1;
  const summaries = events
    .slice()
    .sort((a, b) => eventPriority(a) - eventPriority(b) || a.ts - b.ts)
    .map((event) => event.text
      .replace(/^宠物收菜被动触发，?/, '')
      .replace(/^宠物种菜被动触发，?/, ''))
    .filter(Boolean);

  return `宠物被动已触发：${summaries.join('；')}`;
}

export function useFarmGame(): UseFarmGameReturn {
  const [status, setStatus] = useState<FarmStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<UseFarmGameReturn['toast']>(null);
  const tickerRef = useRef<NodeJS.Timeout | null>(null);
  const actionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingActionCountRef = useRef(0);
  const pendingActionKeysRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const seenPassiveEventIdsRef = useRef<Set<string>>(new Set());

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

  useEffect(() => {
    if (!status) return;

    const seen = seenPassiveEventIdsRef.current;
    const passiveEvents = (status.state.events ?? []).filter(isPassivePetEvent);
    const freshEvents = passiveEvents.filter((event) => {
      if (seen.has(event.id)) return false;
      if (seen.size === 0) {
        return Math.abs(status.serverNow - event.ts) <= PASSIVE_EVENT_TOAST_WINDOW_MS;
      }
      return true;
    });

    passiveEvents.forEach((event) => seen.add(event.id));

    if (freshEvents.length > 0) {
      setToast({ type: 'success', text: summarizePassivePetEvents(freshEvents) });
    }
  }, [status]);

  const wrap = useCallback(<T>(fn: () => Promise<T>, actionKey?: string): Promise<T | null> => {
    if (actionKey) {
      const pending = pendingActionKeysRef.current.get(actionKey);
      if (pending) return pending as Promise<T | null>;
    }

    pendingActionCountRef.current += 1;
    setActionLoading(true);
    setToast({ type: 'info', text: '操作已提交，正在处理...' });
    const run = async (): Promise<T | null> => {
      try {
        const r = await fn();
        return r;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : '操作失败';
        setToast({ type: 'error', text: msg });
        return null;
      } finally {
        pendingActionCountRef.current = Math.max(0, pendingActionCountRef.current - 1);
        if (actionKey) pendingActionKeysRef.current.delete(actionKey);
        if (pendingActionCountRef.current === 0) setActionLoading(false);
      }
    };

    const queued = actionQueueRef.current.then(run, run);
    actionQueueRef.current = queued.then(() => undefined, () => undefined);
    if (actionKey) pendingActionKeysRef.current.set(actionKey, queued);
    return queued;
  }, []);

  const plant = useCallback(async (plotIndex: number, cropId: CropIdV2) => {
    return (await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/plant', { plotIndex, cropId });
      setStatus(r.data);
      setToast({ type: 'success', text: '种植成功' });
      return true;
    }, `plant:${plotIndex}:${cropId}`)) === true;
  }, [wrap]);

  const water = useCallback(async (plotIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; bonus?: number }>('/api/farm/water', { plotIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: r.bonus ? `浇水成功 +${r.bonus} 引导奖励` : '浇水完成' });
    }, `water:${plotIndex}`);
  }, [wrap]);

  const waterAll = useCallback(async () => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; count: number }>('/api/farm/water-all');
      setStatus(r.data);
      setToast({ type: 'success', text: r.count > 0 ? `一键浇水 ${r.count} 块` : '没有需要浇水的作物' });
    }, 'water-all');
  }, [wrap]);

  const harvest = useCallback(async (plotIndex: number) => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; harvest: HarvestResult }>('/api/farm/harvest', { plotIndex });
      setStatus(r.data);
      return r.harvest;
    }, `harvest:${plotIndex}`);
  }, [wrap]);

  const harvestAll = useCallback(async () => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; harvests: HarvestResult[]; total: number }>('/api/farm/harvest-all');
      setStatus(r.data);
      return { results: r.harvests, total: r.total };
    }, 'harvest-all');
  }, [wrap]);

  const removeWithered = useCallback(async (plotIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/remove', { plotIndex });
      setStatus(r.data);
    }, `remove:${plotIndex}`);
  }, [wrap]);

  const buyLand = useCallback(async (landIndex: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/buy-land', { landIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: `第 ${landIndex} 块土地已开垦` });
    }, `buy-land:${landIndex}`);
  }, [wrap]);

  const buyItem = useCallback(async (key: ShopItemKey, qty = 1) => {
    return (await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/shop/buy', { key, qty });
      setStatus(r.data);
      setToast({ type: 'success', text: `购买成功 x${qty}` });
      return true;
    }, `buy-item:${key}:${qty}`)) === true;
  }, [wrap]);

  const buySeed = useCallback(async (cropId: CropIdV2, qty = 1) => {
    return (await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/seeds/buy', { cropId, qty });
      setStatus(r.data);
      setToast({ type: 'success', text: `种子购买成功 x${qty}` });
      return true;
    }, `buy-seed:${cropId}:${qty}`)) === true;
  }, [wrap]);

  const useItem = useCallback(async (key: ShopItemKey, plotIndex?: number) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/shop/use', { key, plotIndex });
      setStatus(r.data);
      setToast({ type: 'success', text: '使用成功' });
    }, `use-item:${key}:${plotIndex ?? 'none'}`);
  }, [wrap]);

  const adoptPet = useCallback(async (type: PetType, name?: string) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/adopt', { type, name });
      setStatus(r.data);
      setToast({ type: 'success', text: '成功领养宠物' });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('farm:pet-updated'));
      }
    }, `adopt-pet:${type}:${name ?? ''}`);
  }, [wrap]);

  const feedPet = useCallback(async (kind: 'normal' | 'premium') => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/feed', { kind });
      setStatus(r.data);
    }, `feed-pet:${kind}`);
  }, [wrap]);

  const carePet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/wash', { itemKey });
      setStatus(r.data);
    }, `care-pet:${itemKey ?? 'free'}`);
  }, [wrap]);

  const drinkPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/drink', { itemKey });
      setStatus(r.data);
    }, `drink-pet:${itemKey ?? 'free'}`);
  }, [wrap]);

  const restPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/play', { mode: 'rest', itemKey });
      setStatus(r.data);
    }, `rest-pet:${itemKey ?? 'free'}`);
  }, [wrap]);

  const playPet = useCallback(async (itemKey?: ShopItemKey) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse }>('/api/farm/pet/play', { mode: 'play', itemKey });
      setStatus(r.data);
    }, `play-pet:${itemKey ?? 'free'}`);
  }, [wrap]);

  const dispatchPet = useCallback(async (task: Exclude<PetTask, null>) => {
    await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; message?: string }>('/api/farm/pet/dispatch', { task });
      setStatus(r.data);
      setToast({ type: 'success', text: r.message ?? '宠物技能已发动' });
    }, `dispatch-pet:${task}`);
  }, [wrap]);

  const loadStealList = useCallback(async (): Promise<StealCandidate[]> => {
    try {
      const r = await callApi<{ data: { candidates: StealCandidate[] } }>('/api/farm/steal/list', undefined, 'GET');
      return r.data.candidates;
    } catch {
      return [];
    }
  }, []);

  const doSteal = useCallback(async (targetUserId: number) => {
    return await wrap(async () => {
      const r = await callApi<{ data: FarmStatusResponse; steal: { success: boolean; amount?: number; cropName?: string } }>(
        '/api/farm/steal/do', { targetUserId },
      );
      setStatus(r.data);
      return r.steal;
    }, `steal:${targetUserId}`);
  }, [wrap]);

  return {
    status, loading, actionLoading, error, toast, setToast, refresh,
    plant, water, waterAll, harvest, harvestAll, removeWithered, buyLand,
    buyItem, buySeed, useItem, adoptPet, feedPet, drinkPet, carePet, restPet, playPet,
    dispatchPet, loadStealList, doSteal,
  };
}
