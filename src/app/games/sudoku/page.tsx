'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  Clock3,
  Eraser,
  Grid3X3,
  Lightbulb,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  Undo2,
  X,
} from 'lucide-react';
import { CancelConfirmModal } from '../_components/CancelConfirmModal';
import { fetchGameRequest, gameRequestErrorMessage } from '../_lib/request';
import {
  colOf,
  formatSudokuDuration,
  isSameUnit,
  rowOf,
} from '@/lib/sudoku-engine';
import type {
  SudokuAction,
  SudokuCellView,
  SudokuDifficulty,
  SudokuDifficultyConfig,
  SudokuSessionView,
} from '@/lib/types/game';

type Phase = 'select' | 'playing' | 'submitting' | 'result';

interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  message?: string;
}

interface SudokuRecord {
  id: string;
  difficulty: SudokuDifficulty;
  completed: boolean;
  won: boolean;
  score: number;
  pointsEarned: number;
  duration: number;
  moves: number;
  mistakes: number;
  createdAt: number;
}

interface SudokuStatus {
  balance: number;
  dailyStats: { gamesPlayed: number; pointsEarned: number };
  inCooldown: boolean;
  cooldownRemaining: number;
  dailyLimit: number;
  pointsLimitReached: boolean;
  records: SudokuRecord[];
  difficulties: SudokuDifficultyConfig[];
  activeSession: SudokuSessionView | null;
}

const FALLBACK_DIFFICULTIES: SudokuDifficultyConfig[] = [
  { id: 'easy', label: '简单', clues: 41, baseScore: 800, timeLimitSeconds: 900, mistakePenalty: 90 },
  { id: 'normal', label: '普通', clues: 34, baseScore: 1400, timeLimitSeconds: 1200, mistakePenalty: 120 },
  { id: 'hard', label: '困难', clues: 28, baseScore: 2200, timeLimitSeconds: 1800, mistakePenalty: 160 },
];

const DIFFICULTY_NOTE: Record<SudokuDifficulty, string> = {
  easy: '线索更充足，适合热身',
  normal: '布局均衡，适合日常挑战',
  hard: '留白更多，考验推理耐心',
};

const DIFFICULTY_TONE: Record<SudokuDifficulty, string> = {
  easy: 'sudoku-difficulty-easy',
  normal: 'sudoku-difficulty-normal',
  hard: 'sudoku-difficulty-hard',
};

function cloneCells(cells: SudokuCellView[]): SudokuCellView[] {
  return cells.map((cell) => ({ ...cell, notes: [...(cell.notes ?? [])] }));
}

function formatMinutes(seconds: number): string {
  return formatSudokuDuration(seconds);
}

function parseJson<T>(response: Response): Promise<ApiResponse<T> | null> {
  return response.json().catch(() => null) as Promise<ApiResponse<T> | null>;
}

function cellIsHighlighted(index: number, selectedIndex: number, cells: SudokuCellView[]): boolean {
  if (selectedIndex < 0) return false;
  if (isSameUnit(index, selectedIndex)) return true;
  const selectedValue = cells[selectedIndex]?.value ?? 0;
  return selectedValue > 0 && cells[index]?.value === selectedValue;
}

export default function SudokuPage() {
  const [phase, setPhase] = useState<Phase>('select');
  const [status, setStatus] = useState<SudokuStatus | null>(null);
  const [session, setSession] = useState<SudokuSessionView | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<SudokuDifficulty>('easy');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [noteMode, setNoteMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('选择难度，开始一局安静的九宫推理');
  const [showRules, setShowRules] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [cooldownEndsAt, setCooldownEndsAt] = useState(0);
  const [result, setResult] = useState<SudokuRecord | null>(null);
  const [historySize, setHistorySize] = useState(0);
  const historyRef = useRef<SudokuCellView[][]>([]);
  const actionBusyRef = useRef(false);
  const settleBusyRef = useRef(false);

  const difficulties = status?.difficulties?.length ? status.difficulties : FALLBACK_DIFFICULTIES;
  const currentConfig = difficulties.find((item) => item.id === session?.difficulty)
    ?? difficulties.find((item) => item.id === selectedDifficulty)
    ?? FALLBACK_DIFFICULTIES[0];
  const cells = useMemo(() => session?.state.cells ?? [], [session?.state.cells]);
  const selectedCell = selectedIndex >= 0 ? cells[selectedIndex] : undefined;
  const filledCount = cells.filter((cell) => cell.value > 0).length;
  const givenCount = cells.filter((cell) => cell.given).length;
  const playableCount = Math.max(0, cells.length - givenCount);
  const progress = playableCount > 0 ? Math.round(((filledCount - givenCount) / playableCount) * 100) : 0;
  const elapsedSeconds = session
    ? Math.max(0, Math.floor(((session.state.endedAt ?? clock) - session.startedAt) / 1000))
    : 0;
  const remainingSeconds = session
    ? Math.max(0, Math.ceil((session.expiresAt - clock) / 1000))
    : 0;
  const selectedValue = selectedCell?.value ?? 0;
  const cooldownRemaining = Math.max(0, Math.ceil((cooldownEndsAt - clock) / 1000));
  const inCooldown = cooldownRemaining > 0;

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetchGameRequest('/api/games/sudoku/status');
      const payload = await parseJson<SudokuStatus>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message ?? (response.status === 401 ? '请先登录后开始游戏' : '加载数独状态失败'));
      }
      setStatus(payload.data);
      const now = Date.now();
      setClock(now);
      setCooldownEndsAt(payload.data.inCooldown ? now + payload.data.cooldownRemaining * 1000 : 0);
      if (payload.data.activeSession) {
        setSession(payload.data.activeSession);
        setSelectedDifficulty(payload.data.activeSession.difficulty);
        setPhase(payload.data.activeSession.state.status === 'won' ? 'submitting' : 'playing');
        const firstEmpty = payload.data.activeSession.state.cells.find((cell) => !cell.given && cell.value === 0);
        setSelectedIndex(firstEmpty?.index ?? 0);
        setMessage(payload.data.activeSession.state.status === 'won' ? '本局已完成，正在结算奖励' : '继续完成这张九宫棋盘');
      }
      setError(null);
    } catch (caught) {
      setError(gameRequestErrorMessage(caught, '连接游戏服务超时，请稍后重试', '加载数独状态失败'));
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (phase !== 'playing' && phase !== 'submitting' && !inCooldown) return;
    const updateClock = () => setClock(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    window.addEventListener('focus', updateClock);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', updateClock);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, [phase, inCooldown]);

  const settleGame = useCallback(async (sessionId: string) => {
    if (settleBusyRef.current) return;
    settleBusyRef.current = true;
    setPhase('submitting');
    setLoading(true);
    try {
      const response = await fetchGameRequest('/api/games/sudoku/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await parseJson<{ record: SudokuRecord; pointsEarned: number }>(response);
      if (!response.ok || !payload?.success || !payload.data?.record) {
        throw new Error(payload?.message ?? '数独结算失败');
      }
      setResult(payload.data.record);
      setSession(null);
      setPhase('result');
      setMessage(`本局获得 ${payload.data.pointsEarned} 积分`);
      await fetchStatus();
    } catch (caught) {
      setError(gameRequestErrorMessage(caught, '结算请求超时，请稍后重试', '数独结算失败'));
      setPhase('playing');
    } finally {
      setLoading(false);
      settleBusyRef.current = false;
    }
  }, [fetchStatus]);

  useEffect(() => {
    if (phase === 'submitting' && session?.state.status === 'won' && !result) {
      void settleGame(session.sessionId);
    }
  }, [phase, result, session, settleGame]);

  const sendAction = useCallback(async (action: SudokuAction, recordHistory = true) => {
    if (!session || phase !== 'playing' || actionBusyRef.current) return false;
    actionBusyRef.current = true;
    setLoading(true);
    setError(null);
    const previous = cloneCells(session.state.cells);
    if (recordHistory) {
      historyRef.current = [...historyRef.current, previous].slice(-120);
      setHistorySize(historyRef.current.length);
    }
    try {
      const response = await fetchGameRequest('/api/games/sudoku/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.sessionId, action }),
      });
      const payload = await parseJson<{ session: SudokuSessionView }>(response);
      if (!response.ok || !payload?.success || !payload.data?.session) {
        throw new Error(payload?.message ?? '提交落子失败');
      }
      setSession(payload.data.session);
      setSelectedIndex(action.index);
      const updatedCell = payload.data.session.state.cells[action.index];
      if (action.type === 'set' && updatedCell?.error) {
        setMessage('这个数字不符合答案，已记入一次错误');
      } else if (action.type === 'note') {
        setMessage('笔记已更新');
      } else {
        setMessage('盘面已同步');
      }
      if (payload.data.session.state.status === 'won') {
        await settleGame(payload.data.session.sessionId);
      }
      return true;
    } catch (caught) {
      if (recordHistory) {
        historyRef.current = historyRef.current.slice(0, -1);
        setHistorySize(historyRef.current.length);
      }
      setError(gameRequestErrorMessage(caught, '落子请求超时，请稍后重试', '落子失败'));
      void fetchStatus();
      return false;
    } finally {
      setLoading(false);
      actionBusyRef.current = false;
    }
  }, [fetchStatus, phase, session, settleGame]);

  const startGame = useCallback(async (difficulty: SudokuDifficulty, restart = false) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetchGameRequest('/api/games/sudoku/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ difficulty, restart }),
      });
      const payload = await parseJson<SudokuSessionView>(response);
      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(payload?.message ?? '开始数独失败');
      }
      historyRef.current = [];
      setHistorySize(0);
      setSession(payload.data);
      setSelectedDifficulty(difficulty);
      const firstEmpty = payload.data.state.cells.find((cell) => !cell.given && cell.value === 0);
      setSelectedIndex(firstEmpty?.index ?? 0);
      setNoteMode(false);
      setMessage('棋盘已就绪，找出每个宫格里的唯一数字');
      setPhase('playing');
    } catch (caught) {
      setError(gameRequestErrorMessage(caught, '开始请求超时，请稍后重试', '开始数独失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCellAction = useCallback(async (value: number) => {
    if (!session || selectedIndex < 0 || selectedCell?.given) return;
    if (noteMode) {
      await sendAction({ type: 'note', index: selectedIndex, value });
      return;
    }
    await sendAction({ type: 'set', index: selectedIndex, value });
  }, [noteMode, selectedCell?.given, selectedIndex, sendAction, session]);

  const eraseSelected = useCallback(async () => {
    if (!session || selectedIndex < 0 || selectedCell?.given) return;
    await sendAction({ type: 'erase', index: selectedIndex });
  }, [selectedCell?.given, selectedIndex, sendAction, session]);

  const undo = useCallback(async () => {
    if (!session || phase !== 'playing' || actionBusyRef.current || historyRef.current.length === 0) return;
    const previous = historyRef.current[historyRef.current.length - 1];
    const current = session.state.cells;
    const index = current.findIndex((cell, cellIndex) => {
      const before = previous[cellIndex];
      return cell.value !== before.value || (cell.notes ?? []).join(',') !== (before.notes ?? []).join(',');
    });
    historyRef.current = historyRef.current.slice(0, -1);
    setHistorySize(historyRef.current.length);
    if (index < 0) return;
    const before = previous[index];
    const now = current[index];
    if (before.value !== now.value) {
      await sendAction(before.value > 0
        ? { type: 'set', index, value: before.value }
        : { type: 'erase', index }, false);
      return;
    }
    const beforeNotes = new Set(before.notes ?? []);
    const nowNotes = new Set(now.notes ?? []);
    const changedNotes = [...new Set([...beforeNotes, ...nowNotes])].filter((value) => beforeNotes.has(value) !== nowNotes.has(value));
    for (const value of changedNotes) {
      await sendAction({ type: 'note', index, value }, false);
    }
  }, [phase, sendAction, session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (phase !== 'playing' || loading) return;
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        void handleCellAction(Number(event.key));
      } else if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
        event.preventDefault();
        void eraseSelected();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setNoteMode((value) => !value);
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault();
        const current = selectedIndex >= 0 ? selectedIndex : 0;
        const row = rowOf(current);
        const col = colOf(current);
        const nextRow = event.key === 'ArrowUp' ? Math.max(0, row - 1) : event.key === 'ArrowDown' ? Math.min(8, row + 1) : row;
        const nextCol = event.key === 'ArrowLeft' ? Math.max(0, col - 1) : event.key === 'ArrowRight' ? Math.min(8, col + 1) : col;
        setSelectedIndex(nextRow * 9 + nextCol);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [eraseSelected, handleCellAction, loading, phase, selectedIndex]);

  const handleCancelGame = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const response = await fetchGameRequest('/api/games/sudoku/cancel', { method: 'POST' });
      const payload = await parseJson<unknown>(response);
      if (!response.ok || !payload?.success) throw new Error(payload?.message ?? '取消游戏失败');
      historyRef.current = [];
      setHistorySize(0);
      setSession(null);
      setPhase('select');
      setMessage('本局已放弃，可以重新选择难度');
      await fetchStatus();
    } catch (caught) {
      setError(gameRequestErrorMessage(caught, '取消请求超时，请稍后重试', '取消游戏失败'));
    } finally {
      setLoading(false);
      setShowCancelConfirm(false);
    }
  }, [fetchStatus, session]);

  const selectCell = useCallback((index: number) => {
    if (phase !== 'playing') return;
    setSelectedIndex(index);
    const cell = cells[index];
    if (cell?.value) setMessage(`正在查看数字 ${cell.value} 的关联位置`);
  }, [cells, phase]);

  const currentNumberCount = useMemo(() => {
    const counts = new Map<number, number>();
    for (const cell of cells) {
      if (cell.value > 0) counts.set(cell.value, (counts.get(cell.value) ?? 0) + 1);
    }
    return counts;
  }, [cells]);

  return (
    <div className="sudoku-page">
      <div className="sudoku-page-glow" aria-hidden />
      <header className="sudoku-topbar">
        <Link href="/games" className="sudoku-back" aria-label="返回游戏中心">
          <ArrowLeft size={16} />
          <span>游戏中心</span>
        </Link>
        <div className="sudoku-brand">
          <span className="sudoku-brand-icon"><Brain size={18} /></span>
          <span>数独</span>
          <span className="sudoku-brand-kicker">NINE CELLS / ONE LOGIC</span>
        </div>
        <div className="sudoku-top-actions">
          <button type="button" className="sudoku-icon-button" onClick={() => setShowRules(true)} aria-label="查看规则" title="查看规则">
            <BookOpen size={17} />
          </button>
          <Link href="/profile" className="sudoku-icon-button" aria-label="查看个人主页" title="查看个人主页">
            <Grid3X3 size={17} />
          </Link>
        </div>
      </header>

      <main className="sudoku-main">
        <section className="sudoku-hero">
          <div>
            <div className="sudoku-eyebrow"><Sparkles size={13} /> 逻辑挑战 · 服务端校验</div>
            <h1>把每一个空格，<span>放回它的位置。</span></h1>
            <p>{message}</p>
          </div>
          <div className="sudoku-hero-mark" aria-hidden>
            <div className="sudoku-hero-grid">{Array.from({ length: 9 }, (_, index) => <span key={index}>{index % 4 === 0 ? index + 1 : ''}</span>)}</div>
            <div className="sudoku-hero-stamp">9 × 9</div>
          </div>
        </section>

        {error && <div className="sudoku-error" role="alert">{error}</div>}

        {phase === 'select' && (
          <section className="sudoku-select-layout">
            <div className="sudoku-panel sudoku-select-panel">
              <div className="sudoku-panel-heading">
                <div>
                  <div className="sudoku-panel-kicker">CHOOSE YOUR PACE</div>
                  <h2>选择难度</h2>
                </div>
                <div className="sudoku-balance"><Trophy size={15} /> {status?.balance?.toLocaleString() ?? 0} 积分</div>
              </div>
              <div className="sudoku-difficulty-grid">
                {difficulties.map((difficulty) => (
                  <button
                    key={difficulty.id}
                    type="button"
                    className={`sudoku-difficulty-card ${DIFFICULTY_TONE[difficulty.id]} ${selectedDifficulty === difficulty.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedDifficulty(difficulty.id)}
                    disabled={loading || inCooldown}
                  >
                    <span className="sudoku-difficulty-number">{difficulty.clues}</span>
                    <span className="sudoku-difficulty-copy">
                      <strong>{difficulty.label}</strong>
                      <small>{DIFFICULTY_NOTE[difficulty.id]}</small>
                    </span>
                    <span className="sudoku-difficulty-time"><Clock3 size={13} /> {Math.round(difficulty.timeLimitSeconds / 60)} 分钟</span>
                  </button>
                ))}
              </div>
              {inCooldown && <div className="sudoku-cooldown"><Clock3 size={15} /> 冷却中，还需等待 {cooldownRemaining} 秒</div>}
              <button
                type="button"
                className="sudoku-primary-button"
                onClick={() => void startGame(selectedDifficulty)}
                disabled={loading || inCooldown}
              >
                {loading ? <Loader2 size={17} className="spin" /> : <Play size={17} fill="currentColor" />}
                {loading ? '准备棋盘' : '开始数独'}
              </button>
            </div>
            <aside className="sudoku-panel sudoku-intro-panel">
              <div className="sudoku-rule-symbol"><Lightbulb size={19} /></div>
              <div className="sudoku-panel-kicker">THE QUIET RULE</div>
              <h2>每一行、每一列、每一宫，都只出现一次 1 到 9。</h2>
              <div className="sudoku-intro-line"><Check size={15} /> 题目保证唯一解</div>
              <div className="sudoku-intro-line"><Check size={15} /> 错误会影响本局得分</div>
              <div className="sudoku-intro-line"><Check size={15} /> 进度会自动保存在当前会话</div>
            </aside>
          </section>
        )}

        {(phase === 'playing' || phase === 'submitting') && session && (
          <section className="sudoku-play-layout">
            <div className="sudoku-board-panel">
              <div className="sudoku-board-toolbar">
                <div className="sudoku-board-label"><span className="sudoku-live-dot" /> {currentConfig.label} · {givenCount} 个线索</div>
                <div className="sudoku-toolbar-actions">
                  <button type="button" className="sudoku-compact-button" onClick={() => setShowRules(true)} title="规则"><BookOpen size={15} />规则</button>
                  <button type="button" className="sudoku-compact-button danger" onClick={() => setShowCancelConfirm(true)} disabled={loading} title="放弃"><X size={15} />放弃</button>
                </div>
              </div>
              <div className="sudoku-board-wrap">
                <div className="sudoku-board" role="grid" aria-label="数独棋盘">
                  {cells.map((cell) => {
                    const row = rowOf(cell.index);
                    const col = colOf(cell.index);
                    const selected = cell.index === selectedIndex;
                    const highlighted = cellIsHighlighted(cell.index, selectedIndex, cells);
                    const sameValue = selectedValue > 0 && cell.value === selectedValue;
                    return (
                      <button
                        type="button"
                        role="gridcell"
                        key={cell.index}
                        aria-label={`第 ${row + 1} 行第 ${col + 1} 列${cell.value ? `，数字 ${cell.value}` : '，空白'}`}
                        aria-selected={selected}
                        className={`sudoku-cell ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''} ${sameValue ? 'is-same-value' : ''} ${cell.given ? 'is-given' : ''} ${(cell.error || cell.conflict) ? 'is-error' : ''}`}
                        style={{
                          borderRightWidth: col === 2 || col === 5 ? 2 : 1,
                          borderBottomWidth: row === 2 || row === 5 ? 2 : 1,
                        }}
                        onClick={() => selectCell(cell.index)}
                      >
                        {cell.value > 0 ? <span className="sudoku-cell-value">{cell.value}</span> : (
                          <span className="sudoku-notes">{Array.from({ length: 9 }, (_, noteIndex) => <i key={noteIndex} className={(cell.notes ?? []).includes(noteIndex + 1) ? 'has-note' : ''}>{noteIndex + 1}</i>)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="sudoku-board-footer">
                <span><span className="sudoku-legend-dot given" />题目数字</span>
                <span><span className="sudoku-legend-dot error" />需检查</span>
                <span><span className="sudoku-legend-dot selected" />关联区域</span>
              </div>
            </div>

            <aside className="sudoku-side-column">
              <div className="sudoku-panel sudoku-stats-panel">
                <div className="sudoku-stats-top"><span>本局进度</span><strong>{progress}%</strong></div>
                <div className="sudoku-progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="sudoku-stat-grid">
                  <div><Clock3 size={16} /><small>剩余时间</small><strong className={remainingSeconds < 60 ? 'is-warn' : ''}>{formatMinutes(remainingSeconds)}</strong></div>
                  <div><Lightbulb size={16} /><small>错误次数</small><strong>{session.state.mistakes}</strong></div>
                  <div><RotateCcw size={16} /><small>操作次数</small><strong>{session.state.moves}</strong></div>
                  <div><Trophy size={16} /><small>预计积分</small><strong>{session.pointRewardPreview ?? '—'}</strong></div>
                </div>
                <div className="sudoku-time-caption">已用时 {formatMinutes(elapsedSeconds)}</div>
              </div>

              <div className="sudoku-panel sudoku-input-panel">
                <div className="sudoku-input-heading"><span>输入数字</span><button type="button" className={`sudoku-note-toggle ${noteMode ? 'is-active' : ''}`} onClick={() => setNoteMode((value) => !value)}><Lightbulb size={14} />笔记</button></div>
                <div className="sudoku-number-pad">
                  {Array.from({ length: 9 }, (_, index) => {
                    const value = index + 1;
                    return <button type="button" key={value} className={`sudoku-number-button ${currentNumberCount.get(value) === 9 ? 'is-complete' : ''}`} onClick={() => void handleCellAction(value)} disabled={loading || !selectedCell || selectedCell.given}>{value}</button>;
                  })}
                  <button type="button" className="sudoku-number-button sudoku-erase-button" onClick={() => void eraseSelected()} disabled={loading || !selectedCell || selectedCell.given}><Eraser size={16} />擦除</button>
                  <button type="button" className="sudoku-number-button sudoku-undo-button" onClick={() => void undo()} disabled={loading || historySize === 0}><Undo2 size={16} />撤销</button>
                </div>
              </div>

              <div className="sudoku-panel sudoku-tip-panel">
                <div className="sudoku-tip-icon"><Sparkles size={17} /></div>
                <div><strong>{selectedCell?.given ? '题目数字' : selectedValue ? `当前数字 ${selectedValue}` : '选择一个空格'}</strong><p>{selectedCell?.given ? '深色数字不可修改。' : noteMode ? '点击数字可以添加或移除候选笔记。' : '先看同行、同列和同宫的缺口。'}</p></div>
              </div>
            </aside>
          </section>
        )}

        {phase === 'result' && result && (
          <section className="sudoku-result-preview">
            <div className="sudoku-result-icon"><Trophy size={29} /></div>
            <div><div className="sudoku-panel-kicker">ROUND COMPLETE</div><h2>这一局完成得很好。</h2><p>得分 {result.score.toLocaleString()}，获得 {result.pointsEarned.toLocaleString()} 积分。</p></div>
            <button type="button" className="sudoku-primary-button compact" onClick={() => { setResult(null); setPhase('select'); setMessage('选择下一张棋盘'); }}><RotateCcw size={16} />再来一局</button>
          </section>
        )}

        <section className="sudoku-bottom-note"><span><Pause size={14} /> 可随时离开，当前会话会保留</span><span>已完成 {status?.dailyStats?.gamesPlayed ?? 0} 局 · 今日获得 {status?.dailyStats?.pointsEarned ?? 0} 积分</span></section>
      </main>

      {showRules && (
        <div className="sudoku-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sudoku-rules-title">
          <div className="sudoku-modal">
            <button type="button" className="sudoku-modal-close" onClick={() => setShowRules(false)} aria-label="关闭规则"><X size={18} /></button>
            <div className="sudoku-modal-icon"><BookOpen size={21} /></div>
            <div className="sudoku-panel-kicker">HOW IT WORKS</div>
            <h2 id="sudoku-rules-title">数独规则</h2>
            <p>填满 9 × 9 棋盘，让每一行、每一列和每一个 3 × 3 宫都恰好包含数字 1 到 9。</p>
            <div className="sudoku-rule-list"><div><span>01</span><strong>先看缺口</strong><small>选中数字后，同行、同列和同宫会自动标亮。</small></div><div><span>02</span><strong>记录候选</strong><small>打开笔记模式，把暂时可能的数字写进空格。</small></div><div><span>03</span><strong>完成结算</strong><small>用时越短、错误越少，最终得分越高。</small></div></div>
            <button type="button" className="sudoku-primary-button" onClick={() => setShowRules(false)}>知道了</button>
          </div>
        </div>
      )}

      <CancelConfirmModal
        open={showCancelConfirm}
        loading={loading}
        title="确认放弃这张棋盘？"
        description="当前进度会被取消，本局不会进入积分结算。"
        detail="放弃后仍会进入短暂冷却，请确认你的选择。"
        onConfirm={() => void handleCancelGame()}
        onClose={() => setShowCancelConfirm(false)}
      />

      <style jsx global>{`
        .sudoku-page {
          --sudoku-ink: #14251f;
          --sudoku-muted: #71837b;
          --sudoku-line: #cfddd6;
          --sudoku-paper: #fffefa;
          --sudoku-mint: #0f766e;
          --sudoku-mint-dark: #115e59;
          --sudoku-coral: #e76f51;
          min-height: 100vh;
          background: #eef5f1;
          color: var(--sudoku-ink);
          position: relative;
          overflow: hidden;
          font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
        }
        .sudoku-page-glow { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 12% 8%, rgba(134, 239, 172, .28), transparent 28%), radial-gradient(circle at 88% 18%, rgba(251, 146, 60, .12), transparent 25%); }
        .sudoku-topbar { position: relative; z-index: 2; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; padding: 20px clamp(18px, 5vw, 72px); border-bottom: 1px solid rgba(207, 221, 214, .75); background: rgba(247, 252, 249, .8); backdrop-filter: blur(18px); }
        .sudoku-back, .sudoku-brand, .sudoku-top-actions { display: inline-flex; align-items: center; }
        .sudoku-back { gap: 8px; width: fit-content; color: #466057; font-size: 13px; font-weight: 800; text-decoration: none; }
        .sudoku-back:hover { color: var(--sudoku-mint); }
        .sudoku-brand { justify-self: center; gap: 9px; font-size: 18px; font-weight: 900; letter-spacing: .02em; }
        .sudoku-brand-icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 10px; background: var(--sudoku-ink); color: #d1fae5; box-shadow: 0 8px 18px rgba(20, 37, 31, .18); }
        .sudoku-brand-kicker { margin-left: 5px; color: #9aa9a2; font-size: 9px; font-weight: 800; letter-spacing: .13em; }
        .sudoku-top-actions { justify-self: end; gap: 9px; }
        .sudoku-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 1px solid var(--sudoku-line); border-radius: 50%; background: rgba(255, 255, 255, .72); color: #60766d; cursor: pointer; text-decoration: none; transition: .2s ease; }
        .sudoku-icon-button:hover { border-color: #8cc9b6; color: var(--sudoku-mint); background: white; transform: translateY(-1px); }
        .sudoku-main { position: relative; z-index: 1; width: min(1160px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 58px; }
        .sudoku-hero { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 188px; padding: 30px 38px; border: 1px solid rgba(255,255,255,.85); border-radius: 26px; background: linear-gradient(114deg, #193c32 0%, #23594b 68%, #317561 100%); color: #f4fff8; box-shadow: 0 22px 50px rgba(29, 71, 58, .18); overflow: hidden; }
        .sudoku-eyebrow, .sudoku-panel-kicker { display: flex; align-items: center; gap: 7px; color: #9be5c1; font-size: 10px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
        .sudoku-hero h1 { margin: 14px 0 8px; font-size: clamp(29px, 4vw, 48px); line-height: 1.08; letter-spacing: -.04em; }
        .sudoku-hero h1 span { color: #f8bc8d; }
        .sudoku-hero p { margin: 0; color: rgba(238, 255, 246, .72); font-size: 14px; font-weight: 700; }
        .sudoku-hero-mark { position: relative; flex: 0 0 auto; width: 148px; height: 148px; transform: rotate(7deg); }
        .sudoku-hero-grid { display: grid; grid-template-columns: repeat(3, 1fr); width: 122px; height: 122px; padding: 8px; gap: 2px; border: 2px solid rgba(255,255,255,.65); border-radius: 15px; background: rgba(255,255,255,.12); box-shadow: 0 16px 30px rgba(8, 32, 24, .18); }
        .sudoku-hero-grid span { display: flex; align-items: center; justify-content: center; border-radius: 4px; background: rgba(255,255,255,.15); color: #c7f9d9; font-size: 14px; font-weight: 900; }
        .sudoku-hero-stamp { position: absolute; right: -3px; bottom: 4px; padding: 6px 9px; border: 1px solid rgba(255,255,255,.55); border-radius: 8px; background: #f8bc8d; color: #263b31; font-size: 11px; font-weight: 950; letter-spacing: .1em; }
        .sudoku-error { margin-top: 16px; padding: 12px 16px; border: 1px solid #fecaca; border-radius: 14px; background: #fff1f2; color: #be123c; font-size: 13px; font-weight: 800; }
        .sudoku-select-layout, .sudoku-play-layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(280px, .85fr); gap: 18px; margin-top: 20px; }
        .sudoku-panel, .sudoku-board-panel { border: 1px solid rgba(255,255,255,.92); border-radius: 22px; background: rgba(255, 255, 252, .88); box-shadow: 0 15px 38px rgba(28, 61, 49, .07); }
        .sudoku-select-panel { padding: 27px; }
        .sudoku-panel-heading, .sudoku-stats-top, .sudoku-input-heading, .sudoku-board-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
        .sudoku-panel-heading h2 { margin: 7px 0 0; font-size: 23px; letter-spacing: -.03em; }
        .sudoku-balance { display: inline-flex; align-items: center; gap: 6px; padding: 8px 11px; border-radius: 999px; background: #fff5e8; color: #ad5d2e; font-size: 11px; font-weight: 900; }
        .sudoku-difficulty-grid { display: grid; gap: 10px; margin-top: 24px; }
        .sudoku-difficulty-card { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 13px; min-height: 72px; padding: 10px 13px; border: 1px solid #dce8e1; border-radius: 15px; background: #fbfdfb; color: var(--sudoku-ink); text-align: left; cursor: pointer; transition: .2s ease; }
        .sudoku-difficulty-card:hover:not(:disabled) { border-color: #91cdb7; transform: translateY(-1px); box-shadow: 0 9px 18px rgba(29, 81, 64, .08); }
        .sudoku-difficulty-card.is-selected { border-color: var(--sudoku-mint); background: #f0fbf5; box-shadow: 0 0 0 3px rgba(15, 118, 110, .1); }
        .sudoku-difficulty-card:disabled { cursor: not-allowed; opacity: .58; }
        .sudoku-difficulty-number { display: flex; align-items: center; justify-content: center; width: 45px; height: 45px; border-radius: 13px; color: white; font-size: 18px; font-weight: 950; }
        .sudoku-difficulty-easy .sudoku-difficulty-number { background: #2f967c; }
        .sudoku-difficulty-normal .sudoku-difficulty-number { background: #d68b53; }
        .sudoku-difficulty-hard .sudoku-difficulty-number { background: #bd5961; }
        .sudoku-difficulty-copy { display: grid; gap: 4px; }
        .sudoku-difficulty-copy strong { font-size: 14px; }
        .sudoku-difficulty-copy small { color: var(--sudoku-muted); font-size: 11px; font-weight: 700; }
        .sudoku-difficulty-time { display: inline-flex; align-items: center; gap: 5px; color: #7b8d84; font-size: 11px; font-weight: 800; white-space: nowrap; }
        .sudoku-cooldown { display: flex; align-items: center; gap: 7px; margin-top: 14px; padding: 11px 13px; border-radius: 12px; background: #fff7ed; color: #b45309; font-size: 12px; font-weight: 800; }
        .sudoku-primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 46px; margin-top: 18px; border: 0; border-radius: 13px; background: var(--sudoku-ink); color: #f2fff6; font-size: 13px; font-weight: 900; cursor: pointer; box-shadow: 0 9px 18px rgba(20, 37, 31, .17); transition: .2s ease; }
        .sudoku-primary-button:hover:not(:disabled) { background: var(--sudoku-mint-dark); transform: translateY(-1px); }
        .sudoku-primary-button:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
        .sudoku-primary-button.compact { width: auto; margin: 0; padding: 0 17px; white-space: nowrap; }
        .sudoku-intro-panel { padding: 27px; background: #fdfcf5; }
        .sudoku-rule-symbol, .sudoku-modal-icon { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; margin-bottom: 22px; border-radius: 13px; background: #fff1de; color: #c46d32; }
        .sudoku-intro-panel h2 { max-width: 270px; margin: 12px 0 26px; font-size: 22px; line-height: 1.3; letter-spacing: -.035em; }
        .sudoku-intro-line { display: flex; align-items: center; gap: 9px; margin-top: 12px; color: #60746b; font-size: 12px; font-weight: 800; }
        .sudoku-intro-line svg { color: #3e9e7f; }
        .sudoku-board-panel { padding: 20px; }
        .sudoku-board-toolbar { padding: 0 2px 15px; }
        .sudoku-board-label { display: flex; align-items: center; gap: 8px; color: #5d7068; font-size: 12px; font-weight: 900; }
        .sudoku-live-dot { width: 8px; height: 8px; border-radius: 50%; background: #3eae87; box-shadow: 0 0 0 4px rgba(62, 174, 135, .12); }
        .sudoku-toolbar-actions { display: flex; gap: 7px; }
        .sudoku-compact-button { display: inline-flex; align-items: center; gap: 6px; min-height: 31px; padding: 0 10px; border: 1px solid #d9e5de; border-radius: 9px; background: #fff; color: #5e7169; font-size: 11px; font-weight: 900; cursor: pointer; }
        .sudoku-compact-button:hover:not(:disabled) { border-color: #91cdb7; color: var(--sudoku-mint); }
        .sudoku-compact-button.danger { color: #b45353; }
        .sudoku-compact-button:disabled { opacity: .5; cursor: not-allowed; }
        .sudoku-board-wrap { display: flex; justify-content: center; padding: 2px; }
        .sudoku-board { display: grid; grid-template-columns: repeat(9, 1fr); width: min(100%, 610px); aspect-ratio: 1; overflow: hidden; border: 2px solid #758b81; border-radius: 11px; background: #c9d8d0; box-shadow: 0 15px 26px rgba(35, 64, 52, .12); }
        .sudoku-cell { position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; min-height: 0; padding: 0; border-style: solid; border-color: #d0dfd7; background: #fffefa; color: #27483a; cursor: pointer; transition: background .12s ease, color .12s ease; }
        .sudoku-cell:hover { background: #f0faf4; }
        .sudoku-cell.is-highlighted { background: #f0f8f3; }
        .sudoku-cell.is-same-value { background: #d9f4e4; color: #0f766e; }
        .sudoku-cell.is-selected { z-index: 1; background: #bce7d2; box-shadow: inset 0 0 0 2px #27946f; }
        .sudoku-cell.is-given { color: #193a30; background: #f5f3e9; font-weight: 950; }
        .sudoku-cell.is-error { background: #fff0ee; color: #d04f4b; }
        .sudoku-cell.is-selected.is-error { box-shadow: inset 0 0 0 2px #df7765; }
        .sudoku-cell-value { font-size: clamp(17px, 3.6vw, 30px); font-weight: 850; line-height: 1; }
        .sudoku-notes { display: grid; grid-template-columns: repeat(3, 1fr); width: 75%; height: 72%; align-items: center; justify-items: center; color: #a6b7af; font-size: clamp(6px, 1.3vw, 10px); font-weight: 800; line-height: 1; }
        .sudoku-notes i { font-style: normal; opacity: .2; }
        .sudoku-notes i.has-note { color: #318c73; opacity: 1; }
        .sudoku-board-footer { display: flex; justify-content: center; flex-wrap: wrap; gap: 15px; padding-top: 14px; color: #8a9b93; font-size: 10px; font-weight: 800; }
        .sudoku-board-footer span { display: inline-flex; align-items: center; gap: 5px; }
        .sudoku-legend-dot { width: 7px; height: 7px; border-radius: 50%; background: #c9d8d0; }
        .sudoku-legend-dot.given { background: #d5cdae; }
        .sudoku-legend-dot.error { background: #e78775; }
        .sudoku-legend-dot.selected { background: #75c9a7; }
        .sudoku-side-column { display: grid; align-content: start; gap: 15px; }
        .sudoku-stats-panel { padding: 20px; }
        .sudoku-stats-top { color: #6f8178; font-size: 12px; font-weight: 900; }
        .sudoku-stats-top strong { color: var(--sudoku-mint); font-size: 19px; }
        .sudoku-progress-track { height: 8px; margin-top: 13px; overflow: hidden; border-radius: 99px; background: #e5eee9; }
        .sudoku-progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #55b792, #d9a06c); transition: width .2s ease; }
        .sudoku-stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 18px; }
        .sudoku-stat-grid > div { display: grid; gap: 5px; min-height: 73px; padding: 11px; border: 1px solid #e5eee9; border-radius: 13px; background: #fbfdfb; }
        .sudoku-stat-grid svg { color: #65a78f; }
        .sudoku-stat-grid small { color: #94a49c; font-size: 10px; font-weight: 800; }
        .sudoku-stat-grid strong { color: #34584a; font-size: 17px; font-weight: 950; }
        .sudoku-stat-grid strong.is-warn { color: #cb6a42; }
        .sudoku-time-caption { margin-top: 13px; color: #9baaa3; font-size: 10px; font-weight: 800; text-align: right; }
        .sudoku-input-panel { padding: 17px; }
        .sudoku-input-heading { color: #536a60; font-size: 12px; font-weight: 900; }
        .sudoku-note-toggle { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border: 1px solid #d9e5de; border-radius: 8px; background: white; color: #81928a; font-size: 10px; font-weight: 900; cursor: pointer; }
        .sudoku-note-toggle.is-active { border-color: #e6b176; background: #fff5e8; color: #bc6d32; }
        .sudoku-number-pad { display: grid; grid-template-columns: repeat(5, 1fr); gap: 7px; margin-top: 13px; }
        .sudoku-number-button { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; border: 1px solid #d8e5de; border-radius: 10px; background: #fffefa; color: #315b4b; font-size: 15px; font-weight: 900; cursor: pointer; transition: .15s ease; }
        .sudoku-number-button:hover:not(:disabled) { border-color: #55ae8e; background: #effaf4; color: var(--sudoku-mint); transform: translateY(-1px); }
        .sudoku-number-button.is-complete { color: #9bada4; background: #f4f8f5; }
        .sudoku-number-button:disabled { cursor: not-allowed; opacity: .4; }
        .sudoku-erase-button, .sudoku-undo-button { grid-column: span 2; gap: 6px; font-size: 11px; }
        .sudoku-undo-button { grid-column: span 3; }
        .sudoku-tip-panel { display: flex; gap: 11px; align-items: flex-start; padding: 16px 17px; background: #fdfcf5; }
        .sudoku-tip-icon { display: flex; align-items: center; justify-content: center; width: 31px; height: 31px; flex: 0 0 auto; border-radius: 10px; background: #fff1de; color: #c46d32; }
        .sudoku-tip-panel strong { display: block; color: #536a60; font-size: 12px; }
        .sudoku-tip-panel p { margin: 4px 0 0; color: #8b9a92; font-size: 10px; font-weight: 700; line-height: 1.5; }
        .sudoku-result-preview { display: flex; align-items: center; gap: 17px; margin-top: 20px; padding: 22px; border: 1px solid #cfe9db; border-radius: 20px; background: #f4fcf7; }
        .sudoku-result-icon { display: flex; align-items: center; justify-content: center; width: 57px; height: 57px; flex: 0 0 auto; border-radius: 17px; background: #d8f3e3; color: #23825e; }
        .sudoku-result-preview h2 { margin: 5px 0 3px; font-size: 20px; }
        .sudoku-result-preview p { margin: 0; color: #789087; font-size: 12px; font-weight: 700; }
        .sudoku-result-preview .sudoku-primary-button { margin-left: auto; }
        .sudoku-bottom-note { display: flex; justify-content: space-between; gap: 12px; margin-top: 17px; padding: 0 4px; color: #8b9b93; font-size: 10px; font-weight: 800; }
        .sudoku-bottom-note span { display: inline-flex; align-items: center; gap: 5px; }
        .sudoku-modal-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(20, 37, 31, .46); backdrop-filter: blur(10px); }
        .sudoku-modal { position: relative; width: min(100%, 480px); padding: 29px; border: 1px solid rgba(255,255,255,.9); border-radius: 24px; background: #fffefa; box-shadow: 0 28px 80px rgba(14, 44, 32, .25); }
        .sudoku-modal-close { position: absolute; top: 16px; right: 16px; display: flex; align-items: center; justify-content: center; width: 31px; height: 31px; border: 1px solid #dce7e0; border-radius: 50%; background: white; color: #789087; cursor: pointer; }
        .sudoku-modal h2 { margin: 7px 0 9px; font-size: 25px; }
        .sudoku-modal > p { margin: 0; color: #71837b; font-size: 13px; font-weight: 700; line-height: 1.7; }
        .sudoku-rule-list { display: grid; gap: 10px; margin-top: 22px; }
        .sudoku-rule-list > div { display: grid; grid-template-columns: 31px 1fr; column-gap: 10px; padding: 11px 0; border-top: 1px solid #e7efe9; }
        .sudoku-rule-list span { grid-row: span 2; color: #d2925f; font-size: 10px; font-weight: 950; }
        .sudoku-rule-list strong { font-size: 12px; }
        .sudoku-rule-list small { margin-top: 3px; color: #83938c; font-size: 10px; font-weight: 700; line-height: 1.5; }
        .spin { animation: sudoku-spin .8s linear infinite; }
        @keyframes sudoku-spin { to { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .sudoku-topbar { grid-template-columns: 1fr auto; padding: 13px 16px; }
          .sudoku-brand { justify-self: start; grid-column: 1; grid-row: 1; }
          .sudoku-back { grid-column: 1; grid-row: 2; font-size: 11px; }
          .sudoku-back span { display: none; }
          .sudoku-top-actions { grid-column: 2; grid-row: 1 / span 2; }
          .sudoku-brand-kicker { display: none; }
          .sudoku-main { width: min(100% - 20px, 620px); padding-top: 18px; }
          .sudoku-hero { min-height: 145px; padding: 22px 20px; border-radius: 20px; }
          .sudoku-hero h1 { font-size: 28px; }
          .sudoku-hero p { max-width: 230px; font-size: 12px; line-height: 1.5; }
          .sudoku-hero-mark { width: 94px; height: 94px; margin-right: -7px; }
          .sudoku-hero-grid { width: 84px; height: 84px; padding: 5px; border-radius: 10px; }
          .sudoku-hero-grid span { font-size: 9px; }
          .sudoku-hero-stamp { right: -9px; bottom: -1px; padding: 4px 5px; font-size: 8px; }
          .sudoku-select-layout, .sudoku-play-layout { grid-template-columns: 1fr; }
          .sudoku-select-panel, .sudoku-intro-panel { padding: 20px; }
          .sudoku-intro-panel h2 { max-width: none; font-size: 19px; }
          .sudoku-board-panel { padding: 11px; border-radius: 17px; }
          .sudoku-board-toolbar { padding: 3px 2px 11px; }
          .sudoku-compact-button { padding: 0 8px; }
          .sudoku-board { border-radius: 8px; }
          .sudoku-cell-value { font-size: clamp(16px, 6.3vw, 27px); }
          .sudoku-notes { font-size: clamp(5px, 2vw, 9px); }
          .sudoku-side-column { grid-template-columns: 1fr; }
          .sudoku-input-panel { grid-row: 1; }
          .sudoku-stats-panel, .sudoku-input-panel, .sudoku-tip-panel { padding: 15px; }
          .sudoku-bottom-note { flex-direction: column; align-items: flex-start; padding-bottom: 15px; }
          .sudoku-result-preview { flex-wrap: wrap; }
          .sudoku-result-preview .sudoku-primary-button { width: 100%; margin-left: 0; }
        }
        @media (max-width: 380px) {
          .sudoku-difficulty-card { grid-template-columns: 42px 1fr; }
          .sudoku-difficulty-number { width: 39px; height: 39px; font-size: 16px; }
          .sudoku-difficulty-time { display: none; }
        }
      `}</style>
    </div>
  );
}
