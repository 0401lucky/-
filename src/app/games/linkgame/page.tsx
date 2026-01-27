'use client';

import { useEffect, useState, useRef } from 'react';
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
  findHint,
  shuffleBoard,
  checkGameComplete,
  calculateScore,
  positionOf,
  indexOf,
} from '@/lib/linkgame';
import type { LinkGameDifficulty, LinkGameMove } from '@/lib/types/game';

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
  const [selected, setSelected] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [shufflesUsed, setShufflesUsed] = useState(0);
  const [matchedPairs, setMatchedPairs] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [moves, setMoves] = useState<LinkGameMove[]>([]);
  const [shakingIndices, setShakingIndices] = useState<number[]>([]);
  const [matchingIndices, setMatchingIndices] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    fetchStatus().then(() => setPhase('select'));
  }, [fetchStatus]);

  useEffect(() => {
    if (session && phase !== 'result') {
      if (isRestored) {
        setBoard(session.tileLayout);
        setSelectedDifficulty(session.difficulty);
        setTimeRemaining((prev) => prev > 0 ? prev : session.config.timeLimit);
        setPhase('playing');
      }
    }
  }, [session, isRestored, phase]);

  useEffect(() => {
    if (phase === 'playing' && timeRemaining > 0) {
      timerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            handleGameOver(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleGameOver = async (completed: boolean) => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!session) return;

    const result = await submitResult(
      moves,
      hintsUsed,
      shufflesUsed,
      timeRemaining,
      completed
    );

    if (result) {
      setGameResult({
        moves: result.record.moves,
        completed: result.record.completed,
        score: result.record.score,
        pointsEarned: result.pointsEarned,
        duration: result.record.duration,
        matchedPairs: matchedPairs + (completed ? 0 : 0),
      });
      setPhase('result');
    }
  };

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
      setShufflesUsed(0);
      setMatchedPairs(0);
      setMoves([]);
      setSelected(null);
    }
  };

  useEffect(() => {
    if (session && phase === 'select' && !isRestored) {
       setBoard(session.tileLayout);
       setTimeRemaining(session.config.timeLimit);
       setPhase('playing');
       setSelectedDifficulty(session.difficulty);
    }
  }, [session, phase, isRestored]);


  const handleTileClick = (index: number) => {
    if (!session || isProcessing) return;
    
    const tile = board[index];
    if (tile === null) return;
    if (selected === index) {
      setSelected(null);
      return;
    }

    if (selected === null) {
      setSelected(index);
    } else {
      const pos1 = positionOf(selected, session.config.cols);
      const pos2 = positionOf(index, session.config.cols);

      const matched = canMatch(board, pos1, pos2, session.config.cols);

      const newMove: LinkGameMove = {
        pos1,
        pos2,
        matched,
        timestamp: Date.now(),
      };
      setMoves((prev) => [...prev, newMove]);

      if (matched) {
        // Show match animation first
        setIsProcessing(true);
        setMatchingIndices([selected, index]);
        
        // Calculate score updates immediately for UI response
        const newMatchedPairs = matchedPairs + 1;
        const newCombo = combo + 1;
        
        // Wait for animation
        setTimeout(() => {
          const newBoard = removeMatch(board, pos1, pos2, session.config.cols);
          setBoard(newBoard);
          setSelected(null);
          setMatchingIndices([]);
          setIsProcessing(false);

          setMatchedPairs(newMatchedPairs);
          setCombo(newCombo);

          const currentScore = calculateScore({
            matchedPairs: newMatchedPairs,
            baseScore: session.config.baseScore,
            combo: newCombo,
            timeRemainingSeconds: timeRemaining,
            hintsUsed,
            shufflesUsed,
            hintPenalty: session.config.hintPenalty,
            shufflePenalty: session.config.shufflePenalty
          });
          setScore(currentScore);

          if (checkGameComplete(newBoard)) {
            handleGameOver(true);
          }
        }, 400); // 400ms match animation
      } else {
        // Mismatch - shake animation
        setIsProcessing(true);
        setShakingIndices([selected, index]);
        
        setTimeout(() => {
          setSelected(null);
          setCombo(0);
          setShakingIndices([]);
          setIsProcessing(false);
        }, 400); // 400ms shake animation
      }
    }
  };

  const handleHint = () => {
    if (!session) return;
    const limit = session.config.hintLimit;
    if (hintsUsed >= limit) return;

    const hint = findHint(board, session.config.rows, session.config.cols);
    if (hint) {
      const index1 = indexOf(hint.pos1, session.config.cols);
      setSelected(index1);
      
      const newHintsUsed = hintsUsed + 1;
      setHintsUsed(newHintsUsed);
      
      const currentScore = calculateScore({
        matchedPairs,
        baseScore: session.config.baseScore,
        combo,
        timeRemainingSeconds: timeRemaining,
        hintsUsed: newHintsUsed,
        shufflesUsed,
        hintPenalty: session.config.hintPenalty,
        shufflePenalty: session.config.shufflePenalty
      });
      setScore(currentScore);
    }
  };

  const handleShuffle = () => {
    if (!session) return;
    const limit = session.config.shuffleLimit;
    if (shufflesUsed >= limit) return;

    const newBoard = shuffleBoard(board);
    setBoard(newBoard);
    setSelected(null);

    const newShufflesUsed = shufflesUsed + 1;
    setShufflesUsed(newShufflesUsed);

    const currentScore = calculateScore({
      matchedPairs,
      baseScore: session.config.baseScore,
      combo,
      timeRemainingSeconds: timeRemaining,
      hintsUsed,
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
    <div className="min-h-screen bg-slate-50 py-8 px-4 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleBackToGames}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            游戏中心
          </button>
          
          <div className="flex items-center gap-4">
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

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">🔗 连连看</h1>
          <p className="text-slate-500">连接相同的两个图案，清空棋盘！</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-center">
            {error}
          </div>
        )}

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

        {status?.inCooldown && phase === 'select' && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-center">
            ⏳ 冷却中，请等待 {status.cooldownRemaining} 秒后再开始游戏
          </div>
        )}

        {phase === 'loading' && (
          <div className="text-center py-20">
            <div className="inline-block animate-spin text-4xl mb-4">🌀</div>
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
          <div className="animate-in fade-in duration-500">
            <GameHeader
              timeRemaining={timeRemaining}
              score={score}
              combo={combo}
              hintsRemaining={session.config.hintLimit - hintsUsed}
              shufflesRemaining={session.config.shuffleLimit - shufflesUsed}
              onHint={handleHint}
              onShuffle={handleShuffle}
            />

            <div className="mb-4 text-center">
               <button
                 onClick={() => cancelGame().then(() => setPhase('select'))}
                 disabled={loading}
                 className="text-sm text-slate-400 hover:text-red-500 transition-colors"
               >
                 放弃该游戏
               </button>
            </div>
            
            <GameBoard
              difficulty={session.difficulty}
              tileLayout={board}
              config={session.config}
              selected={selected}
              onSelect={handleTileClick}
              shakingIndices={shakingIndices}
              matchingIndices={matchingIndices}
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
