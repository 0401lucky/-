'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, BookOpen, Gift, Trophy } from 'lucide-react';
import { ALBUMS, getCardsByAlbum, getAlbumById } from '@/lib/cards/config';
import { CardGrid } from '@/components/cards/CardGrid';
import { RewardsSection } from '@/components/cards/RewardsSection';
import { UserCards } from '@/lib/cards/draw';

interface UserData {
  id: number;
  username: string;
  displayName: string;
}

export default function AlbumDetailPage() {
  const router = useRouter();
  const params = useParams();
  const albumId = params.albumId as string;

  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState<UserCards | null>(null);

  const album = getAlbumById(albumId);
  const albumCards = album ? getCardsByAlbum(albumId) : [];

  useEffect(() => {
    const init = async () => {
      try {
        // Check if album exists
        if (!album) {
          router.push('/cards');
          return;
        }

        // 1. Check Auth
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          router.push('/login?redirect=/cards/' + albumId);
          return;
        }
        const authData = await authRes.json();
        if (!authData.success) {
          router.push('/login?redirect=/cards/' + albumId);
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
  }, [router, albumId, album]);

  const handleClaimReward = async (type: string, albumId: string) => {
    try {
      const res = await fetch('/api/cards/claim-reward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardType: type, albumId }),
      });
      const data = await res.json();

      if (data.success) {
        // Refresh data
        const cardsRes = await fetch('/api/cards/inventory');
        if (cardsRes.ok) {
          const cardsData = await cardsRes.json();
          if (cardsData.success) {
            setCardData(cardsData.data);
          }
        }
        alert('领取成功！积分已发放');
      } else {
        alert(data.message || '领取失败');
      }
    } catch (err) {
      console.error('Failed to claim reward', err);
      alert('领取出错，请重试');
    }
  };

  const handleExchange = async (cardId: string) => {
    try {
      const res = await fetch('/api/cards/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      });
      const data = await res.json();

      if (data.success) {
        // Refresh data
        const cardsRes = await fetch('/api/cards/inventory');
        if (cardsRes.ok) {
          const cardsData = await cardsRes.json();
          if (cardsData.success) {
            setCardData(cardsData.data);
          }
        }
        alert('兑换成功！');
      } else {
        alert(data.error || '兑换失败');
      }
    } catch (err) {
      console.error('Failed to exchange card', err);
      alert('兑换出错，请重试');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
        <p className="text-stone-400 font-medium animate-pulse">正在读取图鉴...</p>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8] gap-4">
        <BookOpen className="w-12 h-12 text-stone-300" />
        <p className="text-stone-400 font-medium">卡册不存在</p>
        <Link href="/cards" className="text-orange-500 hover:text-orange-600 font-medium">
          返回卡册列表
        </Link>
      </div>
    );
  }

  const ownedInAlbum = albumCards.filter(c => cardData?.inventory.includes(c.id)).length;

  return (
    <div className="min-h-screen bg-[#fdfcf8] pb-20">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <div className="flex items-center gap-4">
              <Link href="/cards" className="flex items-center gap-2 text-stone-500 hover:text-orange-600 transition-colors group">
                <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-orange-200 transition-colors">
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                </div>
                <span className="font-medium text-sm hidden sm:inline">返回卡册</span>
              </Link>
              <div className="h-6 w-px bg-stone-200 mx-2 hidden sm:block"></div>
              <h1 className="text-lg font-bold text-stone-700 flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-orange-500" />
                {album.name}
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
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Header Section */}
        <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-indigo-900 to-slate-900 text-white shadow-xl p-8 sm:p-12">
          {/* Background Decorative */}
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-orange-500/20 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4"></div>
          <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/20 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4"></div>

          <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-4 max-w-2xl">
              {album.season && (
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-bold text-orange-200 border border-white/10">
                  <Trophy className="w-3 h-3" />
                  {album.season}
                </div>
              )}
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
                {album.name}
              </h2>
              <p className="text-slate-300 text-lg max-w-lg">
                {album.description}
              </p>
            </div>

            {/* Stats Overview */}
            {cardData && (
              <div className="flex gap-4 sm:gap-8 bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                <div className="text-center">
                  <div className="text-sm text-slate-400 font-bold uppercase tracking-wider mb-1">已收集</div>
                  <div className="text-3xl font-black text-white">
                    {ownedInAlbum}
                    <span className="text-lg text-slate-500 font-medium ml-1">/ {albumCards.length}</span>
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
        <div className="space-y-8 animate-fade-in-up">
          {cardData && (
            <RewardsSection
              albumId={albumId}
              inventory={cardData.inventory}
              claimedRewards={cardData.collectionRewards}
              onClaim={handleClaimReward}
            />
          )}

          <CardGrid
            cards={albumCards}
            inventory={cardData?.inventory || []}
            fragments={cardData?.fragments || 0}
            onExchange={handleExchange}
          />
        </div>
      </main>
    </div>
  );
}
