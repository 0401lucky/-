import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { X, Sparkles, Box, Calendar, Star, Repeat, Loader2 } from 'lucide-react';
import type { CardConfig, Rarity } from '@/lib/cards/types';
import { EXCHANGE_PRICES } from '@/lib/cards/constants';

interface CardDetailProps {
  card: CardConfig;
  count: number;
  fragments?: number;
  firstAcquired?: number; // timestamp
  onClose: () => void;
  onExchange?: (cardId: string) => Promise<void>;
}

// 稀有度元数据：保留语义色（用于稀有度徽章），其余装饰统一蓝色玻璃风
const RARITY_META: Record<Rarity, {
  label: string;
  badgeBg: string;       // 稀有度徽章背景渐变
  glowColor: string;     // 卡面后方光晕颜色
  ringColor: string;     // 卡面外发光描边
}> = {
  legendary_rare: {
    label: '传说稀有',
    badgeBg: 'linear-gradient(135deg, #f43f5e, #be123c)',
    glowColor: 'rgba(244, 63, 94, 0.55)',
    ringColor: 'rgba(244, 63, 94, 0.6)',
  },
  legendary: {
    label: '传说',
    badgeBg: 'linear-gradient(135deg, #fbbf24, #d97706)',
    glowColor: 'rgba(251, 191, 36, 0.55)',
    ringColor: 'rgba(251, 191, 36, 0.6)',
  },
  epic: {
    label: '史诗',
    badgeBg: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
    glowColor: 'rgba(139, 92, 246, 0.55)',
    ringColor: 'rgba(139, 92, 246, 0.6)',
  },
  rare: {
    label: '稀有',
    badgeBg: 'linear-gradient(135deg, #60a5fa, #2563eb)',
    glowColor: 'rgba(59, 130, 246, 0.55)',
    ringColor: 'rgba(59, 130, 246, 0.6)',
  },
  common: {
    label: '普通',
    badgeBg: 'linear-gradient(135deg, #94a3b8, #475569)',
    glowColor: 'rgba(100, 116, 139, 0.45)',
    ringColor: 'rgba(100, 116, 139, 0.5)',
  },
};

export function CardDetail({ card, count, fragments = 0, firstAcquired, onClose, onExchange }: CardDetailProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExchanging, setIsExchanging] = useState(false);
  const [imageError, setImageError] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meta = RARITY_META[card.rarity] || RARITY_META.common;
  const isOwned = count > 0;

  const exchangePrice = EXCHANGE_PRICES[card.rarity];
  const canExchange = fragments >= exchangePrice;

  useEffect(() => {
    setIsVisible(true);
    // 弹窗打开时锁定 body 滚动
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // ESC 键关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setImageError(false);
  }, [card.image]);

  const handleClose = () => {
    setIsVisible(false);
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = null;
      onClose();
    }, 280);
  };

  const handleExchange = async () => {
    if (!onExchange || !canExchange || isExchanging) return;

    setIsExchanging(true);
    try {
      await onExchange(card.id);
    } catch (error) {
      console.error('Exchange failed', error);
    } finally {
      setIsExchanging(false);
    }
  };

  return (
    <div className={`card-detail-mask ${isVisible ? 'is-open' : ''}`} onClick={handleClose}>
      <div className="card-detail-modal" onClick={(e) => e.stopPropagation()}>
        {/* 顶部蓝色渐变 Hero 区 */}
        <div className="cd-hero">
          <div className="cd-hero-glow" aria-hidden />
          <div className="cd-stars" aria-hidden>
            <span className="cd-star" style={{ top: '20%', left: '12%' }}>✦</span>
            <span className="cd-star" style={{ top: '60%', left: '32%', animationDelay: '0.6s' }}>✦</span>
            <span className="cd-star" style={{ top: '30%', left: '70%', animationDelay: '1.2s' }}>✦</span>
            <span className="cd-star" style={{ top: '70%', left: '85%', animationDelay: '0.3s' }}>✦</span>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="cd-close"
            aria-label="关闭"
          >
            <X size={18} strokeWidth={2.4} />
          </button>
        </div>

        {/* 卡面 + 稀有度徽章 */}
        <div className="cd-card-wrap">
          <div
            className={`cd-card ${isOwned ? '' : 'is-locked'}`}
            style={{
              boxShadow: isOwned
                ? `0 24px 48px ${meta.glowColor}, 0 0 0 3px ${meta.ringColor}`
                : '0 24px 48px rgba(15, 23, 42, 0.18), 0 0 0 3px rgba(148, 163, 184, 0.35)',
            }}
          >
            {imageError ? (
              <div className="cd-card-fallback">
                <span>{card.name}</span>
              </div>
            ) : (
              <Image
                src={card.image}
                alt={card.name}
                fill
                sizes="200px"
                className="cd-card-img"
                onError={() => setImageError(true)}
              />
            )}

            {!isOwned && (
              <div className="cd-card-lock">
                <div className="cd-card-lock-mark">?</div>
                <div className="cd-card-lock-text">未拥有</div>
              </div>
            )}
          </div>

          <div className="cd-rarity-badge" style={{ background: meta.badgeBg }}>
            <Star size={11} fill="#fff" strokeWidth={0} />
            {meta.label}
          </div>
        </div>

        {/* 卡片正文 */}
        <div className="cd-body">
          <h2 className="cd-name">{card.name}</h2>

          <div className="cd-stats">
            <div className="cd-stat">
              <div className="cd-stat-label">
                <Box size={11} strokeWidth={2.4} />
                拥有数量
              </div>
              <div className="cd-stat-value">
                <span className="num">{count}</span>
                <span className="unit">张</span>
              </div>
            </div>

            {firstAcquired && (
              <>
                <div className="cd-stat-divider" />
                <div className="cd-stat">
                  <div className="cd-stat-label">
                    <Calendar size={11} strokeWidth={2.4} />
                    首次获得
                  </div>
                  <div className="cd-stat-value cd-stat-date">
                    {new Date(firstAcquired).toLocaleDateString()}
                  </div>
                </div>
              </>
            )}
          </div>

          <p className="cd-desc">
            {isOwned
              ? `恭喜！这是你收藏的珍稀${meta.label}卡牌。集齐更多卡牌可以兑换丰厚奖励！`
              : '你还没有拥有这张卡牌。快去抽卡或使用碎片兑换吧！'}
          </p>

          {/* 重复获得提示 */}
          {isOwned && count > 1 && (
            <div className="cd-tag">
              <Sparkles size={12} strokeWidth={2.4} />
              重复获得 {count - 1} 张
            </div>
          )}

          {/* 兑换按钮 */}
          {onExchange && (
            <div className="cd-actions">
              <button
                onClick={handleExchange}
                disabled={!canExchange || isExchanging}
                className={`cd-btn-exchange ${canExchange ? 'is-active' : 'is-disabled'}`}
              >
                {isExchanging ? (
                  <Loader2 size={16} className="cd-spin" />
                ) : (
                  <>
                    <Repeat size={15} strokeWidth={2.4} />
                    <span>{exchangePrice} 碎片兑换</span>
                  </>
                )}
              </button>

              <div className="cd-fragment-info">
                当前碎片：
                <span className={`val ${canExchange ? 'ok' : 'low'}`}>
                  {fragments.toLocaleString()}
                </span>
                <span className="sep">/</span>
                <span className="need">{exchangePrice}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .card-detail-mask {
          position: fixed;
          inset: 0;
          z-index: 200;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          opacity: 0;
          transition: opacity 0.28s ease;
        }

        .card-detail-mask.is-open {
          opacity: 1;
        }

        .card-detail-modal {
          width: min(440px, 100%);
          max-height: min(92vh, 760px);
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 60%, #eff6ff 100%);
          border: 1px solid rgba(255, 255, 255, 1);
          border-radius: 28px;
          box-shadow:
            0 30px 60px rgba(15, 23, 42, 0.28),
            inset 0 1px 0 rgba(255, 255, 255, 1);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
          transform: translateY(16px) scale(0.96);
          opacity: 0;
          transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.28s ease;
        }

        .card-detail-mask.is-open .card-detail-modal {
          transform: translateY(0) scale(1);
          opacity: 1;
        }

        /* === 顶部 Hero 蓝色渐变区 === */
        .card-detail-modal .cd-hero {
          position: relative;
          height: 120px;
          background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #6366f1 100%);
          overflow: hidden;
          flex-shrink: 0;
        }

        .card-detail-modal .cd-hero::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(circle at 20% 30%, rgba(255, 255, 255, 0.22), transparent 45%),
            radial-gradient(circle at 80% 70%, rgba(125, 211, 252, 0.35), transparent 50%);
          pointer-events: none;
        }

        .card-detail-modal .cd-hero-glow {
          position: absolute;
          top: -40%;
          right: -10%;
          width: 240px;
          height: 240px;
          background: radial-gradient(circle, rgba(125, 211, 252, 0.45), transparent 65%);
          filter: blur(40px);
          pointer-events: none;
          animation: cd-glow-pulse 4s ease-in-out infinite;
        }

        @keyframes cd-glow-pulse {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.18); opacity: 1; }
        }

        .card-detail-modal .cd-stars {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .card-detail-modal .cd-star {
          position: absolute;
          color: rgba(255, 255, 255, 0.75);
          font-size: 12px;
          animation: cd-twinkle 3s ease-in-out infinite;
        }

        @keyframes cd-twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }

        .card-detail-modal .cd-close {
          position: absolute;
          top: 14px;
          right: 14px;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
          border: 1px solid rgba(255, 255, 255, 0.3);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
          z-index: 5;
        }

        .card-detail-modal .cd-close:hover {
          background: rgba(255, 255, 255, 0.32);
          transform: rotate(90deg);
        }

        /* === 卡面浮动区 === */
        .card-detail-modal .cd-card-wrap {
          position: relative;
          margin: -76px auto 0;
          width: 200px;
          flex-shrink: 0;
          padding-bottom: 18px;
        }

        .card-detail-modal .cd-card {
          position: relative;
          width: 200px;
          height: 268px;
          border-radius: 18px;
          overflow: hidden;
          background: #fff;
          border: 4px solid #fff;
          transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .card-detail-modal .cd-card:hover {
          transform: translateY(-4px) scale(1.02);
        }

        .card-detail-modal .cd-card.is-locked {
          filter: grayscale(0.85) brightness(0.92);
        }

        .card-detail-modal .cd-card-img {
          object-fit: cover;
        }

        .card-detail-modal .cd-card-fallback {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #dbeafe, #bfdbfe);
          color: #1e3a8a;
          font-weight: 800;
          font-size: 14px;
          padding: 12px;
          text-align: center;
        }

        .card-detail-modal .cd-card-lock {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
        }

        .card-detail-modal .cd-card-lock-mark {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.55);
          border: 2px solid rgba(255, 255, 255, 0.4);
          color: #fff;
          font-size: 30px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .card-detail-modal .cd-card-lock-text {
          font-size: 12px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.85);
          letter-spacing: 1px;
        }

        .card-detail-modal .cd-rarity-badge {
          position: absolute;
          left: 50%;
          bottom: 4px;
          transform: translateX(-50%);
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 14px;
          color: #fff;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          border-radius: 999px;
          border: 2px solid #fff;
          box-shadow: 0 8px 16px rgba(15, 23, 42, 0.18);
          white-space: nowrap;
        }

        /* === 正文 === */
        .card-detail-modal .cd-body {
          padding: 14px 28px 28px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow-y: auto;
          flex: 1;
        }

        .card-detail-modal .cd-body::-webkit-scrollbar {
          width: 6px;
        }
        .card-detail-modal .cd-body::-webkit-scrollbar-thumb {
          background: rgba(59, 130, 246, 0.2);
          border-radius: 6px;
        }

        .card-detail-modal .cd-name {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: -0.6px;
          color: #0f172a;
          margin: 0;
          text-align: center;
        }

        .card-detail-modal .cd-stats {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 14px 18px;
          background: rgba(219, 234, 254, 0.5);
          border: 1px solid rgba(191, 219, 254, 0.7);
          border-radius: 16px;
        }

        .card-detail-modal .cd-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }

        .card-detail-modal .cd-stat-label {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10.5px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 1px;
          text-transform: uppercase;
        }

        .card-detail-modal .cd-stat-value {
          display: inline-flex;
          align-items: baseline;
          gap: 3px;
          color: #0f172a;
        }

        .card-detail-modal .cd-stat-value .num {
          font-size: 22px;
          font-weight: 900;
          line-height: 1;
          background: linear-gradient(135deg, #2563eb, #4f46e5);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          letter-spacing: -0.4px;
        }

        .card-detail-modal .cd-stat-value .unit {
          font-size: 11px;
          color: #64748b;
          font-weight: 700;
        }

        .card-detail-modal .cd-stat-date {
          font-size: 14px;
          font-weight: 800;
          color: #1e3a8a;
        }

        .card-detail-modal .cd-stat-divider {
          width: 1px;
          height: 32px;
          background: rgba(59, 130, 246, 0.18);
          flex-shrink: 0;
        }

        .card-detail-modal .cd-desc {
          font-size: 13px;
          line-height: 1.6;
          color: #475569;
          margin: 0;
          text-align: center;
        }

        .card-detail-modal .cd-tag {
          align-self: center;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 5px 14px;
          background: rgba(59, 130, 246, 0.1);
          color: #2563eb;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
        }

        /* === 兑换 === */
        .card-detail-modal .cd-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 4px;
        }

        .card-detail-modal .cd-btn-exchange {
          width: 100%;
          padding: 13px 18px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 0.3px;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          position: relative;
          overflow: hidden;
        }

        .card-detail-modal .cd-btn-exchange.is-active {
          background: linear-gradient(135deg, #38bdf8, #2563eb);
          color: #fff;
          box-shadow: 0 12px 24px rgba(59, 130, 246, 0.35);
        }

        .card-detail-modal .cd-btn-exchange.is-active::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
          transform: translateX(-100%);
          transition: transform 0.6s;
        }

        .card-detail-modal .cd-btn-exchange.is-active:hover {
          transform: translateY(-2px);
          box-shadow: 0 18px 30px rgba(59, 130, 246, 0.45);
        }

        .card-detail-modal .cd-btn-exchange.is-active:hover::before {
          transform: translateX(100%);
        }

        .card-detail-modal .cd-btn-exchange.is-disabled {
          background: rgba(148, 163, 184, 0.2);
          color: #94a3b8;
          cursor: not-allowed;
        }

        .card-detail-modal .cd-spin {
          animation: cd-spin 1s linear infinite;
        }

        @keyframes cd-spin {
          to { transform: rotate(360deg); }
        }

        .card-detail-modal .cd-fragment-info {
          font-size: 12px;
          color: #64748b;
          font-weight: 600;
          text-align: center;
        }

        .card-detail-modal .cd-fragment-info .val {
          font-weight: 900;
          margin-left: 4px;
        }

        .card-detail-modal .cd-fragment-info .val.ok { color: #2563eb; }
        .card-detail-modal .cd-fragment-info .val.low { color: #f87171; }
        .card-detail-modal .cd-fragment-info .sep { margin: 0 4px; color: #cbd5e1; }
        .card-detail-modal .cd-fragment-info .need { font-weight: 800; color: #475569; }

        /* === 移动端 === */
        @media (max-width: 480px) {
          .card-detail-mask { padding: 12px; }
          .card-detail-modal { border-radius: 22px; max-height: 90vh; }
          .card-detail-modal .cd-hero { height: 100px; }
          .card-detail-modal .cd-card-wrap { width: 170px; margin-top: -64px; }
          .card-detail-modal .cd-card { width: 170px; height: 228px; }
          .card-detail-modal .cd-body { padding: 12px 22px 24px; }
          .card-detail-modal .cd-name { font-size: 22px; }
          .card-detail-modal .cd-stats { padding: 12px 14px; gap: 10px; }
          .card-detail-modal .cd-stat-value .num { font-size: 19px; }
          .card-detail-modal .cd-stat-date { font-size: 13px; }
        }
      `}</style>
    </div>
  );
}
