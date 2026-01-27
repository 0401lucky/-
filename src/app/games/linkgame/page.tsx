'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useGameSession } from './hooks/useGameSession';
import { DifficultySelect } from './components/DifficultySelect';
import { GameBoard } from './components/GameBoard';
import { GameHeader } from './components/GameHeader';
import { ResultModal } from './components/ResultModal';
import {
  canMatch,
  removeMatch,
  canTripleMatch,
  removeTripleMatch,
  findHint,
  findMatchPath,
  shuffleBoard,
  checkGameComplete,
  calculateScore,
  positionOf,
  indexOf,
} from '@/lib/linkgame';
import type { LinkGameDifficulty, LinkGameMove, LinkGamePosition } from '@/lib/types/game';

type GamePhase = 'loading' | 'select' | 'playing' | 'result';

interface GameResult {
  moves: number;
  completed: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  matchedPairs: number;
}

export default function LinkGamePage() {
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
  } = useGameSession();

  const [phase, setPhase] = useState<GamePhase>('loading');
  const [selectedDifficulty, setSelectedDifficulty] = useState<LinkGameDifficulty | null>(null);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);
  const [showLimitWarning, setShowLimitWarning] = useState(false);

  const [board, setBoard] = useState<(string | null)[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [shufflesUsed, setShufflesUsed] = useState(0);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [moves, setMoves] = useState<LinkGameMove[]>([]);
  const [shakingIndices, setShakingIndices] = useState<number[]>([]);
  const [matchingIndices, setMatchingIndices] = useState<number[]>([]);
  const [matchPaths, setMatchPaths] = useState<LinkGamePosition[][] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [tripleMode, setTripleMode] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const matchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionRef = useRef(session);
  const movesRef = useRef<LinkGameMove[]>([]);
  const hintsUsedRef = useRef(0);
  const shufflesUsedRef = useRef(0);
  const matchedPairsRef = useRef(0);
  const timeRemainingRef = useRef(0);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (matchTimerRef.current) {
        clearTimeout(matchTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    fetchStatus().then(() => setPhase('select'));
  }, [fetchStatus]);

  useEffect(() => {
    if (session && phase !== 'result') {
      if (isRestored) {
        setBoard(session.tileLayout);
        setSelectedDifficulty(session.difficulty);
        setTimeRemaining((prev) => {
          const next = prev > 0 ? prev : session.config.timeLimit;
          timeRemainingRef.current = next;
          return next;
        });
        setPhase('playing');
      }
    }
  }, [session, isRestored, phase]);

  const handleGameOver = useCallback(async (completed: boolean) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (matchTimerRef.current) {
      clearTimeout(matchTimerRef.current);
      matchTimerRef.current = null;
    }

    if (!sessionRef.current) return;

    const result = await submitResult(
      movesRef.current,
      hintsUsedRef.current,
      shufflesUsedRef.current,
      timeRemainingRef.current,
      completed
    );

    if (result) {
      setGameResult({
        moves: result.record.moves,
        completed: result.record.completed,
        score: result.record.score,
        pointsEarned: result.pointsEarned,
        duration: result.record.duration,
        matchedPairs: matchedPairsRef.current,
      });
      setPhase('result');
    }
  }, [submitResult]);

  useEffect(() => {
    if (phase !== 'playing') return;
    if (timerRef.current) return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          timeRemainingRef.current = 0;
          void handleGameOver(false);
          return 0;
        }

        const next = prev - 1;
        timeRemainingRef.current = next;
        return next;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [phase, handleGameOver]);

  const handleSelectDifficulty = async (difficulty: LinkGameDifficulty) => {
    if (status?.pointsLimitReached) {
      setSelectedDifficulty(difficulty);
      setShowLimitWarning(true);
      return;
    }
    await startNewGame(difficulty);
  };

  const handleConfirmPlay = async () => {
    setShowLimitWarning(false);
    if (selectedDifficulty) {
      await startNewGame(selectedDifficulty);
    }
  };

  const startNewGame = async (difficulty: LinkGameDifficulty) => {
    const success = await startGame(difficulty);
    if (success) {
      setScore(0);
      setCombo(0);
      setHintsUsed(0);
      hintsUsedRef.current = 0;
      setShufflesUsed(0);
      shufflesUsedRef.current = 0;
      setMatchedPairs(0);
      matchedPairsRef.current = 0;
      setMoves([]);
      movesRef.current = [];
      setSelected([]);
      setMatchPaths(null);
      setTripleMode(false);
    }
  };

  useEffect(() => {
    if (session && phase === 'select' && !isRestored) {
       setBoard(session.tileLayout);
       setTimeRemaining(session.config.timeLimit);
       timeRemainingRef.current = session.config.timeLimit;
       setPhase('playing');
       setSelectedDifficulty(session.difficulty);
    }
  }, [session, phase, isRestored]);


  const handleTileClick = (index: number) => {
    if (!session || isProcessing) return;

    const tile = board[index];
    if (tile === null) return;

    // Allow deselect by clicking selected tile again
    if (selected.includes(index)) {
      setSelected(selected.filter((i) => i !== index));
      return;
    }

    const cols = session.config.cols;

    // Triple mode: collect 3 same tiles, then attempt a triple match.
    if (tripleMode) {
      // Safety: triple match with current board setup is not suitable for easy (tile counts are 4 each).
      if (session.difficulty === 'easy') {
        setTripleMode(false);
        setSelected([index]);
        return;
      }

      if (selected.length === 0) {
        setSelected([index]);
        return;
      }

      const firstTile = board[selected[0]];
      if (firstTile !== tile) {
        setSelected([index]);
        return;
      }

      if (selected.length === 1) {
        setSelected([selected[0], index]);
        return;
      }

      if (selected.length === 2) {
        const idx1 = selected[0];
        const idx2 = selected[1];
        const idx3 = index;

        const pos1 = positionOf(idx1, cols);
        const pos2 = positionOf(idx2, cols);
        const pos3 = positionOf(idx3, cols);

        const matched = canTripleMatch(board, pos1, pos2, pos3, cols);
        const move: LinkGameMove = {
          type: 'match',
          pos1,
          pos2,
          pos3,
          matched,
          isTriple: true,
          timestamp: Date.now(),
        };
        setMoves((prev) => {
          const next = [...prev, move];
          movesRef.current = next;
          return next;
        });

        setIsProcessing(true);
        // Treat triple mode as a one-shot power-up: always turn it off after attempting.
        setTripleMode(false);

        if (matched) {
          setMatchingIndices([idx1, idx2, idx3]);
          const p12 = findMatchPath(board, pos1, pos2, cols);
          const p13 = findMatchPath(board, pos1, pos3, cols);
          const p23 = findMatchPath(board, pos2, pos3, cols);
          setMatchPaths([p12, p13, p23].filter(Boolean) as LinkGamePosition[][]);

          const newMatchedPairs = matchedPairsRef.current + 2;
          const newCombo = combo + 1;

          matchTimerRef.current = setTimeout(() => {
            matchTimerRef.current = null;
            const newBoard = removeTripleMatch(board, pos1, pos2, pos3, cols);
            setBoard(newBoard);
            setSelected([]);
            setMatchingIndices([]);
            setMatchPaths(null);
            setIsProcessing(false);

            setMatchedPairs(newMatchedPairs);
            matchedPairsRef.current = newMatchedPairs;
            setCombo(newCombo);

            const currentScore = calculateScore({
              matchedPairs: newMatchedPairs,
              baseScore: session.config.baseScore,
              combo: Math.max(0, newCombo - 1),
              timeRemainingSeconds: timeRemainingRef.current,
              hintsUsed: hintsUsedRef.current,
              shufflesUsed: shufflesUsedRef.current,
              hintPenalty: session.config.hintPenalty,
              shufflePenalty: session.config.shufflePenalty,
            });
            setScore(currentScore);

            if (checkGameComplete(newBoard)) {
              void handleGameOver(true);
            }
          }, 500);
        } else {
          setMatchPaths(null);
          setShakingIndices([idx1, idx2, idx3]);
          matchTimerRef.current = setTimeout(() => {
            matchTimerRef.current = null;
            setSelected([]);
            setCombo(0);
            setShakingIndices([]);
            setIsProcessing(false);
          }, 400);
        }

        return;
      }

      // Should not happen, but keep selection sane.
      setSelected([index]);
      return;
    }

    // Normal mode: 2-click attempt match.
    if (selected.length === 0) {
      setSelected([index]);
      return;
    }

    const firstIndex = selected[0];
    const firstTile = board[firstIndex];
    if (firstTile !== tile) {
      setSelected([index]);
      return;
    }

    const pos1 = positionOf(firstIndex, cols);
    const pos2 = positionOf(index, cols);
    const matched = canMatch(board, pos1, pos2, cols);

    const move: LinkGameMove = {
      type: 'match',
      pos1,
      pos2,
      matched,
      timestamp: Date.now(),
    };
    setMoves((prev) => {
      const next = [...prev, move];
      movesRef.current = next;
      return next;
    });

    setIsProcessing(true);
    if (matched) {
      setMatchingIndices([firstIndex, index]);
      const path = findMatchPath(board, pos1, pos2, cols);
      setMatchPaths(path ? [path] : null);

      const newMatchedPairs = matchedPairsRef.current + 1;
      const newCombo = combo + 1;

      matchTimerRef.current = setTimeout(() => {
        matchTimerRef.current = null;
        const newBoard = removeMatch(board, pos1, pos2, cols);
        setBoard(newBoard);
        setSelected([]);
        setMatchingIndices([]);
        setMatchPaths(null);
        setIsProcessing(false);

        setMatchedPairs(newMatchedPairs);
        matchedPairsRef.current = newMatchedPairs;
        setCombo(newCombo);

        const currentScore = calculateScore({
          matchedPairs: newMatchedPairs,
          baseScore: session.config.baseScore,
          combo: Math.max(0, newCombo - 1),
          timeRemainingSeconds: timeRemainingRef.current,
          hintsUsed: hintsUsedRef.current,
          shufflesUsed: shufflesUsedRef.current,
          hintPenalty: session.config.hintPenalty,
          shufflePenalty: session.config.shufflePenalty,
        });
        setScore(currentScore);

        if (checkGameComplete(newBoard)) {
          void handleGameOver(true);
        }
      }, 500);
    } else {
      setMatchPaths(null);
      setShakingIndices([firstIndex, index]);
      matchTimerRef.current = setTimeout(() => {
        matchTimerRef.current = null;
        setSelected([]);
        setCombo(0);
        setShakingIndices([]);
        setIsProcessing(false);
      }, 400);
    }
  };

  const handleHint = () => {
    if (!session || isProcessing) return;
    const limit = session.config.hintLimit;
    if (hintsUsed >= limit) return;

    const hint = findHint(board, session.config.rows, session.config.cols);
    if (hint) {
      const index1 = indexOf(hint.pos1, session.config.cols);
      setSelected([index1]);
      
      const newHintsUsed = hintsUsed + 1;
      hintsUsedRef.current = newHintsUsed;
      setHintsUsed(newHintsUsed);
      
      const currentScore = calculateScore({
        matchedPairs: matchedPairsRef.current,
        baseScore: session.config.baseScore,
        combo: Math.max(0, combo - 1),
        timeRemainingSeconds: timeRemainingRef.current,
        hintsUsed: newHintsUsed,
        shufflesUsed: shufflesUsedRef.current,
        hintPenalty: session.config.hintPenalty,
        shufflePenalty: session.config.shufflePenalty
      });
      setScore(currentScore);
    }
  };

  const handleShuffle = () => {
    if (!session || isProcessing) return;
    const limit = session.config.shuffleLimit;
    if (shufflesUsed >= limit) return;

    const newShufflesUsed = shufflesUsed + 1;
    
    // Record shuffle move before applying
    const shuffleMove: LinkGameMove = {
      type: 'shuffle',
      timestamp: Date.now(),
    };
    setMoves((prev) => {
      const next = [...prev, shuffleMove];
      movesRef.current = next;
      return next;
    });

    // Deterministic seed: sessionId + shuffle index
    const shuffleSeed = `${session.sessionId}-shuffle-${newShufflesUsed}`;
    const newBoard = shuffleBoard(board, shuffleSeed);
    setBoard(newBoard);
    setSelected([]);
    setMatchPaths(null);

    shufflesUsedRef.current = newShufflesUsed;
    setShufflesUsed(newShufflesUsed);

    const currentScore = calculateScore({
      matchedPairs: matchedPairsRef.current,
      baseScore: session.config.baseScore,
      combo: Math.max(0, combo - 1),
      timeRemainingSeconds: timeRemainingRef.current,
      hintsUsed: hintsUsedRef.current,
      shufflesUsed: newShufflesUsed,
      hintPenalty: session.config.hintPenalty,
      shufflePenalty: session.config.shufflePenalty
    });
    setScore(currentScore);
  };

  const handlePlayAgain = async () => {
    setGameResult(null);
    setPhase('select');
    resetSubmitFlag();
    await fetchStatus();
  };

  const handleBackToGames = () => {
    router.push('/games');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-100 via-purple-100 to-cyan-100 py-8 px-4 overflow-x-hidden">
      <div className="max-w-4xl mx-auto relative z-10">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleBackToGames}
            className="group flex items-center text-indigo-900/60 hover:text-indigo-900 transition-colors font-bold tracking-wide bg-white/40 px-4 py-2 rounded-full hover:bg-white/60 backdrop-blur-sm"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform bg-white/80 w-8 h-8 rounded-full flex items-center justify-center text-lg shadow-sm">🔙</span>
            游戏中心
          </button>
          
          <div className="flex items-center gap-4">
             <Link 
               href="/store"
               className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full shadow-sm border-2 border-white text-slate-700 hover:scale-105 hover:shadow-md transition-all group candy-shadow"
             >
               <span className="text-yellow-400 text-xl filter drop-shadow-sm">⭐</span>
               <span className="font-black text-slate-800 text-lg">{status?.balance ?? '...'}</span>
               <span className="text-indigo-300 group-hover:text-indigo-500 transition-colors">➜</span>
             </Link>
          </div>
        </div>

        <div className="text-center mb-10 relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-purple-300/30 blur-3xl rounded-full -z-10 animate-pulse" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-pink-300/30 blur-2xl rounded-full -z-10 animate-bounce" style={{ animationDuration: '3s' }} />
          
          <h1 className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 mb-4 drop-shadow-sm tracking-tight relative inline-block transform hover:scale-105 transition-transform duration-300 cursor-default">
            连连看
            <span className="absolute -top-2 -right-6 text-4xl animate-bounce" style={{ animationDelay: '0.5s' }}>✨</span>
            <span className="absolute -bottom-2 -left-6 text-4xl animate-bounce" style={{ animationDelay: '1s' }}>🍬</span>
          </h1>
          <br />
          <p className="text-indigo-900/70 font-bold bg-white/40 inline-block px-6 py-2 rounded-full backdrop-blur-sm border-2 border-white/50 shadow-sm mt-2">
            🍭 连接两个相同的图案，清空棋盘！
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100/80 border-2 border-red-200 rounded-2xl text-red-600 text-center font-bold shadow-sm">
            {error}
          </div>
        )}

        {status?.dailyStats && phase === 'select' && (
           <div className="mb-8 bg-white/60 backdrop-blur-md rounded-3xl p-6 shadow-lg border-2 border-white text-indigo-900">
             <div className="flex items-center justify-center gap-4 sm:gap-12">
               <div className="text-center group hover:scale-105 transition-transform">
                 <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2 font-bold bg-indigo-50 px-2 py-1 rounded-lg inline-block">今日游戏</div>
                 <div className="text-2xl font-black text-indigo-900">
                   {status.dailyStats.gamesPlayed} <span className="text-sm font-bold text-indigo-400">局</span>
                 </div>
               </div>
               <div className="w-1 h-12 bg-indigo-100 rounded-full" />
               <div className="text-center group hover:scale-105 transition-transform">
                 <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2 font-bold bg-indigo-50 px-2 py-1 rounded-lg inline-block">今日积分</div>
                 <div className={`text-2xl font-black ${status.pointsLimitReached ? 'text-pink-500' : 'text-green-500'}`}>
                   {status.dailyStats.pointsEarned} <span className="text-indigo-200">/</span> <span className="text-sm font-bold text-indigo-400">{status.dailyLimit ?? 2000}</span>
                   {status.pointsLimitReached && (
                     <span className="block text-xs text-pink-500 font-bold mt-1 bg-pink-100 px-2 py-0.5 rounded-full">已达上限</span>
                   )}
                 </div>
               </div>
             </div>
           </div>
        )}

        {status?.inCooldown && phase === 'select' && (
          <div className="mb-6 p-4 bg-amber-100/90 border-2 border-amber-200 rounded-2xl text-amber-700 text-center font-bold shadow-sm animate-pulse">
            ⏳ 休息一下！请等待 {status.cooldownRemaining} 秒后再开始 🍵
          </div>
        )}

        {phase === 'loading' && (
          <div className="text-center py-20">
            <div className="inline-block animate-spin text-5xl mb-6 filter drop-shadow-md">🍥</div>
            <p className="text-indigo-400 font-bold text-lg animate-pulse">准备糖果中...</p>
          </div>
        )}

        {phase === 'select' && (
          <DifficultySelect
            onSelect={handleSelectDifficulty}
            disabled={loading || status?.inCooldown}
          />
        )}

        {phase === 'playing' && session && (
          <div className="animate-fade-in">
            <GameHeader
              timeRemaining={timeRemaining}
              score={score}
              combo={combo}
              hintsRemaining={session.config.hintLimit - hintsUsed}
              shufflesRemaining={session.config.shuffleLimit - shufflesUsed}
              onHint={handleHint}
              onShuffle={handleShuffle}
              tripleMode={tripleMode}
              tripleModeDisabled={isProcessing || session.difficulty === 'easy'}
              tripleModeDisabledReason={
                session.difficulty === 'easy'
                  ? '简单模式不支持三连（会导致无法清盘）'
                  : '请等待当前操作完成'
              }
              onToggleTripleMode={() => {
                if (isProcessing) return;
                if (session.difficulty === 'easy') return;
                setTripleMode((prev) => !prev);
                setSelected([]);
                setMatchPaths(null);
              }}
            />

            <div className="mb-6 text-center">
                 <button
                 onClick={async () => {
                   if (matchTimerRef.current) {
                     clearTimeout(matchTimerRef.current);
                     matchTimerRef.current = null;
                   }
                   const cancelled = await cancelGame();
                   if (cancelled) setPhase('select');
                 }}
                 disabled={loading || isProcessing}
                 className={`text-sm font-bold transition-colors bg-white/30 px-4 py-1.5 rounded-full backdrop-blur-sm 
                   ${loading || isProcessing ? 'text-indigo-200 cursor-not-allowed' : 'text-indigo-300 hover:text-pink-500 hover:bg-white/50'}`}
               >
                 🏳️ 放弃本局
               </button>
            </div>
            
            <GameBoard
              tileLayout={board}
              config={session.config}
              selected={selected}
              onSelect={handleTileClick}
              shakingIndices={shakingIndices}
              matchingIndices={matchingIndices}
               matchPaths={matchPaths ?? undefined}
             />
          </div>
        )}

        {phase === 'result' && gameResult && selectedDifficulty && (
          <ResultModal
            isOpen={true}
            difficulty={selectedDifficulty}
            completed={gameResult.completed}
            score={gameResult.score}
            pointsEarned={gameResult.pointsEarned}
            matchedPairs={gameResult.matchedPairs}
            onPlayAgain={handlePlayAgain}
            onBackToGames={handleBackToGames}
          />
        )}

        {showLimitWarning && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-indigo-900/40 backdrop-blur-sm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="limit-warning-title">
             <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-scale-in border-4 border-white ring-4 ring-indigo-50">
               <div className="text-center">
                 <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                   <span className="text-4xl">⚠️</span>
                 </div>
                 <h3 id="limit-warning-title" className="text-2xl font-black text-slate-800 mb-2">今日积分已达上限</h3>
                 <p className="text-slate-500 mb-8 font-medium leading-relaxed">
                   你今日已获得 <span className="font-bold text-orange-500">{status?.dailyStats?.pointsEarned ?? 0}</span> 积分，
                   达到每日上限 <span className="font-bold">{status?.dailyLimit ?? 2000}</span> 积分。
                   <br />
                   <span className="text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-lg mt-2 inline-block">继续游戏将不会获得积分</span>
                 </p>
                 <div className="flex gap-4">
                   <button
                     onClick={() => setShowLimitWarning(false)}
                     className="flex-1 py-3.5 px-4 border-2 border-slate-200 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-colors"
                   >
                     稍后再来
                   </button>
                   <button
                     autoFocus
                     onClick={handleConfirmPlay}
                     className="flex-1 py-3.5 px-4 bg-gradient-to-r from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-bold rounded-2xl shadow-lg shadow-orange-500/30 transform hover:-translate-y-0.5 transition-all"
                   >
                     继续玩耍
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
