'use client';

import { useState, useCallback } from 'react';
import type { BallLaunch } from '@/lib/types/game';

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
  activeSession?: {
    sessionId: string;
    seed: string;
    expiresAt: number;
  } | null;
}

interface GameSession {
  sessionId: string;
  seed: string;
  expiresAt: number;
}

export function useGameSession() {
  const [session, setSession] = useState<GameSession | null>(null);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRestored, setIsRestored] = useState(false); // 是否为恢复的会话

  // 获取游戏状态
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/games/pachinko/status');
      const data = await res.json();
      if (data.success) {
        setStatus(data.data);
        // 如果有活跃会话，自动恢复
        if (data.data.activeSession) {
          setSession(data.data.activeSession);
          setIsRestored(true); // 标记为恢复会话
        }
      }
    } catch (err) {
      console.error('Fetch status error:', err);
    }
  }, []);

  // 开始游戏
  const startGame = useCallback(async (): Promise<GameSession | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch('/api/games/pachinko/start', { method: 'POST' });
      const data = await res.json();
      
      if (!data.success) {
        setError(data.message || '无法开始游戏');
        return null;
      }
      
      const newSession: GameSession = {
        sessionId: data.data.sessionId,
        seed: data.data.seed,
        expiresAt: data.data.expiresAt,
      };
      
      setSession(newSession);
      setIsRestored(false); // 新开的游戏，不是恢复
      return newSession;
    } catch (err) {
      setError('网络错误');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // 取消游戏
  const cancelGame = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    
    try {
      const res = await fetch('/api/games/pachinko/cancel', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        setSession(null);
        await fetchStatus();
        return true;
      }
      
      setError(data.message || '取消失败');
      return false;
    } catch (err) {
      setError('网络错误');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  // 提交游戏结果
  const submitResult = useCallback(async (
    score: number,
    duration: number,
    balls: BallLaunch[]
  ): Promise<{ success: boolean; pointsEarned?: number; message?: string }> => {
    if (!session) {
      return { success: false, message: '无效会话' };
    }
    
    setLoading(true);
    
    try {
      const res = await fetch('/api/games/pachinko/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.sessionId,
          score,
          duration,
          balls,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setSession(null);
        await fetchStatus();
        return { 
          success: true, 
          pointsEarned: data.data.pointsEarned,
          message: data.message 
        };
      }
      
      return { success: false, message: data.message };
    } catch (err) {
      return { success: false, message: '网络错误' };
    } finally {
      setLoading(false);
    }
  }, [session, fetchStatus]);

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
  };
}
