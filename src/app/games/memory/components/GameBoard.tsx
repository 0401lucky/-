// src/app/games/memory/components/GameBoard.tsx

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card } from './Card';
import type { MemoryDifficulty, MemoryDifficultyConfig, MemoryMove } from '@/lib/types/game';
import { DIFFICULTY_META } from '../lib/constants';

interface GameBoardProps {
  difficulty: MemoryDifficulty;
  cardLayout: string[];
  config: MemoryDifficultyConfig;
  onGameEnd: (moves: MemoryMove[], completed: boolean, duration: number) => void;
  isRestored?: boolean;
}

export function GameBoard({
  difficulty,
  cardLayout,
  config,
  onGameEnd,
  isRestored = false,
}: GameBoardProps) {
  const [flippedCards, setFlippedCards] = useState<number[]>([]);
  const [matchedCards, setMatchedCards] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState<MemoryMove[]>([]);
  const [moveCount, setMoveCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(config.timeLimit);
  const [isChecking, setIsChecking] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const flipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const endCalledRef = useRef(false);  // P2: 防止 onGameEnd 调用两次
  const movesRef = useRef<MemoryMove[]>([]);  // 用于 timer 回调中访问最新 moves

  const difficultyMeta = DIFFICULTY_META[difficulty];

  // 同步 movesRef
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  useEffect(() => {
    startTimeRef.current = Date.now();
  }, []);

  // 计算预估得分
  const estimatedScore = useCallback(() => {
    const optimalMoves = config.pairs;
    const extraMoves = Math.max(0, moveCount - optimalMoves);
    return Math.max(config.minScore, config.baseScore - extraMoves * config.penaltyPerMove);
  }, [moveCount, config]);

  // 游戏结束处理（只调用一次）
  const handleGameEnd = useCallback((completed: boolean) => {
    if (endCalledRef.current) return;
    endCalledRef.current = true;
    setHasEnded(true);
    
    // 清理定时器
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
    
    const duration = Date.now() - startTimeRef.current;
    onGameEnd(movesRef.current, completed, duration);
  }, [onGameEnd]);

  // 倒计时
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          // 时间到，游戏结束
          handleGameEnd(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (flipTimeoutRef.current) {
        clearTimeout(flipTimeoutRef.current);
      }
    };
  }, [handleGameEnd]);

  // 检查是否完成
  useEffect(() => {
    if (matchedCards.size === cardLayout.length && !endCalledRef.current) {
      Promise.resolve().then(() => handleGameEnd(true));
    }
  }, [matchedCards.size, cardLayout.length, handleGameEnd]);

  // 翻牌逻辑
  const handleCardClick = useCallback((index: number) => {
    if (isChecking || endCalledRef.current || flippedCards.includes(index) || matchedCards.has(index)) {
      return;
    }

    if (flippedCards.length === 0) {
      // 翻第一张
      setFlippedCards([index]);
    } else if (flippedCards.length === 1) {
      // 翻第二张
      const firstIndex = flippedCards[0];
      setFlippedCards([firstIndex, index]);
      setIsChecking(true);
      setMoveCount(prev => prev + 1);

      // 检查是否匹配
      const isMatch = cardLayout[firstIndex] === cardLayout[index];
      
      const move: MemoryMove = {
        card1: firstIndex,
        card2: index,
        matched: isMatch,
        timestamp: Date.now(),
      };
      setMoves(prev => [...prev, move]);

      // P2: 保存 timeout ref 以便清理
      flipTimeoutRef.current = setTimeout(() => {
        if (isMatch) {
          setMatchedCards(prev => new Set([...prev, firstIndex, index]));
        }
        setFlippedCards([]);
        setIsChecking(false);
      }, isMatch ? 300 : 800);
    }
  }, [flippedCards, matchedCards, isChecking, cardLayout]);

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* 游戏信息栏 */}
      <div className="bg-white rounded-2xl p-4 mb-6 shadow-sm border border-slate-100">
        {isRestored && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm text-center">
            🔄 自动恢复了未完成的游戏
          </div>
        )}
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{difficultyMeta.icon}</span>
            <span className="font-semibold text-slate-700">{difficultyMeta.name}</span>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">步数</div>
              <div className="text-xl font-bold text-slate-900 tabular-nums">{moveCount}</div>
            </div>
            
            <div className="text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">预估</div>
              <div className="text-xl font-bold text-green-600 tabular-nums">{estimatedScore()}</div>
            </div>
            
            <div className="text-center">
              <div className="text-xs text-slate-400 uppercase tracking-wider">时间</div>
              <div className={`text-xl font-bold tabular-nums ${timeLeft <= 30 ? 'text-red-500' : 'text-slate-900'}`}>
                {formatTime(timeLeft)}
              </div>
            </div>
          </div>
        </div>
        
        {/* 进度条 */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>配对进度</span>
            <span>{matchedCards.size / 2} / {config.pairs}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-300"
              style={{ width: `${(matchedCards.size / 2 / config.pairs) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* 卡片网格 */}
      <div 
        className="grid gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${config.cols}, minmax(0, 1fr))`,
        }}
      >
        {cardLayout.map((iconId, index) => (
          <Card
            key={index}
            index={index}
            iconId={iconId}
            isFlipped={flippedCards.includes(index)}
            isMatched={matchedCards.has(index)}
            onClick={handleCardClick}
            disabled={isChecking || hasEnded}
          />
        ))}
      </div>
    </div>
  );
}
