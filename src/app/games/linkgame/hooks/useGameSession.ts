'use client';

import { useState, useCallback, useRef } from 'react';
import type { LinkGameDifficulty, LinkGameDifficultyConfig, LinkGameMove } from '@/lib/types/game';

interface GameSession {
  sessionId: string;
  difficulty: LinkGameDifficulty;
  tileLayout: (string | null)[];
  expiresAt: number;
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
    score: number;
    pointsEarned: number;
    duration: number;
    hintsUsed: number;
    shufflesUsed: number;
  };
  pointsEarned: number;
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
        await fetchStatus();
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
    hintsUsed: number,
    shufflesUsed: number,
    timeRemaining: number,
    completed: boolean
  ): Promise<GameResult | null> => {
    if (!session || hasSubmittedRef.current) return null;
    
    hasSubmittedRef.current = true;
    setLoading(true);
    
    try {
      const res = await fetch('/api/games/linkgame/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          moves,
          hintsUsed,
          shufflesUsed,
          timeRemaining,
          completed,
        }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        hasSubmittedRef.current = false;
        setError(data.message || '提交结果失败');
        return null;
      }
      
      setSession(null);
      await fetchStatus();
      
      return data.data;
    } catch {
      hasSubmittedRef.current = false;
      setError('网络错误');
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
