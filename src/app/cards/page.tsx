'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, BookOpen, Gift, Trophy } from 'lucide-react';
import { CARDS } from '@/lib/cards/config';
import { CardGrid } from '@/components/cards/CardGrid';
import { UserCards } from '@/lib/cards/draw';

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

export default function CardsInventoryPage() {
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

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在读取图鉴...</p>
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
                href="/lottery"
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
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Header Section */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900 to-slate-900 text-white shadow-xl p-8 sm:p-12">
          {/* Background Decorative */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4"></div>
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/20 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4"></div>
          
          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-4 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-bold text-orange-200 border border-white/10">
                <Trophy className="w-3 h-3" />
                COLLECTION SEASON 1
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
                探索你的<br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-200 to-amber-100">
                  动物伙伴图鉴
                </span>
              </h2>
              <p className="text-slate-300 text-lg max-w-lg">
                收集稀有动物卡牌，解锁图鉴奖励。每一张卡牌都承载着独特的价值与故事。
              </p>
            </div>

            {/* Stats Overview */}
            {cardData && (
              <div className="flex gap-4 sm:gap-8 bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                <div className="text-center">
                  <div className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">已收集</div>
                  <div className="text-3xl font-black text-white">
                    {new Set(cardData.inventory).size}
                    <span className="text-lg text-slate-500 font-medium ml-1">/ {CARDS.length}</span>
                  </div>
                </div>
                <div className="w-px bg-white/10"></div>
                <div className="text-center">
                   <div className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">碎片</div>
                   <div className="text-3xl font-black text-amber-400">
                     {cardData.fragments}
                   </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Card Grid */}
        <div className="animate-fade-in-up">
          <CardGrid 
            cards={CARDS} 
            inventory={cardData?.inventory || []} 
          />
        </div>
      </main>
    </div>
  );
}
