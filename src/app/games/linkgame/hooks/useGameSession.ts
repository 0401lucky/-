'use client';

import { useState, useCallback, useRef } from 'react';
import { requestGameFallback } from '../../_lib/fallback';
import type {
  LinkGameDifficulty,
  LinkGameDifficultyConfig,
  LinkGameMove,
  LinkGameSettlementOutcome,
} from '@/lib/types/game';

interface GameSession {
  sessionId: string;
  difficulty: LinkGameDifficulty;
  tileLayout: (string | null)[];
  startedAt: number;
  expiresAt: number;
  playableUntil: number;
  remainingSeconds: number;
  config: LinkGameDifficultyConfig;
}

interface GameStatus {
  balance: number;
  dailyStats: {
    gamesPlayed: number;
    pointsEarned: number;
  } | null;
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  activeSession: GameSession | null;
}

interface GameResult {
  record: {
    id: string;
    moves: number;
    completed: boolean;
    outcome?: LinkGameSettlementOutcome;
    score: number;
    pointsEarned: number;
    duration: number;
  };
  pointsEarned: number;
}

const SUBMIT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useGameSession() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false);
  
  const hasSubmittedRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/games/linkgame/status');
      const data = await res.json();
      
      if (data.success) {
        setStatus(data.data);
        
        if (data.data.activeSession) {
          setSession(data.data.activeSession);
          setIsRestored(true);
        }
      }
    } catch (err) {
      console.error('Fetch status error:', err);
    }
  }, []);

  const startGame = useCallback(async (difficulty: LinkGameDifficulty) => {
    setLoading(true);
    setError(null);
    hasSubmittedRef.current = false;
    setIsRestored(false);
    
    try {
      const res = await fetch('/api/games/linkgame/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        setError(data.message || '开始游戏失败');
        return false;
      }
      
      setSession(data.data);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelGame = useCallback(async () => {
    if (!session) return false;
    
    setLoading(true);
    try {
      const res = await fetch('/api/games/linkgame/cancel', {
        method: 'POST',
      });
      
      const data = await res.json();
      
      if (data.success) {
        setSession(null);
        setIsRestored(false);
        // [Perf] 后台非阻塞刷新
        fetchStatus();
        return true;
      }
      
      setError(data.message || '取消游戏失败');
      return false;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setLoading(false);
    }
  }, [session, fetchStatus]);

  const submitResult = useCallback(async (
    moves: LinkGameMove[],
    completed: boolean,
    outcome?: LinkGameSettlementOutcome
  ): Promise<GameResult | null> => {
    if (!session) {
      setError('游戏会话已丢失，请刷新页面后重试');
      return null;
    }

    if (hasSubmittedRef.current) return null;
    
    hasSubmittedRef.current = true;
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetchWithTimeout(
        '/api/games/linkgame/submit',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session.sessionId,
            moves,
            completed,
            outcome,
            duration: 0,
          }),
        },
        SUBMIT_TIMEOUT_MS
      );
      
      const data = await res.json();
      
      if (!data.success) {
        if (res.status >= 500) {
          const fallback = await requestGameFallback<GameResult['record']>({
            game: 'linkgame',
            sessionId: session.sessionId,
            moves,
            completed,
            outcome,
            duration: 0,
          });
          if (fallback) {
            setSession(null);
            fetchStatus();
            return {
              record: fallback.record,
              pointsEarned: fallback.pointsEarned,
            };
          }
        }
        hasSubmittedRef.current = false;
        setError(data.message || '提交结果失败');
        return null;
      }
      
      setSession(null);
      // [Perf] 后台非阻塞刷新
      fetchStatus();

      return data.data;
    } catch (err) {
      try {
        const fallback = await requestGameFallback<GameResult['record']>({
          game: 'linkgame',
          sessionId: session.sessionId,
          moves,
          completed,
          outcome,
          duration: 0,
        });
        if (fallback) {
          setSession(null);
          fetchStatus();
          return {
            record: fallback.record,
            pointsEarned: fallback.pointsEarned,
          };
        }
      } catch (fallbackError) {
        console.error('Linkgame fallback settlement error:', fallbackError);
      }
      hasSubmittedRef.current = false;
      setError(isAbortError(err) ? '结算请求超时，请检查网络后重试' : '网络错误，请稍后重试');
      return null;
    } finally {
      setLoading(false);
    }
  }, [session, fetchStatus]);

  const resetSubmitFlag = useCallback(() => {
    hasSubmittedRef.current = false;
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
  };
}
