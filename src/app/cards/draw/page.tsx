'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Sparkles, CreditCard, RotateCcw, Star, Zap, Crown, Hexagon } from 'lucide-react';
import { UserCards } from '@/lib/cards/draw';
import { CardConfig } from '@/lib/cards/types';
import confetti from 'canvas-confetti';

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
  const [isFlipped, setIsFlipped] = useState(false);

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
  const handleDraw = async () => {
    if (drawing || !cardData || cardData.drawsAvailable <= 0) return;

    setDrawing(true);
    setShowResult(false);
    setIsFlipped(false);
    setResult(null);

    try {
      // 1. Animation Phase: Shake and Glow
      await new Promise(resolve => setTimeout(resolve, 1500)); // Longer suspense

      // 2. API Call
      const res = await fetch('/api/cards/draw', { method: 'POST' });
      const data: DrawResponse = await res.json();
      
      if (data.success && data.data.success) {
        setResult(data.data);
        setShowResult(true);
        
        // 3. Flip Reveal
        setTimeout(() => setIsFlipped(true), 100);

        // 4. Update Inventory
        await fetchInventory();

        // 5. Special Effects for High Rarity
        if (data.data.card) {
          const rarity = data.data.card.rarity;
          if (['legendary', 'legendary_rare', 'epic'].includes(rarity || '')) {
             triggerConfetti(rarity);
          }
        }
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

  const triggerConfetti = (rarity?: string) => {
    const isMythic = rarity === 'legendary_rare';
    const isLegendary = rarity === 'legendary';
    
    const colors = isMythic 
      ? ['#ff0000', '#ffa500', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#ee82ee'] 
      : isLegendary 
        ? ['#FFD700', '#FFA500', '#FFFFFF'] 
        : ['#A855F7', '#E879F9', '#FFFFFF'];

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
      case 'legendary_rare': // Mythic (Rainbow/Red)
        return {
          border: 'border-red-500',
          shadow: 'shadow-[0_0_50px_rgba(239,68,68,0.6)]',
          text: 'text-red-400',
          bg: 'bg-gradient-to-br from-red-950 via-black to-red-900',
          badge: 'bg-red-500/20 text-red-200 border-red-500/50',
          animation: 'animate-pulse-fast'
        };
      case 'legendary': // Legendary (Gold)
        return {
          border: 'border-yellow-400',
          shadow: 'shadow-[0_0_40px_rgba(250,204,21,0.5)]',
          text: 'text-yellow-400',
          bg: 'bg-gradient-to-br from-yellow-950 via-black to-yellow-900',
          badge: 'bg-yellow-500/20 text-yellow-200 border-yellow-500/50',
          animation: 'animate-pulse'
        };
      case 'epic': // Epic (Purple)
        return {
          border: 'border-purple-500',
          shadow: 'shadow-[0_0_30px_rgba(168,85,247,0.4)]',
          text: 'text-purple-400',
          bg: 'bg-gradient-to-br from-purple-950 via-black to-purple-900',
          badge: 'bg-purple-500/20 text-purple-200 border-purple-500/50',
          animation: ''
        };
      case 'rare': // Rare (Blue)
        return {
          border: 'border-cyan-400',
          shadow: 'shadow-[0_0_20px_rgba(34,211,238,0.3)]',
          text: 'text-cyan-400',
          bg: 'bg-gradient-to-br from-cyan-950 via-black to-cyan-900',
          badge: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/50',
          animation: ''
        };
      default: // Common (Gray)
        return {
          border: 'border-slate-500',
          shadow: 'shadow-[0_0_10px_rgba(100,116,139,0.2)]',
          text: 'text-slate-400',
          bg: 'bg-slate-900',
          badge: 'bg-slate-500/20 text-slate-300 border-slate-500/50',
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
        <p className="mt-4 text-indigo-300 font-light tracking-widest">LOADING STARMAP...</p>
      </div>
    );
  }

  const styles = getRarityStyles(result?.card?.rarity);

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-hidden relative selection:bg-indigo-500/30">
      <style jsx global>{`
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
        .animate-shake { animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both infinite; }
        .animate-pulse-fast { animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
      `}</style>

      {/* Background Ambience */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-indigo-600/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 mix-blend-overlay"></div>
        {/* Stars */}
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 0)', backgroundSize: '40px 40px', opacity: 0.1 }}></div>
      </div>

      {/* Navbar */}
      <nav className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex justify-between items-center h-[72px]">
            <Link href="/cards" className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors group">
              <div className="p-2 rounded-full bg-white/5 group-hover:bg-white/10 transition-colors">
                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              </div>
              <span className="font-medium text-sm tracking-wide">EXIT SYSTEM</span>
            </Link>
            <div className="flex items-center gap-3 px-4 py-2 bg-indigo-500/10 rounded-full border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-indigo-200">
                CREDITS: <span className="text-white">{cardData?.drawsAvailable || 0}</span>
              </span>
              <Link href="/store" className="ml-2 p-1 hover:bg-white/10 rounded-full transition-colors">
                 <Zap className="w-3 h-3 text-yellow-400" />
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-md mx-auto px-4 py-8 flex flex-col items-center justify-center min-h-[80vh] gap-12">
        
        {/* Main Card Stage */}
        <div className="relative w-full aspect-[2/3] max-w-[320px] perspective-1000">
          <div 
            className={`w-full h-full relative transition-all duration-700 transform-style-3d 
              ${(showResult && isFlipped) ? 'rotate-y-180' : ''} 
              ${drawing ? 'animate-shake' : 'animate-float'}
              cursor-pointer group
            `}
            onClick={!drawing && !showResult ? handleDraw : undefined}
          >
            {/* FRONT (Card Back Design) */}
            <div className="absolute inset-0 w-full h-full backface-hidden rounded-[2rem] overflow-hidden border border-white/10 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] bg-slate-900">
              {/* Card Back Art */}
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950">
                <div className="absolute inset-0 opacity-30" 
                  style={{ 
                    backgroundImage: `linear-gradient(45deg, #6366f1 1px, transparent 1px), linear-gradient(-45deg, #6366f1 1px, transparent 1px)`, 
                    backgroundSize: '30px 30px' 
                  }} 
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className={`w-32 h-32 rounded-full border-2 border-indigo-400/30 flex items-center justify-center ${drawing ? 'animate-spin' : ''}`}>
                    <div className="w-24 h-24 rounded-full border border-indigo-400/50 flex items-center justify-center">
                      <Hexagon className="w-12 h-12 text-indigo-400 animate-pulse" />
                    </div>
                  </div>
                </div>
                {/* Glow Effect */}
                <div className="absolute inset-0 bg-gradient-to-t from-indigo-500/20 to-transparent opacity-50"></div>
              </div>
              
              {/* Call to Action */}
              <div className="absolute bottom-10 inset-x-0 text-center">
                <p className="text-indigo-200 font-bold tracking-[0.2em] text-sm uppercase">
                  {drawing ? 'Materializing...' : 'Tap to Invoke'}
                </p>
              </div>
            </div>

            {/* BACK (Result Reveal) */}
            <div className={`absolute inset-0 w-full h-full backface-hidden rotate-y-180 rounded-[2rem] overflow-hidden bg-slate-900 border-4 shadow-2xl flex flex-col ${styles.border} ${styles.shadow}`}>
              {/* Image Container */}
              <div className="relative flex-1 m-1.5 rounded-[1.5rem] overflow-hidden bg-black/50">
                {result?.card?.image ? (
                   <Image 
                     src={result.card.image} 
                     alt={result.card.name}
                     fill
                     className="object-cover"
                   />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-600 bg-slate-800">
                    No Image
                  </div>
                )}
                
                {/* Shine Effect Overlay */}
                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 animate-shine" style={{ backgroundSize: '200% 100%' }}></div>
                
                {/* Rarity Icon Top Left */}
                <div className="absolute top-3 left-3">
                   {result?.card?.rarity === 'legendary_rare' && <Crown className="w-6 h-6 text-red-500 drop-shadow-lg" />}
                   {result?.card?.rarity === 'legendary' && <Star className="w-6 h-6 text-yellow-400 fill-yellow-400 drop-shadow-lg" />}
                </div>

                {/* Duplicate Badge */}
                {result?.isDuplicate && (
                  <div className="absolute top-3 right-3 px-2 py-1 bg-black/80 backdrop-blur-sm text-white/90 text-[10px] rounded border border-white/20 font-bold tracking-wider">
                    DUPLICATE
                  </div>
                )}
              </div>

              {/* Info Section */}
              <div className={`p-5 text-center relative z-10 ${styles.bg}`}>
                <div className={`text-[10px] font-black uppercase tracking-[0.2em] mb-2 ${styles.text}`}>
                  {rarityLabel(result?.card?.rarity)}
                </div>
                
                <h3 className="text-xl font-bold text-white mb-3 line-clamp-1">
                  {result?.card?.name}
                </h3>
                
                {result?.isDuplicate ? (
                  <div className="inline-flex items-center gap-1.5 text-xs text-slate-400 bg-white/5 py-1.5 px-3 rounded-lg border border-white/5">
                    <RotateCcw className="w-3 h-3" />
                    <span>Converted: +{result.fragmentsAdded} Fragments</span>
                  </div>
                ) : (
                  <div className={`inline-flex items-center gap-1.5 text-xs font-bold py-1.5 px-3 rounded-lg border backdrop-blur-md ${styles.badge} ${styles.animation}`}>
                    <Sparkles className="w-3 h-3" />
                    <span>NEW ACQUISITION</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Shadow/Reflection beneath card */}
          <div className="absolute -bottom-10 left-10 right-10 h-4 bg-black/40 blur-xl rounded-full"></div>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex flex-col items-center gap-4">
           {showResult && (
             <button 
               onClick={() => setShowResult(false)}
               className="group relative px-8 py-3 bg-white text-slate-900 rounded-full font-bold shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] hover:scale-105 active:scale-95 transition-all overflow-hidden"
             >
               <span className="relative z-10 flex items-center gap-2">
                 <RotateCcw className="w-4 h-4" />
                 DRAW AGAIN
               </span>
               <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
             </button>
           )}

           {cardData && cardData.drawsAvailable <= 0 && !showResult && (
             <div className="text-center animate-pulse">
                <p className="text-red-400 text-sm font-medium mb-2">Insufficient Credits</p>
                <Link 
                  href="/store"
                  className="inline-flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors text-sm font-bold shadow-lg shadow-indigo-900/50"
                >
                  <CreditCard className="w-4 h-4" />
                  RECHARGE (900/draw)
                </Link>
             </div>
           )}
           
           {!showResult && cardData && cardData.drawsAvailable > 0 && (
              <p className="text-slate-500 text-xs tracking-widest uppercase">
                {cardData.drawsAvailable} Invocations Remaining
              </p>
           )}
        </div>

      </main>
    </div>
  );
}
