'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Gift, Loader2, Sparkles, History,
  User as UserIcon, LogOut, Trophy, AlertCircle, Copy, Check, Crown, Star, Zap, ChevronRight
} from 'lucide-react';

// 奖品配置 - 视觉角度更均匀，实际概率由后端控制
const PRIZES = [
  { id: 'tier_1', name: '1刀福利', value: 1, color: '#22c55e', visualAngle: 90 },   // 绿色
  { id: 'tier_3', name: '3刀福利', value: 3, color: '#3b82f6', visualAngle: 75 },   // 蓝色
  { id: 'tier_5', name: '5刀福利', value: 5, color: '#f59e0b', visualAngle: 70 },   // 橙色
  { id: 'tier_10', name: '10刀福利', value: 10, color: '#ec4899', visualAngle: 55 }, // 粉色
  { id: 'tier_15', name: '15刀福利', value: 15, color: '#8b5cf6', visualAngle: 40 }, // 紫色
  { id: 'tier_20', name: '20刀福利', value: 20, color: '#ef4444', visualAngle: 30 }, // 红色
];

// 视觉样式映射 - 不修改原数组，仅用于UI渲染
const PRIZE_STYLES: Record<string, { colors: string[], text: string, icon: string }> = {
  'tier_1': { colors: ['#4ade80', '#22c55e'], text: 'text-green-700', icon: '🌱' },
  'tier_3': { colors: ['#60a5fa', '#3b82f6'], text: 'text-blue-700', icon: '💧' },
  'tier_5': { colors: ['#fbbf24', '#f59e0b'], text: 'text-amber-700', icon: '🔥' },
  'tier_10': { colors: ['#f472b6', '#ec4899'], text: 'text-pink-700', icon: '🌸' },
  'tier_15': { colors: ['#a78bfa', '#8b5cf6'], text: 'text-violet-700', icon: '🔮' },
  'tier_20': { colors: ['#f87171', '#ef4444'], text: 'text-red-700', icon: '💎' },
};

// 计算每个奖品的实际角度范围
const calculateAngles = () => {
  let currentAngle = 0;
  return PRIZES.map(prize => {
    const startAngle = currentAngle;
    const endAngle = currentAngle + prize.visualAngle;
    currentAngle = endAngle;
    return { ...prize, startAngle, endAngle };
  });
};

const PRIZES_WITH_ANGLES = calculateAngles();

const RANKING_POLL_INTERVAL_MS = 30000;
const RANKING_MAX_BACKOFF_MS = 120000;
const PRE_SPIN_DEG_PER_SECOND = 540;

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

interface LotteryRecord {
  id: string;
  tierName: string;
  tierValue: number;
  code: string;
  directCredit?: boolean;  // 是否为直充模式
  createdAt: number;
}

interface LotteryApiPayload {
  success: boolean;
  user: UserData;
  records: LotteryRecord[];
  canSpin: boolean;
  hasSpunToday: boolean;
  extraSpins: number;
}

interface LotterySpinResponse {
  success: boolean;
  message?: string;
  record?: LotteryRecord;
  state?: {
    canSpin: boolean;
    hasSpunToday: boolean;
    extraSpins: number;
  };
}

interface RankingUser {
  rank: number;
  userId: string;
  username: string;
  totalValue: number;
  bestPrize: string;
  count: number;
}

export default function LotteryPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<LotteryRecord[]>([]);
  const [canSpin, setCanSpin] = useState(false);
  const [hasSpunToday, setHasSpunToday] = useState(false);
  const [extraSpins, setExtraSpins] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [spinPhase, setSpinPhase] = useState<'idle' | 'requesting' | 'settling'>('idle');
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ name: string; code: string; directCredit?: boolean; value?: number } | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRecordId, setCopiedRecordId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // 排行榜
  const [ranking, setRanking] = useState<RankingUser[]>([]);
  const [rankingLoading, setRankingLoading] = useState(true);
  
  // [M2修复] 用于清理 setTimeout 和 requestAnimationFrame
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const preSpinFrameRef = useRef<number | null>(null);
  const preSpinLastTsRef = useRef<number | null>(null);
  const confettiFrameRef = useRef<number | null>(null);
  const confettiEndTimeRef = useRef<number>(0);
  const modalCopyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const recordCopyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rankingPollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rankingInFlightRef = useRef(false);
  const rankingFailCountRef = useRef(0);
  const rankingUnmountedRef = useRef(false);

  const clearPreSpinAnimation = useCallback(() => {
    if (preSpinFrameRef.current !== null) {
      cancelAnimationFrame(preSpinFrameRef.current);
      preSpinFrameRef.current = null;
    }
    preSpinLastTsRef.current = null;
  }, []);

  const startPreSpinAnimation = useCallback(() => {
    clearPreSpinAnimation();

    const tick = (timestamp: number) => {
      if (preSpinLastTsRef.current === null) {
        preSpinLastTsRef.current = timestamp;
      }

      const elapsedMs = Math.max(0, timestamp - (preSpinLastTsRef.current ?? timestamp));
      preSpinLastTsRef.current = timestamp;
      const deltaDeg = (elapsedMs / 1000) * PRE_SPIN_DEG_PER_SECOND;

      setRotation((prev) => prev + deltaDeg);
      preSpinFrameRef.current = requestAnimationFrame(tick);
    };

    preSpinFrameRef.current = requestAnimationFrame(tick);
  }, [clearPreSpinAnimation]);

  // [M2修复] 清理函数
  useEffect(() => {
    rankingUnmountedRef.current = false;

    return () => {
      rankingUnmountedRef.current = true;
      rankingInFlightRef.current = false;

      // 组件卸载时清理所有定时器和动画
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = null;
      }
      clearPreSpinAnimation();
      if (confettiFrameRef.current) {
        cancelAnimationFrame(confettiFrameRef.current);
        confettiFrameRef.current = null;
      }
      if (modalCopyTimeoutRef.current) {
        clearTimeout(modalCopyTimeoutRef.current);
        modalCopyTimeoutRef.current = null;
      }
      if (recordCopyTimeoutRef.current) {
        clearTimeout(recordCopyTimeoutRef.current);
        recordCopyTimeoutRef.current = null;
      }
      if (rankingPollTimeoutRef.current) {
        clearTimeout(rankingPollTimeoutRef.current);
        rankingPollTimeoutRef.current = null;
      }
    };
  }, [clearPreSpinAnimation]);

  const clearRankingPollTimer = useCallback(() => {
    if (rankingPollTimeoutRef.current) {
      clearTimeout(rankingPollTimeoutRef.current);
      rankingPollTimeoutRef.current = null;
    }
  }, []);

  const getRankingBackoffDelay = useCallback((failCount: number) => {
    const level = Math.min(Math.max(failCount, 0), 3);
    return Math.min(RANKING_POLL_INTERVAL_MS * (2 ** level), RANKING_MAX_BACKOFF_MS);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/lottery');
      const data: LotteryApiPayload = await res.json();

      if (res.status === 401 || !data.success || !data.user) {
        router.push('/login?redirect=/lottery');
        return;
      }

      setUser(data.user);
      setRecords(Array.isArray(data.records) ? data.records : []);
      setCanSpin(Boolean(data.canSpin));
      setHasSpunToday(Boolean(data.hasSpunToday));
      setExtraSpins(typeof data.extraSpins === 'number' ? data.extraSpins : 0);
      setError(null);
    } catch (err) {
      console.error('加载失败', err);
      setError('网络连接失败');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const fetchRanking = useCallback(async () => {
    if (rankingUnmountedRef.current || rankingInFlightRef.current) {
      return;
    }

    rankingInFlightRef.current = true;
    let fetchOk = false;

    try {
      const res = await fetch('/api/lottery/ranking?limit=10');
      if (!res.ok) {
        throw new Error('排行榜请求失败: ' + res.status);
      }

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || '排行榜返回失败状态');
      }

      if (!rankingUnmountedRef.current) {
        setRanking(data.ranking || []);
      }
      rankingFailCountRef.current = 0;
      fetchOk = true;
    } catch (err) {
      rankingFailCountRef.current += 1;
      console.error('获取排行榜失败', err);
    } finally {
      rankingInFlightRef.current = false;
      if (!rankingUnmountedRef.current) {
        setRankingLoading(false);
      }

      clearRankingPollTimer();
      if (!rankingUnmountedRef.current && document.visibilityState === 'visible') {
        const nextDelay = fetchOk
          ? RANKING_POLL_INTERVAL_MS
          : getRankingBackoffDelay(rankingFailCountRef.current);
        rankingPollTimeoutRef.current = setTimeout(() => {
          if (!rankingUnmountedRef.current) {
            void fetchRanking();
          }
        }, nextDelay);
      }
    }
  }, [clearRankingPollTimer, getRankingBackoffDelay]);

  // 初始化数据
  useEffect(() => {
    void fetchData();
    void fetchRanking();

    const onVisibilityChange = () => {
      if (rankingUnmountedRef.current) {
        return;
      }

      if (document.visibilityState === 'visible') {
        rankingFailCountRef.current = 0;
        clearRankingPollTimer();
        void fetchRanking();
      } else {
        clearRankingPollTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearRankingPollTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clearRankingPollTimer, fetchData, fetchRanking]);

  const handleSpin = useCallback(async () => {
    if (!canSpin || spinning) return;

    setSpinning(true);
    setSpinPhase('requesting');
    setError(null);
    startPreSpinAnimation();

    try {
      const res = await fetch('/api/lottery/spin', { method: 'POST' });
      const data: LotterySpinResponse = await res.json();

      if (data.success) {
        const record = data.record;
        if (!record) {
          clearPreSpinAnimation();
          setSpinning(false);
          setSpinPhase('idle');
          setError('系统错误：中奖结果缺失');
          return;
        }

        // 根据后端返回的 tierValue 找到对应的奖品（用于转盘动画定位）
        const prize = PRIZES_WITH_ANGLES.find(p => p.value === Number(record.tierValue));

        if (prize) {
          clearPreSpinAnimation();
          setSpinPhase('settling');

          // 归一化角度到 [0, 360) 范围，处理负数和超过 360 的情况
          const normalize = (deg: number) => ((deg % 360) + 360) % 360;
          
          // 计算这个奖品区域的中心角度
          const centerAngle = (prize.startAngle + prize.endAngle) / 2;
          // 转盘需要停在指针指向的位置（顶部 = 0度）
          // 目标角度：让 centerAngle 对准指针（0度位置）
          const targetAngle = normalize(360 - centerAngle);
          
          // [FIX] 修复累加逻辑：计算相对于当前角度的增量
          // 修复前 bug：直接用 prev + 360*12 + targetAngle 累加，
          // 把"绝对目标角度"当成"增量"，导致第二次及之后停留位置偏移
          setRotation(prev => {
            const current = normalize(prev);      // 当前停留角度
            const desired = targetAngle;          // 目标停留角度
            const delta = normalize(desired - current); // 需要额外转动的增量
            return prev + 360 * 12 + delta;       // 12 圈 + 增量
          });

          // 动画结束后显示结果 (6.5秒后 - 稍微留点余量给CSS动画)
          // [M2修复] 使用 ref 存储 timeout ID 以便清理
          if (spinTimeoutRef.current) {
            clearTimeout(spinTimeoutRef.current);
          }
          spinTimeoutRef.current = setTimeout(async () => {
            spinTimeoutRef.current = null;
            setSpinning(false);
            setSpinPhase('idle');
            // 直接使用后端返回的数据
            setResult({
              name: record.tierName,
              code: record.code || '',
              directCredit: record.directCredit || false,
              value: record.tierValue
            });
            setShowResultModal(true);

            setRecords((prev) => [record, ...prev].slice(0, 20));
            if (data.state) {
              setCanSpin(Boolean(data.state.canSpin));
              setHasSpunToday(Boolean(data.state.hasSpunToday));
              setExtraSpins(typeof data.state.extraSpins === 'number' ? data.state.extraSpins : 0);
            }
            void fetchRanking();

            // [Perf] 动态导入彩带特效，减少首屏 JS 体积
            // [M2修复] 使用 ref 控制动画循环
            // [Perf] 优化: 减少粒子数量，使用节流避免每帧都发射
            import('canvas-confetti').then(({ default: confetti }) => {
              const duration = 2500;
              confettiEndTimeRef.current = Date.now() + duration;
              let lastFrame = 0;
              const throttleMs = 80; // 每80ms发射一次，而不是每帧

              const frame = (timestamp: number) => {
                if (timestamp - lastFrame >= throttleMs) {
                  lastFrame = timestamp;
                  confetti({
                    particleCount: 6,  // 减少粒子数
                    angle: 60,
                    spread: 55,
                    origin: { x: 0 },
                    shapes: ['circle'],  // 只用圆形，star性能开销大
                    colors: ['#fbbf24', '#f97316', '#ec4899', '#a78bfa', '#34d399', '#60a5fa'],
                    disableForReducedMotion: true,
                    drift: 0,
                    ticks: 150  // 粒子存活时间缩短
                  });
                  confetti({
                    particleCount: 6,
                    angle: 120,
                    spread: 55,
                    origin: { x: 1 },
                    shapes: ['circle'],
                    colors: ['#fbbf24', '#f97316', '#ec4899', '#a78bfa', '#34d399', '#60a5fa'],
                    disableForReducedMotion: true,
                    drift: 0,
                    ticks: 150
                  });
                }

                if (Date.now() < confettiEndTimeRef.current) {
                  confettiFrameRef.current = requestAnimationFrame(frame);
                }
              };
              confettiFrameRef.current = requestAnimationFrame(frame);
            });

          }, 6000);
        } else {
          clearPreSpinAnimation();
          setSpinning(false);
          setSpinPhase('idle');
          setError('系统错误：未知奖品');
        }
      } else {
        clearPreSpinAnimation();
        setError(data.message || '抽奖失败');
        setSpinning(false);
        setSpinPhase('idle');
      }
    } catch (err) {
      clearPreSpinAnimation();
      console.error(err);
      setError('抽奖请求失败，请稍后重试');
      setSpinning(false);
      setSpinPhase('idle');
    }
  }, [canSpin, spinning, startPreSpinAnimation, clearPreSpinAnimation, fetchRanking]);

  const handleCopy = () => {
    if (result?.code) {
      navigator.clipboard.writeText(result.code);
      setCopied(true);
      if (modalCopyTimeoutRef.current) {
        clearTimeout(modalCopyTimeoutRef.current);
      }
      modalCopyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  // 生成圆锥渐变样式 - 使用自定义的更美观的颜色
  const getConicGradient = () => {
    let stops = '';
    PRIZES_WITH_ANGLES.forEach((prize, index) => {
      // 使用样式映射表中的颜色，如果找不到则回退到默认
      const style = PRIZE_STYLES[prize.id] || { colors: [prize.color, prize.color] };
      const color = style.colors[0]; // 使用主色
      stops += `${color} ${prize.startAngle}deg ${prize.endAngle}deg${index < PRIZES_WITH_ANGLES.length - 1 ? ', ' : ''}`;
    });
    return `conic-gradient(${stops})`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在准备惊喜...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf8] overflow-x-hidden pb-20">
      {/* [Perf-3] 移除 fixed + blur 背景层，改用纯 CSS 渐变（在 globals.css body 中定义） */}
      
      {/* 导航栏 */}
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-orange-600 transition-colors group">
              <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-orange-200 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-medium text-sm">返回首页</span>
            </Link>
            
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-1.5 py-1.5 pr-4 bg-white/60 rounded-full border border-white/60 shadow-sm hover:shadow-md transition-shadow cursor-default">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white shadow-inner">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-stone-700 text-xs leading-none mb-0.5">
                      {user.displayName}
                    </span>
                    <span className="text-[10px] text-stone-400 font-medium leading-none">
                      LUCKY USER
                    </span>
                  </div>
                </div>
                <button 
                  onClick={handleLogout} 
                  className="p-2.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all hover:shadow-sm"
                  title="退出登录"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题区 */}
        <div className="text-center mb-12 animate-fade-in relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[100px] bg-orange-300/20 blur-[60px] -z-10"></div>
          <div className="inline-flex items-center justify-center p-3 bg-gradient-to-br from-orange-100 to-amber-50 rounded-2xl mb-4 shadow-glow-gold rotate-3 border border-orange-100">
            <Sparkles className="w-8 h-8 text-orange-500 fill-orange-500 animate-pulse" />
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black text-stone-700 tracking-tight mb-4 drop-shadow-sm">
            每日<span className="text-gradient-primary relative inline-block">
              幸运抽奖
              <svg className="absolute -bottom-2 left-0 w-full h-3 text-orange-400 opacity-50" viewBox="0 0 100 10" preserveAspectRatio="none">
                <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="3" fill="none" />
              </svg>
            </span>
          </h1>
          <p className="text-lg text-stone-500 max-w-lg mx-auto font-medium">
            赢取最高 <span className="text-red-500 font-bold bg-red-50 px-1 rounded">20刀</span> 兑换码福利，
            <span className="text-orange-600 font-bold">100% 中奖概率</span>，好运即刻降临！
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_320px] gap-8 lg:gap-10 items-start">
          
          {/* 左侧：今日运气最佳排行榜 */}
          <div className="order-2 lg:order-1 space-y-6">
            <div className="glass-card rounded-3xl p-6 w-full animate-fade-in" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-yellow-100 rounded-xl text-yellow-600 shadow-inner">
                    <Crown className="w-5 h-5 fill-yellow-600" />
                  </div>
                  <h2 className="text-lg font-bold text-stone-700">今日欧皇榜</h2>
                </div>
                <div className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full uppercase tracking-wider">
                  Live
                </div>
              </div>
              
              {rankingLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-orange-400" />
                  <span className="text-xs text-stone-400">正在同步数据...</span>
                </div>
              ) : ranking.length === 0 ? (
                <div className="text-center py-12 text-stone-400 bg-stone-50/50 rounded-2xl border border-stone-100 border-dashed">
                  <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">虚位以待</p>
                </div>
              ) : (
                <div className="space-y-3 relative">
                   {/* 连接线装饰 */}
                   <div className="absolute left-[19px] top-6 bottom-6 w-0.5 bg-stone-100 -z-10"></div>
                   
                  {ranking.map((user, index) => (
                    <div 
                      key={user.userId}
                      className={`flex items-center gap-3 p-3 rounded-2xl transition-all hover:scale-[1.02] ${
                        index === 0 ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-200 shadow-sm' :
                        index === 1 ? 'bg-gradient-to-r from-stone-50 to-gray-50 border border-stone-200' :
                        index === 2 ? 'bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200' :
                        'bg-white border border-transparent hover:border-stone-100 hover:bg-stone-50'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black shrink-0 shadow-sm border-2 border-white ${
                        index === 0 ? 'bg-yellow-400 text-white' :
                        index === 1 ? 'bg-stone-400 text-white' :
                        index === 2 ? 'bg-orange-400 text-white' :
                        'bg-stone-100 text-stone-400'
                      }`}>
                        {user.rank}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="font-bold text-stone-700 text-sm truncate pr-2">{user.username}</div>
                          {index === 0 && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                        </div>
                        <div className="text-xs text-stone-400 flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {user.count}次尝试
                        </div>
                      </div>
                      
                      <div className="text-right shrink-0">
                        <div className={`font-black text-sm ${
                          index === 0 ? 'text-yellow-600' :
                          index === 1 ? 'text-stone-600' :
                          index === 2 ? 'text-orange-600' :
                          'text-stone-500'
                        }`}>
                          ${user.totalValue}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 中间：转盘区域 */}
          <div className="flex flex-col items-center order-1 lg:order-2 animate-scale-in">
            <div className="relative group perspective-1000">
              {/* 光晕背景 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-orange-500/10 blur-[80px] rounded-full animate-pulse-glow -z-10"></div>
              
              <div className="relative w-[340px] h-[340px] sm:w-[400px] sm:h-[400px] md:w-[440px] md:h-[440px]">
                {/* 外圈装饰 - 3D 边框 (花瓣) */}
                <div 
                  className="absolute inset-0 bg-gradient-to-br from-white to-pink-50 drop-shadow-xl will-change-auto"
                  style={{ 
                    clipPath: 'polygon(50% 0%, 61% 5%, 65% 15%, 75% 10%, 80% 20%, 90% 15%, 93% 25%, 100% 25%, 98% 38%, 100% 50%, 98% 62%, 100% 75%, 93% 75%, 90% 85%, 80% 80%, 75% 90%, 65% 85%, 61% 95%, 50% 100%, 39% 95%, 35% 85%, 25% 90%, 20% 80%, 10% 85%, 7% 75%, 0% 75%, 2% 62%, 0% 50%, 2% 38%, 0% 25%, 7% 25%, 10% 15%, 20% 20%, 25% 10%, 35% 15%, 39% 5%)',
                    transform: 'translateZ(0)'  // Force GPU layer
                  }}
                ></div>
                
                {/* 内圈边框 - 金色/橙色装饰线 */}
                <div className="absolute inset-3 rounded-full bg-gradient-to-tr from-orange-400 to-amber-300 shadow-inner p-1">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-pink-200 via-orange-100 to-amber-200 shadow-[inset_0_4px_12px_rgba(251,146,60,0.2)]"></div>
                </div>

                {/* 转盘主体 */}
                <div 
                  className="absolute inset-[20px] rounded-full overflow-hidden border-4 border-white/20 will-change-transform"
                  style={{ 
                    background: getConicGradient(),
                    transform: `rotate(${rotation}deg) translateZ(0)`,
                    transition: spinPhase === 'settling'
                      ? 'transform 6s cubic-bezier(0.25, 0.1, 0.25, 1)'
                      : 'none',
                    boxShadow: 'inset 0 0 40px rgba(0,0,0,0.2)',
                    backfaceVisibility: 'hidden'
                  }}
                >
                  {/* 扇区内部高光/纹理叠加 */}
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_50%,transparent_30%,rgba(0,0,0,0.1)_100%)]"></div>

                  {/* 奖品内容 */}
                  {PRIZES_WITH_ANGLES.map((prize) => (
                    <div 
                      key={prize.id}
                      className="absolute w-full h-full top-0 left-0"
                      style={{ transform: `rotate(${prize.startAngle + (prize.endAngle - prize.startAngle)/2}deg)` }}
                    >
                      {/* 分割线 */}
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-1/2 w-0.5 bg-white/40 origin-bottom" style={{ transform: `rotate(${-((prize.endAngle - prize.startAngle)/2)}deg)` }}></div>
                      
                      {/* 奖品文字和图标 */}
                      <div className="absolute top-8 left-1/2 -translate-x-1/2 text-center transform -rotate-0">
                        <div className="text-2xl mb-1 filter drop-shadow-md transform hover:scale-110 transition-transform">
                          {PRIZE_STYLES[prize.id]?.icon || '🎁'}
                        </div>
                        <div className="text-white font-black text-sm sm:text-base drop-shadow-md whitespace-nowrap tracking-wide">
                          ${prize.value}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 中心装饰盖 */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-white rounded-full shadow-[0_10px_25px_rgba(0,0,0,0.2)] flex items-center justify-center border-[6px] border-stone-100 z-10 group-hover:scale-105 transition-transform duration-300">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shadow-inner relative overflow-hidden">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-30"></div>
                    <span className="text-white font-black text-sm tracking-widest relative z-10">LUCKY</span>
                  </div>
                </div>

                {/* 顶部指针 */}
                <div className={`absolute -top-6 left-1/2 z-20 filter drop-shadow-[0_4px_6px_rgba(0,0,0,0.3)] hover:drop-shadow-[0_0_15px_rgba(251,146,60,0.7)] transition-all duration-300 ${!spinning ? 'animate-pointer-wobble' : '-translate-x-1/2'}`}>
                  <div className="relative">
                     <div className="w-12 h-16 bg-gradient-to-b from-pink-400 to-orange-400 clip-path-pointer flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)] animate-pulse mt-[-20px]"></div>
                     </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 抽奖控制区 */}
            <div className="mt-12 w-full max-w-sm text-center space-y-5">
              {error && (
                <div className="animate-fade-in flex items-center justify-center gap-2 text-red-600 text-sm bg-red-50 border border-red-100 py-3 px-4 rounded-xl shadow-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              
              <div className="flex items-center justify-center gap-4 text-sm">
                 {/* 每日次数 */}
                <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${
                  hasSpunToday 
                  ? 'bg-stone-100 text-stone-400 border-transparent' 
                  : 'bg-green-50 text-green-700 border-green-200 shadow-sm'
                }`}>
                  <span className="font-bold">每日:</span>
                  <span className="font-black text-base">{hasSpunToday ? '0' : '1'}</span>
                </div>

                 {/* 额外次数 */}
                 {extraSpins > 0 ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-700 rounded-xl border border-orange-200 shadow-sm animate-pulse-glow">
                    <Gift className="w-4 h-4 fill-orange-700" />
                    <span className="font-bold">额外:</span>
                    <span className="font-black text-base">{extraSpins}</span>
                  </div>
                 ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-stone-50 text-stone-300 rounded-xl border border-transparent">
                    <Gift className="w-4 h-4" />
                    <span className="font-medium">额外: 0</span>
                  </div>
                 )}
              </div>
              
              <button
                onClick={handleSpin}
                disabled={!canSpin || spinning}
                className={`group relative w-full py-5 rounded-2xl text-xl font-black text-white shadow-[0_10px_30px_rgba(249,115,22,0.4)] transition-all transform overflow-hidden
                  ${canSpin && !spinning 
                    ? 'gradient-warm hover:shadow-[0_15px_40px_rgba(249,115,22,0.6)] hover:-translate-y-1 active:scale-95 active:shadow-inner' 
                    : 'bg-stone-300 cursor-not-allowed shadow-none grayscale'}`}
              >
                {/* 按钮内的光效 */}
                {canSpin && !spinning && <div className="absolute inset-0 bg-white/20 translate-y-full skew-y-12 group-hover:translate-y-[-200%] transition-transform duration-700 ease-in-out"></div>}
                
                {spinning ? (
                  <span className="flex items-center justify-center gap-3">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="tracking-widest">WISHING...</span>
                  </span>
                ) : canSpin ? (
                  <span className="flex items-center justify-center gap-2 tracking-widest">
                    <Sparkles className="w-5 h-5 fill-white animate-pulse" />
                    GO LUCKY
                    <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </span>
                ) : (
                  '明日再来'
                )}
              </button>
              
              <p className="text-xs text-stone-400 font-medium tracking-wide uppercase">
                {canSpin 
                  ? '点击按钮开始抽奖' 
                  : '今日机会已耗尽 • 请签到获取更多次数'}
              </p>
            </div>
          </div>

          {/* 右侧：中奖记录 */}
          <div className="order-3 space-y-6">
            <div className="glass-card rounded-3xl p-6 w-full animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-orange-100 rounded-xl text-orange-600 shadow-inner">
                  <History className="w-5 h-5" />
                </div>
                <h2 className="text-lg font-bold text-stone-700">我的宝藏</h2>
              </div>

              <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-hide pr-1">
                {records.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-stone-400 bg-stone-50/50 rounded-2xl border border-stone-100 border-dashed">
                    <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-3">
                        <Gift className="w-8 h-8 opacity-20" />
                    </div>
                    <p className="text-sm font-medium">暂无战利品</p>
                    <p className="text-xs mt-1">快去试试手气吧！</p>
                  </div>
                ) : (
                  records.map((record) => (
                    <div key={record.id} className="group relative bg-white rounded-xl border border-stone-100 p-3 shadow-sm hover:shadow-md transition-all hover:border-orange-200 overflow-hidden">
                      {/* 装饰性背景 */}
                      <div className="absolute right-0 top-0 w-16 h-16 bg-gradient-to-bl from-orange-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-tr-xl"></div>
                      
                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">{PRIZE_STYLES[`tier_${record.tierValue}`]?.icon || '🎁'}</span>
                            <span className={`font-bold text-sm ${PRIZE_STYLES[`tier_${record.tierValue}`]?.text || 'text-stone-700'}`}>
                                {record.tierName}
                            </span>
                            {record.directCredit && (
                              <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">
                                已直充
                              </span>
                            )}
                        </div>
                        <span className="text-[10px] text-stone-400 font-mono bg-stone-50 px-1.5 py-0.5 rounded">
                           {new Date(record.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      
                      {/* 直充模式显示金额，兑换码模式显示码 */}
                      {record.directCredit ? (
                        <div className="relative bg-green-50 rounded-lg p-2 border border-green-200 flex items-center justify-center">
                          <span className="text-sm font-bold text-green-700">
                            💰 ${record.tierValue} 已充值到账户
                          </span>
                        </div>
                      ) : (
                        <div className="relative bg-stone-50 rounded-lg p-2 border border-stone-100 border-dashed flex items-center justify-between group-hover:bg-white transition-colors">
                          <code className="text-xs font-mono text-stone-600 truncate max-w-[140px] select-all">
                             {record.code}
                          </code>
                          <button 
                              onClick={() => {
                                  navigator.clipboard.writeText(record.code);
                                  setCopiedRecordId(record.id);
                                  if (recordCopyTimeoutRef.current) {
                                    clearTimeout(recordCopyTimeoutRef.current);
                                  }
                                  recordCopyTimeoutRef.current = setTimeout(() => {
                                    setCopiedRecordId((current) => (current === record.id ? null : current));
                                  }, 1000);
                              }}
                              className={`p-1.5 hover:bg-stone-100 rounded transition-colors ${
                                copiedRecordId === record.id ? 'text-green-500' : 'text-stone-400 hover:text-stone-600'
                              }`}
                              title={copiedRecordId === record.id ? '已复制' : '复制'}
                          >
                              {copiedRecordId === record.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 中奖弹窗 - 视觉升级 */}
      {showResultModal && result && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-pink-900/40 backdrop-blur-sm transition-opacity" onClick={() => setShowResultModal(false)} />
          
          <div className="relative w-full max-w-sm bg-gradient-to-br from-pink-50 via-orange-50 to-amber-50 rounded-[2.5rem] shadow-[0_20px_60px_rgba(251,146,60,0.3)] p-8 text-center animate-scale-in overflow-hidden border-4 border-white/80">
             {/* 弹窗背景装饰 */}
             <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-orange-50 to-transparent -z-10"></div>
             <div className="absolute -top-10 -right-10 w-40 h-40 bg-pink-200 rounded-full blur-3xl opacity-40"></div>
             <div className="absolute -top-10 -left-10 w-40 h-40 bg-amber-200 rounded-full blur-3xl opacity-40"></div>

            <button 
              onClick={() => setShowResultModal(false)}
              className="absolute top-4 right-4 p-2 bg-stone-50 rounded-full hover:bg-stone-100 transition-colors z-20"
            >
              <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="relative mx-auto mb-6 w-24 h-24">
                <div className="absolute inset-0 bg-orange-200 rounded-full animate-ping opacity-20"></div>
                <div className="relative w-24 h-24 bg-gradient-to-br from-orange-100 to-yellow-50 rounded-full flex items-center justify-center shadow-lg border-4 border-white">
                  <Trophy className="w-12 h-12 text-orange-500 fill-orange-500 animate-[bounce_2s_infinite]" />
                </div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                    WINNER
                </div>
            </div>

            <h3 className="text-3xl font-black text-stone-700 mb-2 tracking-tight">恭喜中奖！</h3>
            <p className="text-stone-500 mb-8 font-medium">
              运气爆棚！您获得了 <br/>
              <span className="text-2xl text-transparent bg-clip-text bg-gradient-to-r from-orange-600 to-red-600 font-black mt-2 inline-block">
                  {result.name}
              </span>
              {result.directCredit && (
                <span className="block text-sm text-green-600 mt-2 font-bold">
                  💰 已直接充值到您的账户
                </span>
              )}
            </p>

            {/* 直充模式显示金额，兑换码模式显示码 */}
            {result.directCredit ? (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200 rounded-2xl p-6 mb-8">
                <div className="text-center">
                  <p className="text-sm text-green-600 mb-2 font-medium">充值金额</p>
                  <p className="text-4xl font-black text-green-700">${result.value}</p>
                  <p className="text-xs text-green-500 mt-2">已添加到您的 API 账户余额</p>
                </div>
              </div>
            ) : (
              <div className="bg-stone-50 border-2 border-dashed border-orange-200 rounded-2xl p-1 mb-8 relative group hover:border-orange-300 transition-colors">
                <div className="bg-white rounded-xl p-4 shadow-sm">
                  <p className="font-mono text-xl font-bold text-stone-700 break-all tracking-wider">{result.code}</p>
                </div>
                <button 
                  onClick={handleCopy}
                  className={`absolute -right-3 -top-3 p-2.5 rounded-xl shadow-lg transition-all transform hover:scale-110 ${
                    copied ? 'bg-green-500 text-white' : 'bg-orange-500 text-white'
                  }`}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}

            <button 
              onClick={() => setShowResultModal(false)}
              className="w-full py-4 gradient-warm text-white rounded-2xl font-bold text-lg shadow-xl shadow-orange-500/20 hover:shadow-orange-500/30 active:scale-95 transition-all"
            >
              收入囊中
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
