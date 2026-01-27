// src/app/games/memory/page.tsx

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGameSession } from './hooks/useGameSession';
import { DifficultySelect } from './components/DifficultySelect';
import { GameBoard } from './components/GameBoard';
import { ResultModal } from './components/ResultModal';
import type { MemoryDifficulty, MemoryMove } from '@/lib/types/game';

type GamePhase = 'loading' | 'select' | 'playing' | 'result';

interface GameResult {
  moves: number;
  completed: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
}

export default function MemoryGamePage() {
  const router = useRouter();
  const {
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
  } = useGameSession();

  const [phase, setPhase] = useState<GamePhase>('loading');
  const [selectedDifficulty, setSelectedDifficulty] = useState<MemoryDifficulty | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false); // 积分上限警告

  // 初始化
  useEffect(() => {
    fetchStatus().then(() => setPhase('select'));
  }, [fetchStatus]);

  // 同步 session 状态
  useEffect(() => {
    if (session && phase === 'select') {
      Promise.resolve().then(() => {
        setSelectedDifficulty(session.difficulty);
        setPhase('playing');
      });
    }
  }, [session, phase]);

  // 选择难度并开始游戏
  const handleSelectDifficulty = useCallback(async (difficulty: MemoryDifficulty) => {
    // 如果已达积分上限，显示警告弹窗
    if (status?.pointsLimitReached) {
      setSelectedDifficulty(difficulty);
      setShowLimitWarning(true);
      return;
    }
    
    setSelectedDifficulty(difficulty);
    setError(null);
    
    const success = await startGame(difficulty);
    if (success) {
      setPhase('playing');
    }
  }, [startGame, setError, status?.pointsLimitReached]);

  // 确认继续游戏（即使无积分）
  const handleConfirmPlay = useCallback(async () => {
    setShowLimitWarning(false);
    if (!selectedDifficulty) return;
    
    setError(null);
    const success = await startGame(selectedDifficulty);
    if (success) {
      setPhase('playing');
    }
  }, [startGame, setError, selectedDifficulty]);

  // 游戏结束
  const handleGameEnd = useCallback(async (moves: MemoryMove[], completed: boolean, duration: number) => {
    const result = await submitResult(moves, completed, duration);
    
    if (result) {
      setGameResult({
        moves: result.record.moves,
        completed: result.record.completed,
        score: result.record.score,
        pointsEarned: result.pointsEarned,
        duration: result.record.duration,
      });
      setPhase('result');
    }
  }, [submitResult]);

  // 再来一局
  const handlePlayAgain = useCallback(async () => {
    if (!selectedDifficulty) return;
    
    setGameResult(null);
    setPhase('select');
    resetSubmitFlag();
    await fetchStatus();
  }, [selectedDifficulty, resetSubmitFlag, fetchStatus]);

  // 返回游戏中心
  const handleBackToGames = useCallback(() => {
    router.push('/games');
  }, [router]);

  // 取消游戏
  const handleCancelGame = useCallback(async () => {
    await cancelGame();
    setPhase('select');
  }, [cancelGame]);

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            游戏中心
          </button>
          
          <div className="flex items-center gap-4">
            {/* 积分显示 */}
            <Link 
              href="/store"
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-200 text-slate-700 hover:border-yellow-400 hover:text-yellow-600 transition-all group"
            >
              <span className="text-yellow-500">⭐</span>
              <span className="font-bold">{status?.balance ?? '...'}</span>
              <span className="text-slate-300 group-hover:text-yellow-400 transition-colors">→</span>
            </Link>
          </div>
        </div>

        {/* 页面标题 */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">🃏 记忆卡片</h1>
          <p className="text-slate-500">翻开卡片，找到所有配对！</p>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
            {error}
          </div>
        )}

        {/* 游戏状态信息 */}
        {status?.dailyStats && phase === 'select' && (
          <div className="mb-8 bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日游戏</div>
                <div className="text-xl font-bold text-slate-900">
                  {status.dailyStats.gamesPlayed} <span className="text-sm font-normal text-slate-500">局</span>
                </div>
              </div>
              <div className="w-px h-10 bg-slate-200" />
              <div className="text-center">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-1">今日积分</div>
                <div className={`text-xl font-bold ${status.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
                  {status.dailyStats.pointsEarned} <span className="text-slate-300">/</span> <span className="text-sm font-normal text-slate-500">{status.dailyLimit ?? 2000}</span>
                  {status.pointsLimitReached && (
                    <span className="block text-xs text-orange-500 font-medium mt-1">已达上限</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 冷却提示 */}
        {status?.inCooldown && phase === 'select' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-center">
            ⏳ 冷却中，请等待 {status.cooldownRemaining} 秒后再开始游戏
          </div>
        )}

        {/* 主内容区域 */}
        {phase === 'loading' && (
          <div className="text-center py-20">
            <div className="inline-block animate-spin text-4xl mb-4">🎴</div>
            <p className="text-slate-500">加载中...</p>
          </div>
        )}

        {phase === 'select' && (
          <DifficultySelect
            onSelect={handleSelectDifficulty}
            disabled={loading || status?.inCooldown}
          />
        )}

        {phase === 'playing' && session && (
          <div>
            {/* 取消游戏按钮 */}
            <div className="mb-4 text-center">
              <button
                onClick={handleCancelGame}
                disabled={loading}
                className="text-sm text-slate-400 hover:text-red-500 transition-colors"
              >
                放弃该游戏
              </button>
            </div>
            
            <GameBoard
              difficulty={session.difficulty}
              cardLayout={session.cardLayout}
              config={session.config}
              onGameEnd={handleGameEnd}
              isRestored={isRestored}
            />
          </div>
        )}

        {/* 结算弹窗 */}
        {phase === 'result' && gameResult && selectedDifficulty && (
          <ResultModal
            isOpen={true}
            difficulty={selectedDifficulty}
            moves={gameResult.moves}
            completed={gameResult.completed}
            score={gameResult.score}
            pointsEarned={gameResult.pointsEarned}
            duration={gameResult.duration}
            onPlayAgain={handlePlayAgain}
            onBackToGames={handleBackToGames}
          />
        )}

        {/* 积分上限警告弹窗 */}
        {showLimitWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95">
              <div className="text-center">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">⚠️</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">今日积分已达上限</h3>
                <p className="text-slate-500 mb-6">
                  你今日已获得 <span className="font-bold text-orange-500">{status?.dailyStats?.pointsEarned ?? 0}</span> 积分，
                  达到每日上限 <span className="font-bold">{status?.dailyLimit ?? 2000}</span> 积分。
                  <br />
                  <span className="text-orange-600 font-medium">继续游戏将不会获得积分。</span>
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowLimitWarning(false)}
                    className="flex-1 py-3 px-4 border-2 border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-slate-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmPlay}
                    className="flex-1 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition-colors"
                  >
                    继续游戏
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
