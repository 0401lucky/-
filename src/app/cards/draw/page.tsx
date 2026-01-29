'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Sparkles, CreditCard, RotateCcw } from 'lucide-react';
import { UserCards } from '@/lib/cards/draw';
import { CardConfig } from '@/lib/cards/types';

interface DrawResponse {
  success: boolean;
  data: {
    success: boolean;
    card?: CardConfig;
    message?: string;
    isDuplicate?: boolean;
    fragmentsAdded?: number;
  };
}

export default function DrawPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [cardData, setCardData] = useState<UserCards | null>(null);
  const [result, setResult] = useState<DrawResponse['data'] | null>(null);
  const [showResult, setShowResult] = useState(false);

  const fetchInventory = async () => {
    try {
      const res = await fetch('/api/cards/inventory');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCardData(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load inventory', err);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const authRes = await fetch('/api/auth/me');
        if (!authRes.ok) {
          router.push('/login?redirect=/cards/draw');
          return;
        }
        await fetchInventory();
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, [router]);

  const handleDraw = async () => {
    if (drawing || !cardData || cardData.drawsAvailable <= 0) return;

    setDrawing(true);
    setShowResult(false);
    setResult(null);

    try {
      // Simulate animation delay
      await new Promise(resolve => setTimeout(resolve, 800));

      const res = await fetch('/api/cards/draw', {
        method: 'POST',
      });
      
      const data: DrawResponse = await res.json();
      
      if (data.success && data.data.success) {
        setResult(data.data);
        setShowResult(true);
        // Refresh inventory to update draw count
        await fetchInventory();
      } else {
        alert(data.data.message || '抽卡失败，请重试');
      }
    } catch (err) {
      console.error('Draw failed', err);
      alert('网络错误，请稍后重试');
    } finally {
      setDrawing(false);
    }
  };

  const getRarityColor = (rarity?: string) => {
    switch (rarity) {
      case 'legendary_rare': return 'text-red-600 drop-shadow-md';
      case 'legendary': return 'text-orange-500 drop-shadow-md';
      case 'epic': return 'text-purple-600';
      case 'rare': return 'text-blue-500';
      case 'common': return 'text-stone-500';
      default: return 'text-stone-500';
    }
  };

  const getRarityBg = (rarity?: string) => {
    switch (rarity) {
      case 'legendary_rare': return 'bg-red-50 border-red-200 shadow-red-100';
      case 'legendary': return 'bg-orange-50 border-orange-200 shadow-orange-100';
      case 'epic': return 'bg-purple-50 border-purple-200 shadow-purple-100';
      case 'rare': return 'bg-blue-50 border-blue-200 shadow-blue-100';
      case 'common': return 'bg-stone-50 border-stone-200 shadow-stone-100';
      default: return 'bg-stone-50 border-stone-200';
    }
  };

  const getRarityLabel = (rarity?: string) => {
    switch (rarity) {
      case 'legendary_rare': return '传说稀有';
      case 'legendary': return '传说';
      case 'epic': return '史诗';
      case 'rare': return '稀有';
      case 'common': return '普通';
      default: return '未知';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fdfcf8]">
        <Loader2 className="w-12 h-12 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fdfcf8] pb-20">
      <nav className="sticky top-0 z-40 glass border-b border-white/40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/cards" className="flex items-center gap-2 text-stone-500 hover:text-orange-600 transition-colors group">
              <div className="p-1.5 rounded-full bg-white shadow-sm border border-stone-100 group-hover:border-orange-200 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-medium text-sm">返回图鉴</span>
            </Link>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-50 rounded-full border border-orange-100">
              <Sparkles className="w-4 h-4 text-orange-500" />
              <span className="text-sm font-bold text-orange-700">
                剩余次数: {cardData?.drawsAvailable || 0}
              </span>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-md mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-[80vh] gap-8">
        
        {/* Draw Area */}
        <div className="relative w-full aspect-[3/4] max-w-sm perspective-1000">
          {!showResult ? (
            <div 
              onClick={handleDraw}
              className={`w-full h-full relative group cursor-pointer transition-all duration-500 transform-style-3d
                ${drawing ? 'animate-pulse scale-95' : 'hover:scale-[1.02]'}
              `}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 to-purple-700 rounded-3xl shadow-xl border-4 border-white/20 flex items-center justify-center overflow-hidden">
                {/* Pattern */}
                <div className="absolute inset-0 opacity-20" 
                  style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '20px 20px' }} 
                />
                <div className="text-center text-white p-6">
                  <Sparkles className={`w-16 h-16 mx-auto mb-4 ${drawing ? 'animate-spin' : ''}`} />
                  <h3 className="text-2xl font-bold mb-2">
                    {drawing ? '抽卡中...' : '点击抽卡'}
                  </h3>
                  <p className="text-white/60 text-sm">
                    消耗 1 次抽卡机会
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full h-full relative animate-scale-in">
              <div className={`w-full h-full rounded-3xl overflow-hidden bg-white shadow-2xl border-4 border-white flex flex-col
                ${getRarityBg(result?.card?.rarity)}
              `}>
                <div className="relative flex-1 bg-white m-2 rounded-2xl overflow-hidden shadow-inner">
                  {result?.card?.image && (
                    <div className="relative w-full h-full">
                      <Image 
                        src={result.card.image} 
                        alt={result.card.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    </div>
                  )}
                  {result?.isDuplicate && (
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur-md text-white text-xs rounded-lg font-medium border border-white/20">
                      已拥有
                    </div>
                  )}
                </div>
                
                <div className="p-4 text-center">
                  <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${getRarityColor(result?.card?.rarity)}`}>
                    {getRarityLabel(result?.card?.rarity)}
                  </div>
                  <h3 className="text-2xl font-black text-stone-800 mb-2">
                    {result?.card?.name}
                  </h3>
                  
                  {result?.isDuplicate ? (
                    <div className="text-sm text-stone-500 bg-white/50 py-1.5 px-3 rounded-lg inline-block">
                      转换为 {result.fragmentsAdded} 碎片
                    </div>
                  ) : (
                    <div className="text-sm text-orange-600 font-bold bg-orange-100/50 py-1.5 px-3 rounded-lg inline-block animate-pulse">
                      ✨ 新获得!
                    </div>
                  )}
                </div>
              </div>

              <button 
                onClick={() => setShowResult(false)}
                className="absolute -bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-2 px-6 py-3 bg-white text-stone-700 rounded-full font-bold shadow-lg hover:bg-stone-50 active:scale-95 transition-all w-max"
              >
                <RotateCcw className="w-4 h-4" />
                再抽一次
              </button>
            </div>
          )}
        </div>

        {/* Purchase Link */}
        <div className="text-center space-y-4">
           {cardData && cardData.drawsAvailable <= 0 && !showResult && (
             <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 text-orange-800 text-sm mb-4">
               抽卡次数不足，请先购买
             </div>
           )}
           
           <Link 
             href="/store"
             className="inline-flex items-center gap-2 text-stone-500 hover:text-orange-600 transition-colors text-sm font-medium"
           >
             <CreditCard className="w-4 h-4" />
             购买更多次数 (900积分/次)
           </Link>
        </div>

      </main>
    </div>
  );
}
