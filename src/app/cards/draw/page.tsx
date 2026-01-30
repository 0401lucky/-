'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Sparkles, CreditCard, RotateCcw, Star, Zap, Crown } from 'lucide-react';
import { UserCards } from '@/lib/cards/draw';
import { CardConfig } from '@/lib/cards/types';
import confetti from 'canvas-confetti';

interface SingleDrawResult {
  card: CardConfig;
  isDuplicate: boolean;
  fragmentsAdded?: number;
}

interface DrawResponse {
  success: boolean;
  data: {
    success: boolean;
    card?: CardConfig;
    cards?: SingleDrawResult[];
    count?: number;
    message?: string;
    isDuplicate?: boolean;
    fragmentsAdded?: number;
  };
}

// 分档保底计数器（史诗/传说/传稀）
function PityCounters({
  epic,
  legendary,
  legendaryRare,
}: {
  epic: number;
  legendary: number;
  legendaryRare: number;
}) {
  const toRemaining = (threshold: number, counter: number) => Math.max(0, threshold - Math.max(0, Math.floor(counter || 0)));

  const items = [
    { label: '史诗', remaining: toRemaining(50, epic), color: 'text-purple-500' },
    { label: '传说', remaining: toRemaining(100, legendary), color: 'text-yellow-500' },
    { label: '传稀', remaining: toRemaining(200, legendaryRare), color: 'text-pink-500' },
  ];

  const nearest = items.reduce((best, cur) => (cur.remaining < best.remaining ? cur : best), items[0]);

  return (
    <>
      {/* Desktop: show all */}
      <div className="hidden md:flex items-center gap-2">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-pink-50 rounded-full border border-purple-200/50 text-xs"
          >
            <Crown className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-slate-500">{it.label}保底:</span>
            <span className={`font-bold ${it.color}`}>{it.remaining}抽</span>
          </div>
        ))}
      </div>

      {/* Mobile: show nearest */}
      <div className="md:hidden flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-r from-purple-50 to-pink-50 rounded-full border border-purple-200/50 text-[10px]">
        <Crown className="w-3 h-3 text-purple-400" />
        <span className="text-slate-500">{nearest.label}保底:</span>
        <span className={`font-bold ${nearest.color}`}>{nearest.remaining}抽</span>
      </div>
    </>
  );
}

export default function DrawPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const [cardData, setCardData] = useState<UserCards | null>(null);
  const [result, setResult] = useState<SingleDrawResult | null>(null);
  const [multiResults, setMultiResults] = useState<SingleDrawResult[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isMultiDraw, setIsMultiDraw] = useState(false);
  const [revealedCards, setRevealedCards] = useState<number[]>([]);

  // Load inventory
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

  // Handle Draw Logic
  const handleDraw = async (count: number = 1) => {
    if (drawing || !cardData || cardData.drawsAvailable < count) return;

    setDrawing(true);
    setShowResult(false);
    setIsFlipped(false);
    setResult(null);
    setMultiResults([]);
    setIsMultiDraw(count > 1);
    setRevealedCards([]);

    try {
      // 1. Animation Phase
      await new Promise(resolve => setTimeout(resolve, count > 1 ? 800 : 1500));

      // 2. API Call
      const res = await fetch('/api/cards/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count })
      });
      const data: DrawResponse = await res.json();

      if (data.success && data.data.success) {
        if (count === 1 && data.data.card) {
          // 单抽
          setResult({
            card: data.data.card,
            isDuplicate: data.data.isDuplicate || false,
            fragmentsAdded: data.data.fragmentsAdded
          });
          setShowResult(true);
          setTimeout(() => setIsFlipped(true), 100);

          // Special Effects
          if (['legendary', 'legendary_rare', 'epic'].includes(data.data.card.rarity)) {
            triggerConfetti(data.data.card.rarity);
          }
        } else if (data.data.cards) {
          // 多连抽
          setMultiResults(data.data.cards);
          setShowResult(true);

          // 依次翻开卡牌
          data.data.cards.forEach((cardResult, index) => {
            setTimeout(() => {
              setRevealedCards(prev => [...prev, index]);
              // 高稀有度特效
              if (['legendary', 'legendary_rare', 'epic'].includes(cardResult.card.rarity)) {
                triggerConfetti(cardResult.card.rarity);
              }
            }, 300 + index * 400);
          });
        }

        // Update Inventory
        await fetchInventory();
      } else {
        alert(data.data?.message || (data as any).message || '抽卡失败，请重试');
      }
    } catch (err) {
      console.error('Draw failed', err);
      alert('网络错误，请稍后重试');
    } finally {
      setDrawing(false);
    }
  };

  const triggerConfetti = (rarity?: string) => {
    const isMythic = rarity === 'legendary_rare';
    const isLegendary = rarity === 'legendary';

    const colors = isMythic
      ? ['#ff9a9e', '#fad0c4', '#ffecd2', '#a18cd1', '#fbc2eb', '#8fd3f4']
      : isLegendary
        ? ['#fbbf24', '#fcd34d', '#ffffff']
        : ['#c084fc', '#e879f9', '#ffffff'];

    const duration = isMythic ? 3000 : 2000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: isMythic ? 7 : 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: colors
      });
      confetti({
        particleCount: isMythic ? 7 : 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: colors
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  };

  const getRarityStyles = (rarity?: string) => {
    switch (rarity) {
      case 'legendary_rare': // Mythic (Rainbow/Pink)
        return {
          border: 'border-pink-400',
          shadow: 'shadow-[0_0_50px_rgba(244,114,182,0.6)]',
          text: 'text-pink-500',
          bg: 'bg-gradient-to-br from-pink-100 via-white to-rose-100',
          badge: 'bg-pink-500 text-white border-pink-200',
          animation: 'animate-pulse-fast'
        };
      case 'legendary': // Legendary (Gold)
        return {
          border: 'border-yellow-400',
          shadow: 'shadow-[0_0_40px_rgba(250,204,21,0.4)]',
          text: 'text-yellow-600',
          bg: 'bg-gradient-to-br from-amber-50 via-white to-yellow-50',
          badge: 'bg-yellow-400 text-white border-yellow-200',
          animation: 'animate-pulse'
        };
      case 'epic': // Epic (Purple)
        return {
          border: 'border-purple-300',
          shadow: 'shadow-[0_0_30px_rgba(192,132,252,0.3)]',
          text: 'text-purple-500',
          bg: 'bg-gradient-to-br from-purple-50 via-white to-fuchsia-50',
          badge: 'bg-purple-400 text-white border-purple-200',
          animation: ''
        };
      case 'rare': // Rare (Blue)
        return {
          border: 'border-cyan-300',
          shadow: 'shadow-[0_0_20px_rgba(34,211,238,0.3)]',
          text: 'text-cyan-600',
          bg: 'bg-gradient-to-br from-cyan-50 via-white to-sky-50',
          badge: 'bg-cyan-400 text-white border-cyan-200',
          animation: ''
        };
      default: // Common (Gray)
        return {
          border: 'border-slate-200',
          shadow: 'shadow-[0_0_10px_rgba(148,163,184,0.1)]',
          text: 'text-slate-500',
          bg: 'bg-white',
          badge: 'bg-slate-200 text-slate-500 border-slate-100',
          animation: ''
        };
    }
  };

  const rarityLabel = (rarity?: string) => {
    switch (rarity) {
      case 'legendary_rare': return '传说稀有 (Mythic)';
      case 'legendary': return '传说 (Legendary)';
      case 'epic': return '史诗 (Epic)';
      case 'rare': return '稀有 (Rare)';
      default: return '普通 (Common)';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-pink-50 text-slate-600">
        <Loader2 className="w-12 h-12 animate-spin text-pink-400" />
        <p className="mt-4 text-pink-300 font-medium tracking-widest">LOADING MAGIC...</p>
      </div>
    );
  }

  const styles = getRarityStyles(result?.card?.rarity);

  return (
    <div className="min-h-screen bg-pink-50 text-slate-600 overflow-hidden relative selection:bg-pink-200">
      <style jsx global>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-20px); }
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-3px, 0px) rotate(1deg); }
          30% { transform: translate(3px, 2px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          50% { transform: translate(-1px, 2px) rotate(-1deg); }
          60% { transform: translate(-3px, 1px) rotate(0deg); }
          70% { transform: translate(3px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); }
          90% { transform: translate(1px, 2px) rotate(0deg); }
          100% { transform: translate(1px, -2px) rotate(-1deg); }
        }
        @keyframes shine {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .perspective-1000 { perspective: 1000px; }
        .transform-style-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
        .animate-float { animation: float 6s ease-in-out infinite; }
        .animate-bounce-slow { animation: bounce 3s ease-in-out infinite; }
        .animate-wiggle { animation: wiggle 2s ease-in-out infinite; }
        .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both infinite; }
        .animate-pulse-fast { animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>

      {/* Background Ambience */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-pink-200/40 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-blue-200/40 rounded-full blur-[80px]" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 mix-blend-overlay"></div>
        {/* Cute Pattern */}
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#f472b6 2px, transparent 0)', backgroundSize: '30px 30px', opacity: 0.1 }}></div>
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-pink-100 bg-white/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/cards" className="flex items-center gap-2 text-slate-500 hover:text-pink-500 transition-colors group">
              <div className="p-2 rounded-full bg-pink-100 group-hover:bg-pink-200 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-bold text-sm tracking-wide rounded-full">EXIT</span>
            </Link>
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Pity Counter - 保底计数器 */}
              <PityCounters
                epic={cardData?.pityEpic ?? 0}
                legendary={cardData?.pityLegendary ?? 0}
                legendaryRare={cardData?.pityLegendaryRare ?? cardData?.pityCounter ?? 0}
              />
              <div className="flex items-center gap-2 px-2 sm:px-4 py-1.5 sm:py-2 bg-white rounded-full border border-pink-200 shadow-sm">
                <Sparkles className="w-4 h-4 text-pink-400" />
                <span className="text-sm font-bold text-slate-600">
                  <span className="hidden sm:inline">CREDITS: </span>
                  <span className="text-pink-500">{cardData?.drawsAvailable || 0}</span>
                </span>
                <Link href="/store" className="ml-2 p-1 hover:bg-pink-50 rounded-full transition-colors">
                  <Zap className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-[80vh] gap-8">

        {/* Multi-Draw Results Grid */}
        {showResult && isMultiDraw && multiResults.length > 0 && (
          <div className="w-full">
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4">
              {multiResults.map((cardResult, index) => {
                const cardStyles = getRarityStyles(cardResult.card.rarity);
                const isRevealed = revealedCards.includes(index);
                return (
                  <div key={index} className="perspective-1000">
                    <div className={`aspect-[2/3] relative transition-all duration-500 transform-style-3d ${isRevealed ? 'rotate-y-180' : ''}`}>
                      {/* Card Back */}
                      <div className="absolute inset-0 backface-hidden rounded-xl overflow-hidden border-2 border-white shadow-lg bg-gradient-to-br from-pink-200 via-purple-100 to-blue-200">
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Star className="w-8 h-8 text-pink-400 fill-pink-400 animate-pulse" />
                        </div>
                      </div>
                      {/* Card Front */}
                      <div className={`absolute inset-0 backface-hidden rotate-y-180 rounded-xl overflow-hidden border-2 ${cardStyles.border} ${cardStyles.shadow} bg-white flex flex-col`}>
                        <div className="relative flex-1 m-1 rounded-lg overflow-hidden bg-slate-50">
                          <Image
                            src={cardResult.card.image}
                            alt={cardResult.card.name}
                            fill
                            className="object-cover"
                            sizes="(max-width: 640px) 30vw, 18vw"
                            priority={index < 3}
                          />
                          {cardResult.isDuplicate && (
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-white/90 text-slate-500 text-[8px] rounded-full font-bold">
                              重复
                            </div>
                          )}
                        </div>
                        <div className={`p-2 text-center ${cardStyles.bg}`}>
                          <p className="text-xs font-bold text-slate-700 truncate">{cardResult.card.name}</p>
                          <p className={`text-[10px] ${cardStyles.text}`}>
                            {cardResult.isDuplicate ? `+${cardResult.fragmentsAdded}碎片` : 'NEW!'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Single Draw Card Stage */}
        {(!showResult || !isMultiDraw) && (
        <div className="relative w-full aspect-[2/3] max-w-[320px] perspective-1000">
          <div
            className={`w-full h-full relative transition-all duration-700 transform-style-3d
              ${(showResult && isFlipped) ? 'rotate-y-180' : ''}
              ${drawing ? 'animate-shake' : (showResult ? '' : 'animate-bounce-slow')}
              cursor-pointer group
            `}
            onClick={!drawing && !showResult ? () => handleDraw(1) : undefined}
          >
            {/* FRONT (Card Back Design) */}
            <div className="absolute inset-0 w-full h-full backface-hidden rounded-[2.5rem] overflow-hidden border-4 border-white shadow-[0_20px_40px_-12px_rgba(244,114,182,0.3)] bg-pink-100">
              {/* Card Back Art */}
              <div className="absolute inset-0 bg-gradient-to-br from-pink-200 via-purple-100 to-blue-200">
                <div className="absolute inset-0 opacity-50"
                  style={{
                    backgroundImage: `radial-gradient(#ffffff 4px, transparent 0)`,
                    backgroundSize: '24px 24px'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`w-32 h-32 rounded-full border-4 border-white/50 flex items-center justify-center bg-white/20 backdrop-blur-sm ${drawing ? 'animate-spin' : 'animate-wiggle'}`}>
                    <div className="w-24 h-24 rounded-full border-4 border-white flex items-center justify-center bg-white">
                      <Star className="w-12 h-12 text-pink-400 fill-pink-400 animate-pulse" />
                    </div>
                  </div>
                </div>
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-white/40 to-transparent"></div>
              </div>

              {/* Call to Action */}
              <div className="absolute bottom-12 inset-x-0 text-center">
                <p className="text-pink-500 font-black tracking-widest text-lg uppercase drop-shadow-sm">
                  {drawing ? 'Magic...' : 'Tap to Open'}
                </p>
              </div>
            </div>

            {/* BACK (Result Reveal) */}
            <div className={`absolute inset-0 w-full h-full backface-hidden rotate-y-180 rounded-[2.5rem] overflow-hidden bg-white border-4 shadow-xl flex flex-col ${styles.border} ${styles.shadow}`}>
              {/* Image Container */}
              <div className="relative flex-1 m-2 rounded-[2rem] overflow-hidden bg-white border-2 border-slate-100">
                {result?.card?.image ? (
                  <Image
                    src={result.card.image}
                    alt={result.card.name}
                    fill
                    className="object-cover"
                    priority
                    sizes="320px"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400 bg-slate-50">
                    No Image
                  </div>
                )}

                {/* Shine Effect Overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/40 to-transparent opacity-0 animate-shine" style={{ backgroundSize: '200% 100%' }}></div>

                {/* Rarity Icon Top Left */}
                <div className="absolute top-3 left-3">
                  {result?.card?.rarity === 'legendary_rare' && <Crown className="w-6 h-6 text-pink-500 drop-shadow-md" />}
                  {result?.card?.rarity === 'legendary' && <Star className="w-6 h-6 text-yellow-500 fill-yellow-500 drop-shadow-md" />}
                </div>

                {/* Duplicate Badge */}
                {result?.isDuplicate && (
                  <div className="absolute top-3 right-3 px-2 py-1 bg-white/90 backdrop-blur-sm text-slate-600 text-[10px] rounded-full border border-slate-200 font-bold tracking-wider shadow-sm">
                    DUPLICATE
                  </div>
                )}
              </div>

              {/* Info Section */}
              <div className={`p-5 text-center relative z-10 ${styles.bg}`}>
                <div className={`text-[10px] font-black uppercase tracking-[0.2em] mb-2 ${styles.text}`}>
                  {rarityLabel(result?.card?.rarity)}
                </div>

                <h3 className="text-xl font-bold text-slate-800 mb-3 line-clamp-1">
                  {result?.card?.name}
                </h3>

                {result?.isDuplicate ? (
                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-white/50 py-1.5 px-3 rounded-full border border-slate-200/50">
                    <RotateCcw className="w-3 h-3" />
                    <span>Converted: +{result.fragmentsAdded} Fragments</span>
                  </div>
                ) : (
                  <div className={`inline-flex items-center gap-1.5 text-xs font-bold py-1.5 px-3 rounded-full border backdrop-blur-md shadow-sm ${styles.badge} ${styles.animation}`}>
                    <Sparkles className="w-3 h-3" />
                    <span>NEW!</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Shadow/Reflection beneath card */}
          <div className="absolute -bottom-10 left-10 right-10 h-4 bg-black/40 blur-xl rounded-full"></div>
        </div>
        )}


        {/* Action Buttons */}
        <div className="w-full flex flex-col items-center gap-4">
          {showResult && (
            <button
              onClick={() => { setShowResult(false); setIsMultiDraw(false); setMultiResults([]); }}
              className="group relative px-8 py-3 bg-gradient-to-r from-pink-500 to-purple-500 text-white rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all overflow-hidden"
            >
              <span className="relative z-10 flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
                继续抽卡
              </span>
              <div className="absolute inset-0 bg-white/20 -translate-x-full group-hover:translate-x-0 transition-transform duration-300"></div>
            </button>
          )}

          {/* Draw Buttons */}
          {!showResult && cardData && cardData.drawsAvailable > 0 && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex gap-3">
                <button
                  onClick={() => handleDraw(1)}
                  disabled={drawing || cardData.drawsAvailable < 1}
                  className="group relative px-6 py-3 bg-gradient-to-r from-pink-400 to-pink-500 text-white rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    单抽
                  </span>
                </button>
                <button
                  onClick={() => handleDraw(5)}
                  disabled={drawing || cardData.drawsAvailable < 5}
                  className="group relative px-6 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-full font-bold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="flex items-center gap-2">
                    <Zap className="w-4 h-4" />
                    五连抽
                  </span>
                </button>
              </div>
              <p className="text-slate-500 text-xs tracking-widest uppercase">
                {cardData.drawsAvailable} 次抽卡机会
              </p>
            </div>
          )}

          {cardData && cardData.drawsAvailable <= 0 && !showResult && (
            <div className="text-center animate-pulse">
              <p className="text-red-400 text-sm font-medium mb-2">抽卡次数不足</p>
              <Link
                href="/store"
                className="inline-flex items-center gap-2 px-6 py-2 bg-pink-500 hover:bg-pink-400 text-white rounded-full transition-colors text-sm font-bold shadow-md shadow-pink-200"
              >
                <CreditCard className="w-4 h-4" />
                去商店兑换
              </Link>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
