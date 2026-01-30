'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, BookOpen, Gift, ChevronRight } from 'lucide-react';
import { ALBUMS, getCardsByAlbum } from '@/lib/cards/config';
import { UserCards } from '@/lib/cards/draw';

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

export default function CardsAlbumsPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState<UserCards | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        // 1. Check Auth
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          router.push('/login?redirect=/cards');
          return;
        }
        const authData = await authRes.json();
        if (!authData.success) {
          router.push('/login?redirect=/cards');
          return;
        }
        setUser(authData.user);

        // 2. Fetch Inventory
        const cardsRes = await fetch('/api/cards/inventory');
        if (cardsRes.ok) {
          const cardsData = await cardsRes.json();
          if (cardsData.success) {
            setCardData(cardsData.data);
          }
        }
      } catch (err) {
        console.error('Failed to load inventory', err);
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [router]);

  const getAlbumProgress = (albumId: string) => {
    if (!cardData) return { owned: 0, total: 0, percent: 0 };
    const albumCards = getCardsByAlbum(albumId);
    const owned = albumCards.filter(c => cardData.inventory.includes(c.id)).length;
    const total = albumCards.length;
    return { owned, total, percent: Math.round((owned / total) * 100) };
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在读取卡册...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf8] pb-20">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <div className="flex items-center gap-4">
              <Link href="/" className="flex items-center gap-2 text-stone-500 hover:text-orange-600 transition-colors group">
                <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-orange-200 transition-colors">
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                </div>
                <span className="font-medium text-sm hidden sm:inline">返回首页</span>
              </Link>
              <div className="h-6 w-px bg-stone-200 mx-2 hidden sm:block"></div>
              <h1 className="text-lg font-bold text-stone-700 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-orange-500" />
                卡牌图鉴
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/cards/draw"
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-full text-sm font-bold shadow-lg shadow-orange-500/30 hover:shadow-orange-500/40 hover:-translate-y-0.5 transition-all active:scale-95"
              >
                <Gift className="w-4 h-4" />
                <span className="hidden sm:inline">去抽卡</span>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Header Section */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900 to-slate-900 text-white shadow-xl p-8 sm:p-12 mb-8">
          {/* Background Decorative */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4"></div>
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/20 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4"></div>

          <div className="relative z-10">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white mb-4">
              我的卡册收藏
            </h2>
            <p className="text-slate-300 text-lg max-w-lg">
              探索各种主题卡册，收集卡牌解锁专属奖励。每套卡册都有独特的故事等你发现。
            </p>
            {cardData && (
              <div className="mt-6 flex items-center gap-4 text-sm">
                <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-xl border border-white/10">
                  <span className="text-slate-400">碎片</span>
                  <span className="ml-2 text-xl font-black text-amber-400">{cardData.fragments}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Albums Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {ALBUMS.map((album) => {
            const { owned, total, percent } = getAlbumProgress(album.id);
            const isComplete = percent === 100;

            return (
              <Link
                key={album.id}
                href={`/cards/${album.id}`}
                className={`
                  group relative bg-white rounded-3xl overflow-hidden shadow-sm border transition-all duration-300
                  hover:shadow-xl hover:-translate-y-1
                  ${isComplete ? 'border-green-200 ring-2 ring-green-400 ring-offset-2' : 'border-slate-100'}
                `}
              >
                {/* Cover Image */}
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-indigo-100 to-purple-100">
                  <img
                    src={album.coverImage}
                    alt={album.name}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>

                  {/* Season Badge */}
                  {album.season && (
                    <div className="absolute top-4 left-4 px-3 py-1 bg-white/90 backdrop-blur-sm rounded-full text-xs font-bold text-indigo-600 shadow-sm">
                      {album.season}
                    </div>
                  )}

                  {/* Complete Badge */}
                  {isComplete && (
                    <div className="absolute top-4 right-4 px-3 py-1 bg-green-500 rounded-full text-xs font-bold text-white shadow-lg">
                      ✓ 已完成
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-slate-800 mb-1">{album.name}</h3>
                      <p className="text-sm text-slate-500">{album.description}</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-orange-500 group-hover:translate-x-1 transition-all" />
                  </div>

                  {/* Progress */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-slate-500">收集进度</span>
                      <span className="text-slate-700">{owned} / {total}</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${isComplete ? 'bg-green-500' : 'bg-gradient-to-r from-orange-400 to-red-500'}`}
                        style={{ width: `${percent}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Reward Preview */}
                  <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <span className="text-sm font-medium text-amber-700">完成奖励</span>
                    <span className="text-lg font-black text-amber-600">{album.reward.toLocaleString()} 积分</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Empty State */}
        {ALBUMS.length === 0 && (
          <div className="py-20 text-center text-slate-400 bg-white rounded-3xl border border-slate-100 border-dashed">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p>暂无可用卡册</p>
          </div>
        )}
      </main>
    </div>
  );
}
