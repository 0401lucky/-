'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Loader2,
  Sparkles,
  Star,
  Trophy,
} from 'lucide-react';
import { getCardsByAlbum, getAlbumById } from '@/lib/cards/config';
import { CardGrid } from '@/components/cards/CardGrid';
import { RewardsSection } from '@/components/cards/RewardsSection';
import { UserCards } from '@/lib/cards/draw';

// 三套卡册的主题色映射，与卡牌图鉴主页保持一致
const ALBUM_THEME: Record<string, 's1' | 's2' | 'special'> = {
  'animal-s1': 's1',
  'animal-s2': 's2',
  tarot: 'special',
};

export default function AlbumDetailPage() {
  const router = useRouter();
  const params = useParams();
  const albumId = params.albumId as string;

  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState<UserCards | null>(null);

  const album = getAlbumById(albumId);
  const albumCards = album ? getCardsByAlbum(albumId) : [];
  const theme = ALBUM_THEME[albumId] ?? 's2';

  useEffect(() => {
    let cancelled = false;

    const fetchInventory = async () => {
      try {
        const cardsRes = await fetch('/api/cards/inventory');
        if (!cardsRes.ok) return;

        const cardsData = await cardsRes.json();
        if (cardsData.success && !cancelled) {
          setCardData(cardsData.data);
        }
      } catch (err) {
        console.error('Failed to load inventory', err);
      }
    };

    const init = async () => {
      // 校验卡册是否存在
      if (!album) {
        router.push('/cards');
        return;
      }

      let authed = false;

      try {
        // 1. 校验登录态（仅登录态阻塞页面渲染）
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

        authed = true;
      } catch (err) {
        console.error('Failed to check auth', err);
      } finally {
        if (!cancelled) setLoading(false);
      }

      // 2. 异步获取库存（不阻塞首屏渲染）
      if (!authed || cancelled) return;
      await fetchInventory();
    };

    void init();
    return () => {
      cancelled = true;
    };
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
        <p className="text-slate-400 font-medium animate-pulse">正在读取图鉴...</p>
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <BookOpen className="w-12 h-12 text-slate-300" />
        <p className="text-slate-400 font-medium">卡册不存在</p>
        <Link href="/cards" className="text-blue-500 hover:text-blue-600 font-medium">
          返回卡册列表
        </Link>
      </div>
    );
  }

  const ownedInAlbum = albumCards.filter((c) => cardData?.inventory.includes(c.id)).length;
  const totalInAlbum = albumCards.length;
  const percent = totalInAlbum > 0 ? Math.round((ownedInAlbum / totalInAlbum) * 100) : 0;

  return (
    <div className={`album-page album-theme-${theme}`}>
      {/* 蓝色系流动 mesh 背景层 */}
      <div className="album-mesh-bg" aria-hidden />

      {/* === 顶部导航栏 === */}
      <header className="topbar">
        <Link href="/cards" className="exit-btn" aria-label="返回卡牌图鉴" title="返回卡牌图鉴">
          <span className="arrow">
            <ArrowLeft size={14} strokeWidth={2.4} />
          </span>
          EXIT
        </Link>
      </header>

      <main className="album-container">
        {/* === Hero 横幅 === */}
        <section className="album-hero">
          <div className="stars" aria-hidden>
            <span className="star" style={{ top: '14%', left: '8%', fontSize: 13 }}>✦</span>
            <span className="star" style={{ top: '34%', left: '38%', fontSize: 11, animationDelay: '0.8s' }}>✦</span>
            <span className="star" style={{ top: '70%', left: '20%', fontSize: 14, animationDelay: '1.4s' }}>✦</span>
            <span className="star" style={{ top: '78%', left: '52%', fontSize: 10, animationDelay: '0.4s' }}>✦</span>
            <span className="star" style={{ top: '24%', left: '62%', fontSize: 12, animationDelay: '2s' }}>✦</span>
          </div>

          <div className="hero-content">
            <div className="hero-left">
              {album.season && (
                <div className="hero-badge">
                  <Trophy size={12} strokeWidth={2.4} />
                  {album.season}
                </div>
              )}
              <h1 className="hero-title">
                <span className="glow">{album.name}</span>
              </h1>
              <p className="hero-sub">{album.description}</p>
            </div>

            <div className="hero-cover" aria-hidden>
              <div className="cover-glow" />
              <Image
                src={album.coverImage}
                alt={album.name}
                width={180}
                height={180}
                sizes="180px"
                className="cover-img"
              />
            </div>
          </div>

          {/* 数据汇总卡片 */}
          <div className="hero-stats">
            <div className="hs-item">
              <div className="hs-label">
                <BookOpen size={12} strokeWidth={2.4} />
                已收集
              </div>
              <div className="hs-value">
                <span className="num">{cardData ? ownedInAlbum : '—'}</span>
                <span className="unit">/ {totalInAlbum} 张</span>
              </div>
            </div>
            <div className="hs-divider" />
            <div className="hs-item">
              <div className="hs-label">
                <Star size={12} fill="currentColor" strokeWidth={0} />
                完成进度
              </div>
              <div className="hs-value">
                <span className="num">{cardData ? percent : '—'}</span>
                <span className="unit">%</span>
              </div>
            </div>
            <div className="hs-divider" />
            <div className="hs-item">
              <div className="hs-label">
                <Sparkles size={12} fill="currentColor" strokeWidth={0} />
                我的碎片
              </div>
              <div className="hs-value">
                <span className="num">{cardData ? cardData.fragments.toLocaleString() : '—'}</span>
                <span className="unit">片</span>
              </div>
            </div>
          </div>
        </section>

        {/* === 奖励 + 卡牌网格 === */}
        <section className="album-content">
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
        </section>
      </main>

      <style jsx global>{`
        .album-page {
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          color: #0f172a;
          min-height: 100vh;
          padding-bottom: 96px;
          position: relative;
          --c-blue: #3b82f6;
          --c-sky: #0ea5e9;
          --c-cyan: #06b6d4;
          --c-indigo: #6366f1;
          --text-main: #0f172a;
          --text-light: #64748b;
        }

        .album-page * { box-sizing: border-box; }
        .album-page a { color: inherit; text-decoration: none; }

        /* === 蓝色流动 Mesh 背景 === */
        .album-page .album-mesh-bg {
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background-color: #f0f7ff;
          background-image:
            radial-gradient(circle at 15% 50%, rgba(199, 210, 254, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 85% 30%, rgba(186, 230, 253, 0.85) 0%, transparent 50%),
            radial-gradient(circle at 50% 90%, rgba(165, 243, 252, 0.78) 0%, transparent 50%),
            radial-gradient(circle at 50% 10%, rgba(219, 234, 254, 0.85) 0%, transparent 50%);
          filter: blur(60px);
          animation: album-fluid 15s infinite alternate ease-in-out;
        }

        @keyframes album-fluid {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.05) rotate(2deg); }
          100% { transform: scale(1.1) rotate(-2deg); }
        }

        /* === 顶部导航 === */
        .album-page .topbar {
          position: relative;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 24px;
          padding: 16px 48px;
          background: linear-gradient(135deg, rgba(219, 234, 254, 0.9), rgba(239, 246, 255, 0.78));
          backdrop-filter: blur(24px) saturate(1.6);
          -webkit-backdrop-filter: blur(24px) saturate(1.6);
          border-bottom: 1px solid rgba(96, 165, 250, 0.28);
          box-shadow: 0 16px 36px rgba(37, 99, 235, 0.08);
          padding-top: max(16px, env(safe-area-inset-top));
        }

        .album-page .exit-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 9px 18px 9px 9px;
          background: rgba(255, 255, 255, 0.82);
          border: 1px solid rgba(96, 165, 250, 0.35);
          border-radius: 999px;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          font-weight: 800;
          font-size: 13px;
          color: #1d4ed8;
          letter-spacing: 1px;
          box-shadow: 0 10px 22px rgba(37, 99, 235, 0.1);
          flex-shrink: 0;
          text-decoration: none;
        }
        .album-page .exit-btn:hover {
          background: #fff;
          transform: translateY(-2px);
          box-shadow: 0 14px 28px rgba(37, 99, 235, 0.18);
        }
        .album-page .exit-btn .arrow {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: linear-gradient(135deg, #60a5fa, #2563eb);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
        }

        /* === 主容器 === */
        .album-page .album-container {
          max-width: 1500px;
          margin: 0 auto;
          padding: 28px 48px 96px;
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        /* === Hero 横幅 === */
        .album-page .album-hero {
          position: relative;
          padding: 44px 48px;
          border-radius: 36px;
          color: #fff;
          overflow: hidden;
          box-shadow: 0 30px 60px rgba(30, 58, 138, 0.4);
        }

        .album-page.album-theme-s1 .album-hero {
          background: linear-gradient(135deg, #083344 0%, #0c4a6e 30%, #0369a1 65%, #0ea5e9 100%);
        }
        .album-page.album-theme-s2 .album-hero {
          background: linear-gradient(135deg, #0c1e4d 0%, #1e3a8a 35%, #2563eb 70%, #3b82f6 100%);
        }
        .album-page.album-theme-special .album-hero {
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 35%, #4338ca 70%, #6366f1 100%);
        }

        .album-page .album-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.18), transparent 40%),
            radial-gradient(circle at 80% 70%, rgba(125, 211, 252, 0.3), transparent 50%),
            radial-gradient(circle at 50% 100%, rgba(99, 102, 241, 0.35), transparent 60%);
          pointer-events: none;
        }

        .album-page .album-hero::after {
          content: '';
          position: absolute;
          top: -40%;
          right: -10%;
          width: 480px;
          height: 480px;
          background: radial-gradient(circle, rgba(125, 211, 252, 0.28), transparent 60%);
          filter: blur(50px);
          pointer-events: none;
          animation: album-glow-pulse 4.5s ease-in-out infinite;
        }

        @keyframes album-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.18); opacity: 1; }
        }

        .album-page .stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
        }
        .album-page .star {
          position: absolute;
          color: rgba(255, 255, 255, 0.7);
          animation: album-twinkle 3s ease-in-out infinite;
        }
        @keyframes album-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .album-page .hero-content {
          position: relative;
          z-index: 2;
          display: flex;
          gap: 24px;
          align-items: center;
          justify-content: space-between;
        }

        .album-page .hero-left {
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-width: 60%;
        }

        .album-page .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          background: rgba(125, 211, 252, 0.22);
          border: 1px solid rgba(125, 211, 252, 0.45);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          color: #bae6fd;
          letter-spacing: 1px;
          backdrop-filter: blur(10px);
          width: fit-content;
        }

        .album-page .hero-title {
          font-size: 44px;
          font-weight: 900;
          letter-spacing: -1.2px;
          line-height: 1.1;
          margin: 0;
          color: #fff;
        }

        .album-page .hero-title .glow {
          background: linear-gradient(135deg, #e0f2fe, #7dd3fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 40px rgba(56, 189, 248, 0.4);
        }

        .album-page .hero-sub {
          font-size: 15px;
          color: rgba(255, 255, 255, 0.85);
          line-height: 1.6;
          margin: 0;
          max-width: 540px;
        }

        .album-page .hero-cover {
          position: relative;
          width: 200px;
          height: 200px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
          animation: album-cover-float 4s ease-in-out infinite;
        }

        @keyframes album-cover-float {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-8px) rotate(2deg); }
        }

        .album-page .cover-glow {
          position: absolute;
          inset: -20px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(125, 211, 252, 0.5), transparent 65%);
          filter: blur(30px);
          z-index: -1;
        }

        .album-page .cover-img {
          width: 180px;
          height: 180px;
          object-fit: contain;
          border-radius: 24px;
          filter: drop-shadow(0 18px 36px rgba(0, 0, 0, 0.35));
        }

        .album-page .hero-stats {
          position: relative;
          z-index: 2;
          margin-top: 28px;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 22px;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 20px;
          backdrop-filter: blur(15px);
        }

        .album-page .hs-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
          min-width: 0;
        }

        .album-page .hs-label {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
          letter-spacing: 1px;
          text-transform: uppercase;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        .album-page .hs-value {
          display: inline-flex;
          align-items: baseline;
          gap: 4px;
        }

        .album-page .hs-value .num {
          font-size: 26px;
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #e0f2fe, #7dd3fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.5px;
        }

        .album-page .hs-value .unit {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 700;
        }

        .album-page .hs-divider {
          width: 1px;
          height: 36px;
          background: rgba(255, 255, 255, 0.18);
          flex-shrink: 0;
        }

        /* === 内容区 === */
        .album-page .album-content {
          display: flex;
          flex-direction: column;
          gap: 26px;
        }

        /* === 响应式 === */
        @media (max-width: 1280px) {
          .album-page .topbar { padding: 14px 32px; }
          .album-page .album-container { padding: 24px 32px 80px; }
          .album-page .hero-title { font-size: 36px; }
        }

        @media (max-width: 992px) {
          .album-page .topbar { padding: 12px 24px; gap: 12px; }
          .album-page .album-container { padding: 20px 24px 80px; gap: 22px; }
          .album-page .album-hero { padding: 32px 26px; border-radius: 30px; }
          .album-page .hero-content { flex-direction: column; align-items: flex-start; }
          .album-page .hero-left { max-width: 100%; }
          .album-page .hero-cover { width: 150px; height: 150px; }
          .album-page .cover-img { width: 140px; height: 140px; }
          .album-page .hero-title { font-size: 32px; }
        }

        @media (max-width: 640px) {
          .album-page .topbar { padding: 10px 14px; gap: 8px; }
          .album-page .exit-btn { padding: 7px 14px 7px 7px; font-size: 12px; }
          .album-page .exit-btn .arrow { width: 26px; height: 26px; }
          .album-page .album-container { padding: 16px 14px 100px; gap: 18px; }
          .album-page .album-hero { padding: 24px 18px; border-radius: 24px; }
          .album-page .hero-badge { font-size: 11px; padding: 5px 11px; }
          .album-page .hero-title { font-size: 26px; letter-spacing: -1px; }
          .album-page .hero-sub { font-size: 13px; }
          .album-page .hero-stats { flex-wrap: wrap; padding: 14px 16px; gap: 10px; }
          .album-page .hs-divider { display: none; }
          .album-page .hs-item { flex: 0 0 calc(50% - 6px); }
          .album-page .hs-value .num { font-size: 22px; }
        }

        /* === 手机端重排 v2：参考排行榜/游戏中心 === */
        @media (max-width: 640px) {
          .album-page {
            padding-bottom: 0;
          }
          .album-page .album-mesh-bg {
            opacity: 0.78;
            filter: blur(42px);
          }

          /* 顶栏：fixed 全宽磨砂，不随页面滚动 */
          .album-page .topbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 100;
            width: 100%;
            margin: 0;
            padding: 10px 14px;
            padding-top: max(10px, env(safe-area-inset-top));
            gap: 8px;
            border: 0;
            border-radius: 0;
            border-bottom: 1px solid rgba(186, 230, 253, 0.7);
            background: rgba(240, 247, 255, 0.85);
            backdrop-filter: blur(24px) saturate(1.6);
            -webkit-backdrop-filter: blur(24px) saturate(1.6);
            box-shadow: 0 8px 20px rgba(37, 99, 235, 0.06);
          }
          .album-page .exit-btn {
            padding: 6px 12px 6px 6px;
            font-size: 11.5px;
            letter-spacing: 0.5px;
            gap: 6px;
            border-radius: 999px;
          }
          .album-page .exit-btn .arrow {
            width: 24px;
            height: 24px;
            flex: 0 0 auto;
          }
          .album-page .exit-btn .arrow svg { width: 12px; height: 12px; }

          /* 容器：给 fixed topbar 让出空间 */
          .album-page .album-container {
            padding: max(72px, calc(60px + env(safe-area-inset-top))) 12px max(80px, calc(28px + env(safe-area-inset-bottom)));
            gap: 14px;
          }

          /* Hero 紧凑 */
          .album-page .album-hero {
            padding: 20px 16px;
            border-radius: 22px;
          }
          .album-page .hero-content {
            flex-direction: row;
            align-items: center;
            gap: 14px;
          }
          .album-page .hero-left { min-width: 0; flex: 1; }
          .album-page .hero-badge {
            font-size: 10.5px;
            padding: 4px 9px;
            letter-spacing: 0;
            margin-bottom: 8px;
          }
          .album-page .hero-title {
            font-size: 22px;
            line-height: 1.15;
            letter-spacing: -0.5px;
            margin-bottom: 6px;
          }
          .album-page .hero-sub { font-size: 12px; line-height: 1.55; }
          .album-page .hero-cover {
            width: 96px;
            height: 96px;
            flex: 0 0 auto;
          }
          .album-page .cover-img { width: 88px; height: 88px; }

          /* Hero stats 3 等分 */
          .album-page .hero-stats {
            padding: 12px 12px;
            gap: 8px;
            flex-wrap: nowrap;
            border-radius: 16px;
            margin-top: 14px;
          }
          .album-page .hs-item {
            flex: 1 1 0;
            min-width: 0;
          }
          .album-page .hs-label {
            font-size: 9.5px;
            letter-spacing: 0;
            gap: 4px;
          }
          .album-page .hs-label svg { width: 11px; height: 11px; }
          .album-page .hs-value .num {
            font-size: 18px;
            letter-spacing: -0.3px;
          }
          .album-page .hs-value .unit { font-size: 10.5px; }

          .album-page .album-content { gap: 16px; }
        }

        @media (max-width: 480px) {
          .album-page .topbar {
            padding: 9px 12px;
            padding-top: max(9px, env(safe-area-inset-top));
          }
          .album-page .exit-btn { padding: 5px 10px 5px 5px; font-size: 11px; }
          .album-page .exit-btn .arrow { width: 22px; height: 22px; }

          .album-page .album-container { padding: max(66px, calc(54px + env(safe-area-inset-top))) 10px max(72px, calc(24px + env(safe-area-inset-bottom))); }

          .album-page .album-hero { padding: 18px 14px; border-radius: 20px; }
          .album-page .hero-title { font-size: 20px; }
          .album-page .hero-sub { font-size: 11.5px; }
          .album-page .hero-cover { width: 84px; height: 84px; }
          .album-page .cover-img { width: 76px; height: 76px; }

          .album-page .hero-stats { padding: 10px 10px; gap: 6px; }
          .album-page .hs-label { font-size: 9px; }
          .album-page .hs-value .num { font-size: 16px; }
          .album-page .hs-value .unit { font-size: 10px; }
        }
      `}</style>
    </div>
  );
}
