'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { createPhysicsEngine, PhysicsEngine } from '../lib/physics';
import { BALLS_PER_GAME } from '../lib/constants';
import type { BallLaunch } from '@/lib/types/game';

export function useGameEngine(seed: string | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PhysicsEngine | null>(null);
  const gameStartTimeRef = useRef<number | null>(null);
  
  const [ballsRemaining, setBallsRemaining] = useState(BALLS_PER_GAME);
  const [currentScore, setCurrentScore] = useState(0);
  const [ballResults, setBallResults] = useState<BallLaunch[]>([]);
  const [isLaunching, setIsLaunching] = useState(false);

  // 初始化物理引擎
  useEffect(() => {
    if (!canvasRef.current || !seed) return;

    const onBallLanded = () => {
      // 分数已在 launchBall 中更新，这里只需重置发射状态
      setIsLaunching(false);
    };

    const engine = createPhysicsEngine(canvasRef.current, seed, onBallLanded);
    engine.start();
    engineRef.current = engine;
    gameStartTimeRef.current = Date.now();

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [seed]);

  // 发射弹珠
  const launchBall = useCallback(async (angle: number, power: number): Promise<number> => {
    if (!engineRef.current || ballsRemaining <= 0 || isLaunching) {
      return 0;
    }

    setIsLaunching(true);
    setBallsRemaining(prev => prev - 1);
    
    const launchStart = Date.now();
    const score = await engineRef.current.launchBall(angle, power);
    const duration = Date.now() - launchStart;
    
    const ballLaunch: BallLaunch = {
      angle,
      power,
      slotScore: score,
      duration,
    };
    
    setBallResults(prev => [...prev, ballLaunch]);
    setCurrentScore(prev => prev + score);
    setIsLaunching(false);
    
    return score;
  }, [ballsRemaining, isLaunching]);

  // 重置游戏状态
  const reset = useCallback(() => {
    setBallsRemaining(BALLS_PER_GAME);
    setCurrentScore(0);
    setBallResults([]);
    setIsLaunching(false);
    gameStartTimeRef.current = null;
    if (engineRef.current) {
      engineRef.current.reset();
    }
  }, []);

  // 获取游戏时长
  const getGameDuration = useCallback(() => {
    return gameStartTimeRef.current ? Date.now() - gameStartTimeRef.current : 0;
  }, []);

  return {
    canvasRef,
    ballsRemaining,
    currentScore,
    ballResults,
    isLaunching,
    isGameOver: ballsRemaining === 0 && !isLaunching,
    launchBall,
    reset,
    getGameDuration,
  };
}
