'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { GameBoard } from './components/GameBoard';
import { LaunchControl } from './components/LaunchControl';
import { ResultModal } from './components/ResultModal';
import { useGameSession } from './hooks/useGameSession';
import { useGameEngine } from './hooks/useGameEngine';

export default function PachinkoPage() {
  const router = useRouter();
  const { session, status, loading, error, isRestored, fetchStatus, startGame, cancelGame, submitResult } = useGameSession();
  const { canvasRef, ballsRemaining, currentScore, ballResults, isLaunching, isGameOver, launchBall, reset, getGameDuration } = useGameEngine(session?.seed ?? null);
  
  const [showResult, setShowResult] = useState(false);
  const [resultPoints, setResultPoints] = useState<number | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false); // 积分上限警告
  const submitTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasSubmittedRef = useRef(false); // 防止重复提交

  // 初始化获取状态
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 游戏结束时自动提交
  useEffect(() => {
    // 必须满足：游戏结束、有会话、未在提交中、未提交过
    if (isGameOver && session && !isSubmitting && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      setIsSubmitting(true);
      
      const submit = async () => {
        try {
          const result = await submitResult(currentScore, getGameDuration(), ballResults);
          if (result.success) {
            setResultPoints(result.pointsEarned);
          }
        } catch (err) {
          console.error('Submit error:', err);
        }
        setShowResult(true);
        setIsSubmitting(false);
      };
      
      // 延迟提交，让玩家看到最后一颗球落入
      submitTimeoutRef.current = setTimeout(submit, 1000);
    }
  }, [isGameOver, session, isSubmitting, currentScore, ballResults, getGameDuration, submitResult]);

  // 组件卸载时清理 timeout
  useEffect(() => {
    return () => {
      if (submitTimeoutRef.current) {
        clearTimeout(submitTimeoutRef.current);
        submitTimeoutRef.current = null;
      }
    };
  }, []);

  // 开始新游戏
  const handleStartGame = async () => {
    // 如果已达积分上限，显示警告弹窗
    if (status?.pointsLimitReached) {
      setShowLimitWarning(true);
      return;
    }
    
    reset();
    setShowResult(false);
    setResultPoints(undefined);
    hasSubmittedRef.current = false;
    await startGame();
  };

  // 确认继续游戏（即使无积分）
  const handleConfirmPlay = async () => {
    setShowLimitWarning(false);
    reset();
    setShowResult(false);
    setResultPoints(undefined);
    hasSubmittedRef.current = false;
    await startGame();
  };

  // 再来一局
  const handlePlayAgain = async () => {
    setShowResult(false);
    setResultPoints(undefined);
    hasSubmittedRef.current = false;
    reset();
    await startGame();
  };

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:py-8 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.push('/games')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            返回
          </button>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <span className="text-3xl">🎱</span> 弹珠机
          </h1>
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border border-slate-200">
             <span className="text-yellow-500">⭐</span>
             <span className="font-bold text-slate-900">{status?.balance || 0}</span>
          </div>
        </div>

        {/* 每日统计 */}
        {status?.dailyStats && (
          <div className="bg-white rounded-xl p-4 mb-6 shadow-sm border border-slate-100 flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
               <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">今日游戏</span>
               <span className="text-slate-900 font-bold">{status.dailyStats.gamesPlayed} <span className="text-slate-400 font-normal text-xs">局</span></span>
            </div>
            <div className="h-4 w-px bg-slate-200"></div>
            <div className="flex items-center gap-2">
               <span className="text-slate-400 text-xs font-bold uppercase tracking-wider">今日积分</span>
               <span className={`font-bold ${status.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
                 {status.dailyStats.pointsEarned}<span className="text-slate-300 mx-1">/</span>{status.dailyLimit ?? 2000}
               </span>
               {status.pointsLimitReached && (
                 <span className="text-xs text-orange-500 font-medium">已达上限</span>
               )}
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-red-600 text-sm text-center max-w-2xl mx-auto flex items-center justify-center gap-2">
            <span>⚠️</span>
            {error}
            {error === '你已有正在进行的游戏' && (
              <button
                onClick={cancelGame}
                disabled={loading}
                className="ml-2 font-bold underline hover:no-underline hover:text-red-800"
              >
                放弃该游戏
              </button>
            )}
          </div>
        )}

        {/* 有未完成游戏的提示 - 仅在恢复会话时显示 */}
        {isRestored && session && !isGameOver && ballsRemaining === 5 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-amber-700 text-sm text-center max-w-2xl mx-auto flex items-center justify-center gap-2">
             <span>🔄</span> 你有一个正在进行的游戏，已自动恢复
          </div>
        )}

        {/* 游戏区域 - 响应式布局 */}
        {session ? (
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center gap-8">
            {/* 游戏画布 */}
            <div className="flex justify-center p-4 bg-slate-900 rounded-3xl shadow-2xl shadow-slate-300 ring-8 ring-slate-100">
              <GameBoard
                canvasRef={canvasRef}
                ballsRemaining={ballsRemaining}
                currentScore={currentScore}
              />
            </div>
            
            {/* 控制区域 - 移动端在下方，桌面端在右侧 */}
            <div className="w-full lg:w-80 bg-white rounded-3xl p-6 shadow-xl border border-slate-100 flex flex-col gap-6">
              <div>
                <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-2">当前得分</h3>
                <div className="text-4xl font-extrabold text-slate-900">{currentScore}</div>
              </div>

              <div className="border-t border-slate-100 pt-6">
                 <h3 className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-4">操作台</h3>
                 <LaunchControl
                    onLaunch={launchBall}
                    disabled={isLaunching || ballsRemaining === 0}
                    ballsRemaining={ballsRemaining}
                 />
              </div>
              
              <div className="border-t border-slate-100 pt-6 mt-auto">
                 <p className="text-xs text-slate-400 text-center">
                    长按蓄力，松开发射
                 </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-3xl p-12 text-center max-w-xl mx-auto shadow-xl border border-slate-100 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-50 rounded-bl-full -z-0"></div>
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-blue-50 rounded-tr-full -z-0"></div>
            
            <div className="relative z-10">
                <div className="w-24 h-24 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center text-5xl mx-auto mb-6 shadow-lg shadow-indigo-200 text-white transform rotate-3">
                  🎱
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-3">准备开始游戏</h2>
                <p className="text-slate-500 mb-8 max-w-xs mx-auto leading-relaxed">
                  每局 <span className="font-bold text-slate-900">5</span> 颗弹珠，控制力度让弹珠落入高分区域，赢取海量积分！
                </p>
                <button
                  onClick={handleStartGame}
                  disabled={loading || (status?.inCooldown ?? false)}
                  className="w-full sm:w-auto px-10 py-4 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2"
                >
                  {loading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        加载中...
                      </>
                  ) : status?.inCooldown ? (
                      `冷却中 (${status.cooldownRemaining}s)`
                  ) : (
                      '开始游戏'
                  )}
                </button>
            </div>
          </div>
        )}

        {/* 结算弹窗 */}
        <ResultModal
          isOpen={showResult}
          score={currentScore}
          ballResults={ballResults}
          pointsEarned={resultPoints}
          onClose={() => {
            setShowResult(false);
            router.push('/games');
          }}
          onPlayAgain={handlePlayAgain}
        />

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
