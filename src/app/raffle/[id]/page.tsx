'use client';

import { useCallback, useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Gift, Loader2, Users, Trophy, Check, Clock,
  User as UserIcon, LogOut, Sparkles, Crown, Star, PartyPopper
} from 'lucide-react';

interface RafflePrize {
  id: string;
  name: string;
  dollars: number;
  quantity: number;
}

interface RaffleWinner {
  entryId: string;
  userId: number;
  username: string;
  prizeId: string;
  prizeName: string;
  dollars: number;
  rewardStatus: 'pending' | 'delivered' | 'failed';
}

interface RaffleEntry {
  id: string;
  raffleId: string;
  userId: number;
  username: string;
  entryNumber: number;
  createdAt: number;
}

interface Raffle {
  id: string;
  title: string;
  description: string;
  coverImage?: string;
  prizes: RafflePrize[];
  triggerType: 'threshold' | 'manual';
  threshold: number;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  participantsCount: number;
  winnersCount: number;
  drawnAt?: number;
  winners?: RaffleWinner[];
  createdAt: number;
}

interface UserStatus {
  hasJoined: boolean;
  entry?: RaffleEntry;
  isWinner: boolean;
  prize?: RaffleWinner;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

export default function RaffleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [raffle, setRaffle] = useState<Raffle | null>(null);
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [userStatus, setUserStatus] = useState<UserStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // 获取用户信息
      const userRes = await fetch('/api/auth/me');
      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.success) {
          setUser(userData.user);
        }
      }

      // 获取活动详情
      const raffleRes = await fetch(`/api/raffle/${id}`);
      if (raffleRes.ok) {
        const data = await raffleRes.json();
        if (data.success) {
          setRaffle(data.raffle);
          setEntries(data.entries || []);
          setUserStatus(data.userStatus);

          // 如果用户中奖，显示庆祝动画
          if (data.userStatus?.isWinner) {
            setShowConfetti(true);
          }
        } else {
          setError(data.message || '活动不存在');
        }
      } else {
        setError('活动不存在');
      }
    } catch (err) {
      console.error('加载失败:', err);
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 加载庆祝动画
  useEffect(() => {
    if (showConfetti) {
      import('canvas-confetti').then(({ default: confetti }) => {
        const duration = 3000;
        const end = Date.now() + duration;

        const frame = () => {
          confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#ec4899', '#8b5cf6', '#fbbf24'],
          });
          confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#ec4899', '#8b5cf6', '#fbbf24'],
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        };
        frame();
      });
    }
  }, [showConfetti]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const handleJoin = async () => {
    if (!user) {
      router.push(`/login?redirect=/raffle/${id}`);
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const res = await fetch(`/api/raffle/${id}/join`, { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        // 刷新数据
        await fetchData();
      } else {
        setError(data.message || '参与失败');
      }
    } catch (err) {
      console.error('参与失败:', err);
      setError('参与失败，请稍后重试');
    } finally {
      setJoining(false);
    }
  };

  const getTotalPrizeValue = (prizes: RafflePrize[]) => {
    return prizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-pink-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在加载...</p>
      </div>
    );
  }

  if (error && !raffle) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Gift className="w-16 h-16 text-stone-300" />
        <p className="text-stone-500 font-medium">{error}</p>
        <Link href="/raffle" className="text-pink-500 hover:underline">
          返回活动列表
        </Link>
      </div>
    );
  }

  if (!raffle) return null;

  const progressPercent = raffle.triggerType === 'threshold'
    ? Math.min(100, (raffle.participantsCount / raffle.threshold) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#fdfcf8] overflow-x-hidden pb-20">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/raffle" className="flex items-center gap-2 text-stone-500 hover:text-pink-600 transition-colors group">
              <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-pink-200 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-medium text-sm">返回列表</span>
            </Link>

            {user ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-1.5 py-1.5 pr-4 bg-white/60 rounded-full border border-white/60 shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white shadow-inner">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-stone-700 text-xs">{user.displayName}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="p-2.5 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                  title="退出登录"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Link
                href={`/login?redirect=/raffle/${id}`}
                className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all"
              >
                登录参与
              </Link>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* 活动状态标签 */}
        <div className="flex items-center gap-3 mb-6">
          {raffle.status === 'active' && (
            <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full flex items-center gap-1">
              <Sparkles className="w-4 h-4" />
              进行中
            </span>
          )}
          {raffle.status === 'ended' && (
            <span className="px-3 py-1 bg-stone-100 text-stone-600 text-sm font-bold rounded-full flex items-center gap-1">
              <Clock className="w-4 h-4" />
              已开奖
            </span>
          )}
          {raffle.triggerType === 'threshold' && raffle.status === 'active' && (
            <span className="px-3 py-1 bg-pink-50 text-pink-600 text-sm font-medium rounded-full">
              满 {raffle.threshold} 人开奖
            </span>
          )}
          {raffle.triggerType === 'manual' && raffle.status === 'active' && (
            <span className="px-3 py-1 bg-purple-50 text-purple-600 text-sm font-medium rounded-full">
              手动开奖
            </span>
          )}
        </div>

        {/* 活动标题 */}
        <h1 className="text-3xl sm:text-4xl font-black text-stone-800 mb-4">{raffle.title}</h1>

        {/* 活动描述 */}
        <p className="text-stone-500 mb-8 leading-relaxed">{raffle.description}</p>

        {/* 用户中奖提示 */}
        {userStatus?.isWinner && userStatus.prize && (
          <div className="mb-8 p-6 bg-gradient-to-r from-pink-50 to-purple-50 rounded-3xl border-2 border-pink-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-pink-100 to-transparent rounded-bl-full"></div>
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-pink-100 rounded-xl">
                  <PartyPopper className="w-6 h-6 text-pink-600" />
                </div>
                <h3 className="text-xl font-bold text-pink-700">恭喜中奖！</h3>
              </div>
              <p className="text-stone-600 mb-4">
                您获得了 <span className="font-bold text-pink-600">{userStatus.prize.prizeName}</span>
              </p>
              <div className="flex items-center gap-4">
                <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">
                  ${userStatus.prize.dollars}
                </span>
                {userStatus.prize.rewardStatus === 'delivered' && (
                  <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-bold rounded-full flex items-center gap-1">
                    <Check className="w-4 h-4" />
                    已充值到账
                  </span>
                )}
                {userStatus.prize.rewardStatus === 'pending' && (
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-700 text-sm font-bold rounded-full">
                    发放中...
                  </span>
                )}
                {userStatus.prize.rewardStatus === 'failed' && (
                  <span className="px-3 py-1 bg-red-100 text-red-700 text-sm font-bold rounded-full">
                    发放失败
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 奖品列表 */}
        <div className="glass-card rounded-3xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-pink-100 rounded-xl">
              <Trophy className="w-5 h-5 text-pink-600" />
            </div>
            <h2 className="text-lg font-bold text-stone-700">奖品池</h2>
            <span className="ml-auto text-sm font-bold text-pink-600">
              总价值 ${getTotalPrizeValue(raffle.prizes)}
            </span>
          </div>

          <div className="grid gap-4">
            {raffle.prizes.map((prize, index) => (
              <div
                key={prize.id}
                className={`flex items-center gap-4 p-4 rounded-2xl ${
                  index === 0 ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-200' :
                  index === 1 ? 'bg-gradient-to-r from-stone-50 to-gray-50 border border-stone-200' :
                  index === 2 ? 'bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200' :
                  'bg-white border border-stone-100'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                  index === 0 ? 'bg-yellow-400 text-white' :
                  index === 1 ? 'bg-stone-400 text-white' :
                  index === 2 ? 'bg-orange-400 text-white' :
                  'bg-stone-200 text-stone-600'
                }`}>
                  {index === 0 ? <Crown className="w-5 h-5" /> :
                   index === 1 ? <Star className="w-5 h-5" /> :
                   index === 2 ? <Trophy className="w-5 h-5" /> :
                   index + 1}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-stone-800">{prize.name}</div>
                  <div className="text-sm text-stone-500">{prize.quantity} 名中奖者</div>
                </div>
                <div className="text-xl font-black text-pink-600">${prize.dollars}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 参与进度 */}
        {raffle.status === 'active' && raffle.triggerType === 'threshold' && (
          <div className="glass-card rounded-3xl p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-xl">
                  <Users className="w-5 h-5 text-purple-600" />
                </div>
                <h2 className="text-lg font-bold text-stone-700">参与进度</h2>
              </div>
              <span className="text-2xl font-black text-purple-600">
                {raffle.participantsCount}/{raffle.threshold}
              </span>
            </div>

            <div className="w-full h-4 bg-stone-100 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-pink-400 to-purple-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="text-sm text-stone-500">
              还差 <span className="font-bold text-pink-600">{Math.max(0, raffle.threshold - raffle.participantsCount)}</span> 人即可开奖
            </p>
          </div>
        )}

        {/* 参与按钮 */}
        {raffle.status === 'active' && (
          <div className="mb-8">
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 text-sm">
                {error}
              </div>
            )}

            {userStatus?.hasJoined ? (
              <div className="text-center p-6 bg-green-50 border-2 border-green-200 rounded-3xl">
                <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-green-700 mb-2">已参与</h3>
                <p className="text-stone-500">
                  您的抽奖号码：<span className="font-bold text-green-600">#{userStatus.entry?.entryNumber}</span>
                </p>
                <p className="text-sm text-stone-400 mt-2">等待开奖，祝您好运！</p>
              </div>
            ) : (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full py-5 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-2xl text-xl font-bold shadow-xl shadow-pink-500/20 hover:shadow-pink-500/30 hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              >
                {joining ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    参与中...
                  </>
                ) : (
                  <>
                    <Gift className="w-6 h-6" />
                    免费参与抽奖
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* 中奖者列表（已结束时显示） */}
        {raffle.status === 'ended' && raffle.winners && raffle.winners.length > 0 && (
          <div className="glass-card rounded-3xl p-6 mb-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-yellow-100 rounded-xl">
                <Crown className="w-5 h-5 text-yellow-600" />
              </div>
              <h2 className="text-lg font-bold text-stone-700">中奖名单</h2>
              <span className="px-2 py-0.5 bg-pink-100 text-pink-600 text-xs font-bold rounded-full">
                {raffle.winners.length} 人中奖
              </span>
            </div>

            <div className="space-y-3">
              {raffle.winners.map((winner, index) => (
                <div
                  key={winner.entryId}
                  className={`flex items-center gap-4 p-4 rounded-2xl ${
                    winner.userId === user?.id
                      ? 'bg-gradient-to-r from-pink-50 to-purple-50 border-2 border-pink-200'
                      : 'bg-white border border-stone-100'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    index === 0 ? 'bg-yellow-400 text-white' :
                    index === 1 ? 'bg-stone-400 text-white' :
                    index === 2 ? 'bg-orange-400 text-white' :
                    'bg-stone-200 text-stone-600'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-stone-800 flex items-center gap-2">
                      {winner.username}
                      {winner.userId === user?.id && (
                        <span className="px-2 py-0.5 bg-pink-100 text-pink-600 text-xs font-bold rounded-full">
                          我
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-stone-500">{winner.prizeName}</div>
                  </div>
                  <div className="text-lg font-bold text-pink-600">${winner.dollars}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 参与者列表 */}
        <div className="glass-card rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 rounded-xl">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-lg font-bold text-stone-700">参与者</h2>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-xs font-bold rounded-full">
              {raffle.participantsCount}
            </span>
          </div>

          {entries.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>暂无参与者</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`p-3 rounded-xl text-center ${
                    entry.userId === user?.id
                      ? 'bg-pink-50 border border-pink-200'
                      : 'bg-stone-50'
                  }`}
                >
                  <div className="text-sm font-bold text-stone-700 truncate">{entry.username}</div>
                  <div className="text-xs text-stone-400">#{entry.entryNumber}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
