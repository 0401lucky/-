'use client';

import { useCallback, useRef, useState } from 'react';

interface TowerSession {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
}

export interface TowerRecord {
  id: string;
  floorsClimbed: number;
  finalPower: number;
  gameOver: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  createdAt: number;
}

interface TowerStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: TowerRecord[];
  activeSession: TowerSession | null;
}

interface SubmitResponse {
  record: TowerRecord;
  pointsEarned: number;
}

interface SubmitFailure {
  failed: true;
  expired: boolean;
}

type SubmitResult = SubmitResponse | SubmitFailure;

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

interface StartResponse {
  sessionId: string;
  seed: string;
  startedAt: number;
  expiresAt: number;
}

async function parseApiResponse<T>(res: Response): Promise<ApiResponse<T> | null> {
  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return null;
  }
}

function buildHttpErrorMessage<T>(res: Response, data: ApiResponse<T> | null, fallback: string): string {
  return data?.message ?? `${fallback}（HTTP ${res.status}）`;
}

export function useGameSession() {
  const [session, setSession] = useState<TowerSession | null>(null);
  const [status, setStatus] = useState<TowerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);

  const hasSubmittedRef = useRef(false);
  const submitInFlightRef = useRef<Promise<SubmitResult | null> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/games/tower/status');
      const data = await parseApiResponse<TowerStatus>(res);

      if (!res.ok) {
        setError(buildHttpErrorMessage(res, data, '获取游戏状态失败'));
        return;
      }

      if (!data?.success || !data.data) {
        setError(data?.message ?? '获取游戏状态失败');
        return;
      }

      setStatus(data.data);
      setError(null);

      if (data.data.activeSession) {
        setSession(data.data.activeSession);
        setIsRestored(true);
      }
    } catch (err) {
      console.error('Fetch tower status error:', err);
      setError('网络错误，无法获取游戏状态');
    }
  }, []);

  const startGame = useCallback(async () => {
    setLoading(true);
    setError(null);
    hasSubmittedRef.current = false;
    submitInFlightRef.current = null;
    setIsRestored(false);

    try {
      const res = await fetch('/api/games/tower/start', { method: 'POST' });
      const data = await parseApiResponse<StartResponse>(res);

      if (!res.ok) {
        setError(buildHttpErrorMessage(res, data, '开始游戏失败'));
        return false;
      }

      if (!data?.success || !data.data) {
        setError(data?.message || '开始游戏失败');
        return false;
      }

      setSession({
        sessionId: data.data.sessionId,
        seed: data.data.seed,
        startedAt: data.data.startedAt,
        expiresAt: data.data.expiresAt,
      });

      return true;
    } catch {
      setError('网络错误，开始游戏失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelGame = useCallback(async () => {
    if (!session) return false;

    setLoading(true);
    try {
      const res = await fetch('/api/games/tower/cancel', { method: 'POST' });
      const data = await parseApiResponse<null>(res);

      if (!res.ok) {
        setError(buildHttpErrorMessage(res, data, '取消游戏失败'));
        return false;
      }

      if (data?.success) {
        setSession(null);
        setIsRestored(false);
        hasSubmittedRef.current = false;
        submitInFlightRef.current = null;
        await fetchStatus();
        return true;
      }

      setError(data?.message || '取消游戏失败');
      return false;
    } catch {
      setError('网络错误，取消游戏失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, [session, fetchStatus]);

  const submitResult = useCallback(
    async (choices: number[]): Promise<SubmitResult | null> => {
      if (!session) return null;

      if (submitInFlightRef.current) {
        return submitInFlightRef.current;
      }

      if (hasSubmittedRef.current) return null;
      hasSubmittedRef.current = true;
      setLoading(true);

      const submitPromise = (async (): Promise<SubmitResult | null> => {
        try {
          const res = await fetch('/api/games/tower/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, choices }),
          });
          const data = await parseApiResponse<SubmitResponse>(res);

          if (!res.ok || !data?.success || !data.data) {
            hasSubmittedRef.current = false;
            const msg = data?.message ?? `结算提交失败（HTTP ${res.status}）`;
            const isExpired = /过期|不存在/.test(msg);
            setError(isExpired ? '游戏会话已过期，本局无法结算' : msg);
            return { failed: true, expired: isExpired };
          }

          setError(null);
          setSession(null);
          setIsRestored(false);
          await fetchStatus();
          return data.data;
        } catch {
          hasSubmittedRef.current = false;
          setError('结算提交失败，网络异常，请稍后重试');
          return { failed: true, expired: false };
        } finally {
          setLoading(false);
          submitInFlightRef.current = null;
        }
      })();

      submitInFlightRef.current = submitPromise;
      return submitPromise;
    },
    [session, fetchStatus]
  );

  const resetSubmitFlag = useCallback(() => {
    hasSubmittedRef.current = false;
    submitInFlightRef.current = null;
  }, []);

  return {
    session,
    status,
    loading,
    error,
    isRestored,
    fetchStatus,
    startGame,
    cancelGame,
    submitResult,
    resetSubmitFlag,
    setError,
    setSession,
    setIsRestored,
  };
}
