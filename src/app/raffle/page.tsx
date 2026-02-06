'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Gift, Loader2, Users, Trophy, Clock, ChevronRight,
  User as UserIcon, LogOut, Sparkles, Calendar
} from 'lucide-react';

interface RafflePrize {
  id: string;
  name: string;
  dollars: number;
  quantity: number;
}

interface RaffleItem {
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
  createdAt: number;
}

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

export default function RaffleListPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [raffles, setRaffles] = useState<RaffleItem[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // 获取用户信息
        const userRes = await fetch('/api/auth/me');
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData.success) {
            setUser(userData.user);
          }
        }

        // 获取活动列表
        const rafflesRes = await fetch('/api/raffle');
        if (rafflesRes.ok) {
          const data = await rafflesRes.json();
          if (data.success) {
            setRaffles(data.raffles || []);
          }
        }
      } catch (error) {
        console.error('加载失败:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  const activeRaffles = raffles.filter(r => r.status === 'active');
  const endedRaffles = raffles.filter(r => r.status === 'ended');

  const getTotalPrizeValue = (prizes: RafflePrize[]) => {
    return prizes.reduce((sum, p) => sum + p.dollars * p.quantity, 0);
  };

  const getTotalPrizeCount = (prizes: RafflePrize[]) => {
    return prizes.reduce((sum, p) => sum + p.quantity, 0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-pink-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在加载活动...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf8] overflow-x-hidden pb-20">
      {/* 导航栏 */}
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-pink-600 transition-colors group">
              <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-pink-200 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-medium text-sm">返回首页</span>
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
                href="/login?redirect=/raffle"
                className="px-6 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl transition-all"
              >
                登录参与
              </Link>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 标题区 */}
        <div className="text-center mb-12 animate-fade-in relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[100px] bg-pink-300/20 blur-[60px] -z-10"></div>
          <div className="inline-flex items-center justify-center p-3 bg-gradient-to-br from-pink-100 to-purple-50 rounded-2xl mb-4 shadow-sm rotate-3 border border-pink-100">
            <Gift className="w-8 h-8 text-pink-500 fill-pink-500" />
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-stone-700 tracking-tight mb-4">
            多人<span className="text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500">抽奖</span>
          </h1>
          <p className="text-lg text-stone-500 max-w-lg mx-auto font-medium">
            免费参与，人满自动开奖，奖品<span className="text-pink-600 font-bold">直充到账</span>
          </p>
        </div>

        {/* 进行中的活动 */}
        {activeRaffles.length > 0 && (
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-green-100 rounded-xl">
                <Sparkles className="w-5 h-5 text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-stone-700">进行中</h2>
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                {activeRaffles.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeRaffles.map((raffle) => (
                <Link
                  key={raffle.id}
                  href={`/raffle/${raffle.id}`}
                  className="group glass-card rounded-3xl p-6 hover:shadow-xl hover:shadow-pink-500/10 transition-all duration-300 hover:-translate-y-1 border border-white/60 overflow-hidden relative"
                >
                  {/* 背景装饰 */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-pink-50 to-transparent rounded-bl-full -z-10 group-hover:from-pink-100 transition-colors"></div>

                  {/* 封面 */}
                  {raffle.coverImage && (
                    <div className="relative w-full h-32 rounded-2xl mb-4 overflow-hidden bg-stone-100">
                      <Image src={raffle.coverImage} alt={raffle.title} fill className="object-cover" unoptimized />
                    </div>
                  )}

                  {/* 标题 */}
                  <h3 className="text-xl font-bold text-stone-800 mb-2 group-hover:text-pink-600 transition-colors line-clamp-1">
                    {raffle.title}
                  </h3>

                  {/* 描述 */}
                  <p className="text-sm text-stone-500 mb-4 line-clamp-2">{raffle.description}</p>

                  {/* 奖品信息 */}
                  <div className="flex items-center gap-4 mb-4 text-sm">
                    <div className="flex items-center gap-1 text-pink-600">
                      <Trophy className="w-4 h-4" />
                      <span className="font-bold">${getTotalPrizeValue(raffle.prizes)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-stone-500">
                      <Gift className="w-4 h-4" />
                      <span>{getTotalPrizeCount(raffle.prizes)} 份奖品</span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  {raffle.triggerType === 'threshold' && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-stone-500">参与进度</span>
                        <span className="font-bold text-pink-600">
                          {raffle.participantsCount}/{raffle.threshold}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-pink-400 to-purple-400 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(100, (raffle.participantsCount / raffle.threshold) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 底部信息 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-stone-400 text-xs">
                      <Users className="w-3 h-3" />
                      <span>{raffle.participantsCount} 人参与</span>
                    </div>
                    <div className="flex items-center gap-1 text-pink-500 font-bold text-sm group-hover:gap-2 transition-all">
                      <span>参与抽奖</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 已结束的活动 */}
        {endedRaffles.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-stone-100 rounded-xl">
                <Clock className="w-5 h-5 text-stone-500" />
              </div>
              <h2 className="text-xl font-bold text-stone-700">已结束</h2>
              <span className="px-2 py-0.5 bg-stone-100 text-stone-500 text-xs font-bold rounded-full">
                {endedRaffles.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {endedRaffles.map((raffle) => (
                <Link
                  key={raffle.id}
                  href={`/raffle/${raffle.id}`}
                  className="group glass-card rounded-3xl p-6 hover:shadow-lg transition-all duration-300 border border-white/60 overflow-hidden relative opacity-80 hover:opacity-100"
                >
                  {/* 已结束标签 */}
                  <div className="absolute top-4 right-4 px-2 py-1 bg-stone-100 text-stone-500 text-xs font-bold rounded-full">
                    已开奖
                  </div>

                  {/* 标题 */}
                  <h3 className="text-lg font-bold text-stone-700 mb-2 line-clamp-1 pr-16">
                    {raffle.title}
                  </h3>

                  {/* 描述 */}
                  <p className="text-sm text-stone-400 mb-4 line-clamp-2">{raffle.description}</p>

                  {/* 中奖信息 */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1 text-stone-500">
                      <Users className="w-4 h-4" />
                      <span>{raffle.participantsCount} 人参与</span>
                    </div>
                    <div className="flex items-center gap-1 text-pink-500">
                      <Trophy className="w-4 h-4" />
                      <span>{raffle.winnersCount} 人中奖</span>
                    </div>
                  </div>

                  {/* 开奖时间 */}
                  {raffle.drawnAt && (
                    <div className="mt-4 pt-4 border-t border-stone-100 flex items-center gap-1 text-xs text-stone-400">
                      <Calendar className="w-3 h-3" />
                      <span>开奖于 {new Date(raffle.drawnAt).toLocaleDateString()}</span>
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 无活动提示 */}
        {raffles.length === 0 && (
          <div className="text-center py-20">
            <div className="w-24 h-24 mx-auto mb-6 bg-stone-100 rounded-full flex items-center justify-center">
              <Gift className="w-12 h-12 text-stone-300" />
            </div>
            <h3 className="text-xl font-bold text-stone-500 mb-2">暂无抽奖活动</h3>
            <p className="text-stone-400">敬请期待更多精彩活动</p>
          </div>
        )}
      </main>
    </div>
  );
}
