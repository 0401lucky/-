'use client';

import { useEffect, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Brain, CircleDot, Dices, Puzzle, Star } from 'lucide-react';

interface GameStats {
  balance: number;
  dailyStats: {
    gamesPlayed: number;
    pointsEarned: number;
  } | null;
  dailyLimit: number;
  pointsLimitReached: boolean;
}

type IconType = ComponentType<{ className?: string }>;

export default function GamesPage() {
  const router = useRouter();
  const [stats, setStats] = useState<GameStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/games/pachinko/status')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStats(data.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const games = [
    {
      id: 'pachinko',
      name: '弹珠机',
      description: '控制角度和力度，让弹珠落入高分槽位！',
      icon: CircleDot as IconType,
      color: 'from-purple-600 to-pink-600',
      href: '/games/pachinko',
      available: true,
    },
    {
      id: 'slot',
      name: '老虎机',
      description: '经典三轴老虎机，转动幸运符号！',
      icon: Dices as IconType,
      color: 'from-yellow-600 to-orange-600',
      href: '/games/slot',
      available: true,
    },
    {
      id: 'memory',
      name: '记忆卡片',
      description: '翻开卡片，找到所有配对，步数越少分越高！',
      icon: Brain as IconType,
      color: 'from-teal-500 to-cyan-500',
      href: '/games/memory',
      available: true,
    },
    {
      id: 'match3',
      name: '消消乐',
      description: '交换相邻方块，凑 3 个及以上即可消除得分！',
      icon: Puzzle as IconType,
      color: 'from-indigo-600 to-violet-600',
      href: '/games/match3',
      available: true,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-12">
          <button
            onClick={() => router.push('/')}
            className="group flex items-center text-slate-500 hover:text-slate-800 transition-colors font-medium"
          >
            <span className="mr-2 group-hover:-translate-x-1 transition-transform">←</span>
            首页
          </button>
          
          <div className="flex items-center gap-2">
             <Link 
              href="/store"
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm border border-slate-200 text-slate-700 hover:border-yellow-400 hover:text-yellow-600 transition-all group"
            >
              <Star className="w-4 h-4 text-yellow-500" />
              <span className="font-bold">{loading ? '...' : stats?.balance || 0}</span>
              <span className="text-slate-300 group-hover:text-yellow-400 transition-colors">→</span>
            </Link>
          </div>
        </div>

        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">
            游戏中心
          </h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            挑战小游戏赢取积分，兑换丰富奖励。
          </p>
        </div>

        {/* 积分信息卡片 */}
        <div className="bg-white rounded-2xl p-8 mb-12 shadow-sm border border-slate-100 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-bl-full -z-0 opacity-50"></div>
          
          <div className="relative z-10 flex flex-col sm:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-3xl shadow-lg shadow-orange-200 text-white">
                <Star className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-slate-500 font-medium mb-1">当前可用积分</h2>
                <p className="text-4xl font-extrabold text-slate-900 tracking-tight">
                  {loading ? '...' : stats?.balance || 0}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-8 sm:border-l sm:border-slate-100 sm:pl-8">
              <div className="text-center sm:text-left">
                <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">今日游戏</div>
                <div className="text-slate-900 font-bold text-xl">
                  {stats?.dailyStats?.gamesPlayed || 0} <span className="text-sm font-normal text-slate-500">局</span>
                </div>
              </div>
              <div className="text-center sm:text-left">
                <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">今日积分</div>
                <div className={`font-bold text-xl ${stats?.pointsLimitReached ? 'text-orange-500' : 'text-green-600'}`}>
                  {stats?.dailyStats?.pointsEarned || 0} <span className="text-slate-300">/</span> <span className="text-sm font-normal text-slate-500">{stats?.dailyLimit ?? 2000}</span>
                  {stats?.pointsLimitReached && (
                    <span className="ml-2 text-xs text-orange-500 font-medium">已达上限</span>
                  )}
                </div>
              </div>
            </div>

            <Link
              href="/store"
              className="px-8 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all shadow-lg shadow-slate-200 hover:shadow-xl hover:-translate-y-0.5 flex items-center gap-2"
            >
              兑换商店
              <span>→</span>
            </Link>
          </div>
        </div>

        {/* 游戏列表 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {games.map((game) => {
            const Icon = game.icon;
            return (
              <div
                key={game.id}
                className={`group relative bg-white rounded-3xl overflow-hidden transition-all duration-300 border border-slate-100 ${
                  game.available 
                    ? 'hover:shadow-2xl hover:shadow-slate-200/50 cursor-pointer hover:-translate-y-1' 
                    : 'opacity-70 grayscale-[0.5]'
                }`}
                onClick={() => game.available && router.push(game.href)}
              >
                {/* 游戏图标区域 */}
                <div className={`h-48 flex items-center justify-center bg-gradient-to-br ${game.color} relative overflow-hidden`}>
                  <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <Icon className="w-20 h-20 text-white transform group-hover:scale-110 transition-transform duration-300 drop-shadow-md" />
                </div>
                
                {/* 游戏信息 */}
                <div className="p-6">
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{game.name}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{game.description}</p>
                  
                  <div className="mt-4 flex items-center text-sm font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity transform translate-y-2 group-hover:translate-y-0">
                    {game.available ? '开始游戏 →' : '敬请期待'}
                  </div>
                </div>

                {/* 不可用标签 */}
                {!game.available && (
                  <div className="absolute top-4 right-4 bg-slate-900/10 backdrop-blur-sm text-slate-900 text-xs font-bold px-3 py-1.5 rounded-full border border-slate-200/20">
                    COMING SOON
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 规则说明 */}
        <div className="mt-16 border-t border-slate-200 pt-12">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-6">积分规则说明</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
               <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 mb-3 text-sm font-bold">1</div>
               <p className="text-slate-600 text-sm">每日可通过游戏获得最多 <span className="font-bold text-slate-900">动态上限</span> 积分</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
               <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-600 mb-3 text-sm font-bold">2</div>
               <p className="text-slate-600 text-sm"><span className="font-bold text-slate-900">600</span> 积分可兑换 1 次抽奖机会</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
               <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 mb-3 text-sm font-bold">3</div>
               <p className="text-slate-600 text-sm"><span className="font-bold text-slate-900">1500</span> 积分可兑换 2 次抽奖机会</p>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm">
               <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mb-3 text-sm font-bold">4</div>
               <p className="text-slate-600 text-sm">积分每日零点（北京时间）刷新限额</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
