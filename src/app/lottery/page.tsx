'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, Gift, Loader2, Sparkles, History, 
  User as UserIcon, LogOut, Trophy, AlertCircle, Copy, Check 
} from 'lucide-react';
import confetti from 'canvas-confetti';

// 奖品配置 - id 需与后端 tier id 一致
const PRIZES = [
  { id: 'tier_1', name: '1刀福利', value: 1, color: '#fbbf24', startAngle: 0, endAngle: 144 },
  { id: 'tier_3', name: '3刀福利', value: 3, color: '#fb923c', startAngle: 144, endAngle: 252 },
  { id: 'tier_5', name: '5刀福利', value: 5, color: '#f97316', startAngle: 252, endAngle: 316.8 },
  { id: 'tier_10', name: '10刀福利', value: 10, color: '#ea580c', startAngle: 316.8, endAngle: 345.6 },
  { id: 'tier_15', name: '15刀福利', value: 15, color: '#dc2626', startAngle: 345.6, endAngle: 356.4 },
  { id: 'tier_20', name: '20刀福利', value: 20, color: '#b91c1c', startAngle: 356.4, endAngle: 360 },
];

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
  createdAt: number;
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
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ name: string; code: string } | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初始化数据
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const userRes = await fetch('/api/auth/me');

      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.success) {
          setUser(userData.user);
          // 获取中奖记录
          const recordsRes = await fetch('/api/lottery/records');
          if (recordsRes.ok) {
            const recordsData = await recordsRes.json();
            if (recordsData.success) {
              setRecords(recordsData.records || []);
            }
          }
        } else {
          router.push('/login?redirect=/lottery');
          return;
        }
      }

      // 获取抽奖状态
      const lotteryRes = await fetch('/api/lottery');
      if (lotteryRes.ok) {
        const data = await lotteryRes.json();
        if (data.success) {
          setCanSpin(data.canSpin);
          setHasSpunToday(data.hasSpunToday || false);
          setExtraSpins(data.extraSpins || 0);
        }
      }
    } catch (err) {
      console.error('加载失败', err);
      setError('网络连接失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSpin = async () => {
    if (!canSpin || spinning) return;

    setSpinning(true);
    setError(null);

    try {
      const res = await fetch('/api/lottery/spin', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        // 根据后端返回的 tierValue 找到对应的奖品（用于转盘动画定位）
        const prize = PRIZES.find(p => p.value === Number(data.record.tierValue));
        
        if (prize) {
          // 计算这个奖品区域的中心角度
          const centerAngle = (prize.startAngle + prize.endAngle) / 2;
          // 转盘需要停在指针指向的位置（顶部 = 0度）
          // 所以需要旋转 (360 - centerAngle) 度让中心对准顶部
          const targetAngle = 360 - centerAngle;
          // 加上多圈旋转
          const totalRotation = 360 * 8 + targetAngle;
          setRotation(prev => prev + totalRotation);

          // 动画结束后显示结果 (6秒后)
          setTimeout(() => {
            setSpinning(false);
            // 直接使用后端返回的数据，不依赖前端匹配
            setResult({ name: data.record.tierName, code: data.record.code });
            setShowResultModal(true);
            // 更新抽奖次数状态
            if (!hasSpunToday) {
              setHasSpunToday(true);
            } else if (extraSpins > 0) {
              setExtraSpins(prev => prev - 1);
            }
            // 检查是否还能继续抽
            const newDailyAvailable = hasSpunToday ? 0 : 0; // 抽完后每日次数归0
            const newExtraSpins = hasSpunToday ? extraSpins - 1 : extraSpins;
            setCanSpin(newDailyAvailable > 0 || newExtraSpins > 0);
            
            // 直接使用后端返回的记录数据
            setRecords(prev => [{
              id: data.record.id,
              tierName: data.record.tierName,
              tierValue: data.record.tierValue,
              code: data.record.code,
              createdAt: Date.now()
            }, ...prev]);
            
            // 播放庆祝彩带
            confetti({
              particleCount: 150,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#fbbf24', '#f97316', '#dc2626']
            });
          }, 6000);
        } else {
          // 后备逻辑，如果找不到奖品ID
          setSpinning(false);
          setError('系统错误：未知奖品');
        }
      } else {
        setError(data.message || '抽奖失败');
        setSpinning(false);
      }
    } catch (err) {
      console.error(err);
      setError('抽奖请求失败，请稍后重试');
      setSpinning(false);
    }
  };

  const handleCopy = () => {
    if (result?.code) {
      navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  // 生成圆锥渐变样式
  const getConicGradient = () => {
    let stops = '';
    PRIZES.forEach((prize, index) => {
      stops += `${prize.color} ${prize.startAngle}deg ${prize.endAngle}deg${index < PRIZES.length - 1 ? ', ' : ''}`;
    });
    return `conic-gradient(${stops})`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafaf9]">
        <Loader2 className="w-10 h-10 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] overflow-x-hidden">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-50 glass border-b border-white/50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-stone-800 transition-colors group">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              <span className="font-medium text-sm">首页</span>
            </Link>
            
            {user && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-white/60 rounded-full border border-white/50 shadow-sm">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-100 to-stone-100 flex items-center justify-center border border-white">
                    <UserIcon className="w-3 h-3 text-stone-500" />
                  </div>
                  <span className="font-semibold text-stone-600 text-sm hidden sm:block truncate max-w-[120px]">
                    {user.displayName}
                  </span>
                </div>
                <button onClick={handleLogout} className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8 pb-20">
        {/* 标题区 */}
        <div className="text-center mb-10 animate-fade-in">
          <div className="inline-flex items-center justify-center p-3 bg-orange-100 rounded-2xl mb-4 shadow-sm rotate-3">
            <Sparkles className="w-8 h-8 text-orange-500" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-stone-800 tracking-tight mb-2">
            每日<span className="text-gradient-primary">幸运抽奖</span>
          </h1>
          <p className="text-stone-500">
            赢取最高 20刀 兑换码福利，100% 中奖概率！
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 lg:gap-12 items-start">
          {/* 左侧：转盘区域 */}
          <div className="flex flex-col items-center">
            <div className="relative w-[320px] h-[320px] sm:w-[380px] sm:h-[380px] md:w-[420px] md:h-[420px]">
              {/* 外圈装饰 */}
              <div className="absolute inset-0 rounded-full border-8 border-white shadow-[0_20px_50px_rgba(249,115,22,0.15)] bg-white"></div>
              
              {/* 转盘主体 */}
              <div 
                className="absolute inset-2 rounded-full"
                style={{ 
                  background: getConicGradient(),
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning ? 'transform 6s cubic-bezier(0.2, 0.8, 0.3, 1)' : 'none',
                  boxShadow: 'inset 0 0 20px rgba(0,0,0,0.1)'
                }}
              >
                {/* 分割线和文字（可选，这里简化为纯色块） */}
                {PRIZES.map((prize) => (
                  <div 
                    key={prize.id}
                    className="absolute w-full h-full top-0 left-0"
                    style={{ transform: `rotate(${prize.startAngle + (prize.endAngle - prize.startAngle)/2}deg)` }}
                  >
                     {/* 奖品文字，定位到边缘 */}
                    <div className="absolute top-8 left-1/2 -translate-x-1/2 text-white font-bold text-xs sm:text-sm drop-shadow-md text-center w-20">
                      {prize.name.replace('福利', '')}
                    </div>
                  </div>
                ))}
              </div>

              {/* 中心装饰盖 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-white rounded-full shadow-lg flex items-center justify-center border-4 border-orange-50 z-10">
                <Gift className="w-8 h-8 text-orange-500" />
              </div>

              {/* 顶部指针 - 小巧精确 */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-20 filter drop-shadow-md">
                <div className="w-4 h-6 bg-stone-800 clip-path-triangle"></div>
              </div>
            </div>

            {/* 抽奖控制区 */}
            <div className="mt-10 w-full max-w-xs text-center space-y-4">
              {error && (
                <div className="flex items-center justify-center gap-2 text-red-500 text-sm bg-red-50 py-2 px-4 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
              
              {/* 抽奖次数显示 */}
              <div className="flex items-center justify-center gap-3 text-sm">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
                  hasSpunToday ? 'bg-stone-100 text-stone-400' : 'bg-green-100 text-green-700'
                }`}>
                  <span className="font-medium">每日次数:</span>
                  <span className="font-bold">{hasSpunToday ? '0' : '1'}</span>
                </div>
                {extraSpins > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full">
                    <Gift className="w-3.5 h-3.5" />
                    <span className="font-medium">额外:</span>
                    <span className="font-bold">{extraSpins}</span>
                  </div>
                )}
              </div>
              
              <button
                onClick={handleSpin}
                disabled={!canSpin || spinning}
                className={`w-full py-4 rounded-2xl text-lg font-bold text-white shadow-xl transition-all transform
                  ${canSpin && !spinning 
                    ? 'gradient-warm hover:shadow-orange-500/30 hover:-translate-y-1 active:scale-95' 
                    : 'bg-stone-300 cursor-not-allowed'}`}
              >
                {spinning ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    好运加载中...
                  </span>
                ) : canSpin ? (
                  '立即抽奖'
                ) : (
                  '今日次数已用完'
                )}
              </button>
              
              <p className="text-sm text-stone-400 font-medium">
                {canSpin 
                  ? `可抽奖 ${(hasSpunToday ? 0 : 1) + extraSpins} 次` 
                  : '明天再来试试运气吧！签到可获得额外次数'}
              </p>
            </div>
          </div>

          {/* 右侧：中奖记录 */}
          <div className="glass-card rounded-3xl p-6 sm:p-8 w-full">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-orange-100 rounded-xl text-orange-600">
                <History className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold text-stone-800">我的中奖记录</h2>
            </div>

            <div className="space-y-4 max-h-[400px] overflow-y-auto scrollbar-hide">
              {records.length === 0 ? (
                <div className="text-center py-10 text-stone-400">
                  <Trophy className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">暂无中奖记录，快去试试手气！</p>
                </div>
              ) : (
                records.map((record) => (
                  <div key={record.id} className="flex items-center justify-between p-4 bg-white/50 rounded-2xl border border-white shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center text-lg">
                        🎁
                      </div>
                      <div>
                        <div className="font-bold text-stone-700 text-sm">{record.tierName}</div>
                        <div className="text-xs text-stone-400 mt-0.5 font-mono">
                          {new Date(record.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                       <span className="text-xs font-mono bg-stone-100 text-stone-500 px-2 py-1 rounded-md">
                         {record.code.substring(0, 8)}...
                       </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 中奖弹窗 */}
      {showResultModal && result && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setShowResultModal(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 text-center animate-fade-in">
            <button 
              onClick={() => setShowResultModal(false)}
              className="absolute top-4 right-4 p-2 bg-stone-100 rounded-full hover:bg-stone-200 transition-colors"
            >
              <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <div className="w-20 h-20 bg-gradient-to-br from-orange-100 to-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-[bounce_1s_infinite]">
              <Trophy className="w-10 h-10 text-orange-500" />
            </div>

            <h3 className="text-2xl font-extrabold text-stone-800 mb-2">恭喜中奖！</h3>
            <p className="text-stone-500 mb-6">您获得 <span className="text-orange-600 font-bold text-lg">{result.name}</span></p>

            <div className="bg-stone-50 border border-orange-100 rounded-2xl p-4 mb-6 relative group">
              <p className="font-mono text-lg font-bold text-stone-800 break-all">{result.code}</p>
              <button 
                onClick={handleCopy}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-all ${
                  copied ? 'bg-emerald-100 text-emerald-600' : 'bg-white text-stone-400 shadow-sm'
                }`}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>

            <button 
              onClick={() => setShowResultModal(false)}
              className="w-full py-3.5 gradient-warm text-white rounded-xl font-bold shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30 active:scale-95 transition-all"
            >
              收下奖励
            </button>
          </div>
        </div>
      )}

      {/* 简单的CSS三角形，用于指针 */}
      <style jsx>{`
        .clip-path-triangle {
          clip-path: polygon(100% 0, 0 0, 50% 100%);
        }
      `}</style>
    </div>
  );
}
