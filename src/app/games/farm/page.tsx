// src/app/games/farm/page.tsx

'use client';

import { useState, useCallback, useMemo } from 'react';
import { useFarmState } from './hooks/useFarmState';
import FarmHeader from './components/FarmHeader';
import WeatherBanner from './components/WeatherBanner';
import FarmGrid from './components/FarmGrid';
import CropShop from './components/CropShop';
import HarvestModal from './components/HarvestModal';
import RulesPanel from './components/RulesPanel';
import ItemShop from './components/ItemShop';
import ActiveBuffsBar from './components/ActiveBuffsBar';
import type { CropId, WeatherType } from '@/lib/types/farm';

/* ---------- 天气背景配置 ---------- */
const weatherBg: Record<WeatherType, string> = {
  sunny: 'from-sky-300 via-cyan-200 to-emerald-100',
  rainy: 'from-slate-400 via-blue-300 to-slate-200',
  drought: 'from-orange-300 via-amber-200 to-yellow-100',
  windy: 'from-gray-300 via-slate-200 to-blue-100',
  foggy: 'from-gray-400 via-slate-300 to-gray-200',
};

/* ---------- 天气粒子层 ---------- */
function WeatherParticles({ weather }: { weather: WeatherType }) {
  const rainDrops = useMemo(() => {
    if (weather !== 'rainy') return [];
    return Array.from({ length: 30 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      delay: `${Math.random() * 2}s`,
      duration: `${0.8 + Math.random() * 0.6}s`,
      opacity: 0.3 + Math.random() * 0.4,
    }));
  }, [weather]);

  const windLeaves = useMemo(() => {
    if (weather !== 'windy') return [];
    return Array.from({ length: 8 }, (_, i) => ({
      id: i,
      top: `${20 + Math.random() * 60}%`,
      delay: `${Math.random() * 4}s`,
      duration: `${3 + Math.random() * 2}s`,
    }));
  }, [weather]);

  const sunRays = useMemo(() => {
    if (weather !== 'sunny') return [];
    return Array.from({ length: 5 }, (_, i) => ({
      id: i,
      left: `${10 + i * 18}%`,
      delay: `${i * 0.4}s`,
    }));
  }, [weather]);

  if (weather === 'rainy') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        {rainDrops.map(p => (
          <div
            key={p.id}
            className="absolute w-0.5 h-4 bg-gradient-to-b from-blue-300/0 to-blue-400/70 rounded-full"
            style={{
              left: p.left,
              top: '-16px',
              animation: `farmRainFall ${p.duration} linear infinite`,
              animationDelay: p.delay,
              opacity: p.opacity,
            }}
          />
        ))}
      </div>
    );
  }

  if (weather === 'drought') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="absolute w-full h-8 bg-gradient-to-r from-transparent via-orange-200/30 to-transparent"
            style={{
              top: `${30 + i * 25}%`,
              animation: `farmHeatWave ${2 + i * 0.5}s ease-in-out infinite`,
              animationDelay: `${i * 0.7}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (weather === 'windy') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        {windLeaves.map(p => (
          <div
            key={p.id}
            className="absolute text-sm"
            style={{
              top: p.top,
              left: '-20px',
              animation: `farmWindParticle ${p.duration} linear infinite`,
              animationDelay: p.delay,
            }}
          >
            {['\uD83C\uDF43', '\uD83C\uDF42', '\uD83C\uDF3F'][p.id % 3]}
          </div>
        ))}
      </div>
    );
  }

  if (weather === 'sunny') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        {sunRays.map(p => (
          <div
            key={p.id}
            className="absolute top-0 w-1 bg-gradient-to-b from-yellow-200/40 to-transparent"
            style={{
              left: p.left,
              height: '40%',
              animation: `farmSunRay 3s ease-in-out infinite`,
              animationDelay: p.delay,
            }}
          />
        ))}
      </div>
    );
  }

  if (weather === 'foggy') {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-[1]">
        {[0, 1].map(i => (
          <div
            key={i}
            className="absolute w-[120%] h-24 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full blur-xl"
            style={{
              top: `${40 + i * 20}%`,
              left: '-10%',
              animation: `farmFogDrift ${6 + i * 2}s ease-in-out infinite`,
              animationDelay: `${i * 3}s`,
            }}
          />
        ))}
      </div>
    );
  }

  return null;
}

/* ---------- 云朵装饰 ---------- */
function FloatingClouds() {
  const clouds = useMemo(() => [
    { top: '4%', size: 'text-4xl', duration: '35s', delay: '0s', opacity: 0.5 },
    { top: '8%', size: 'text-2xl', duration: '45s', delay: '-15s', opacity: 0.35 },
    { top: '12%', size: 'text-3xl', duration: '40s', delay: '-25s', opacity: 0.4 },
  ], []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-[0]">
      {clouds.map((c, i) => (
        <div
          key={i}
          className={`absolute ${c.size}`}
          style={{
            top: c.top,
            opacity: c.opacity,
            animation: `farmCloudDrift ${c.duration} linear infinite`,
            animationDelay: c.delay,
          }}
        >
          {'\u2601\uFE0F'}
        </div>
      ))}
    </div>
  );
}

/* ---------- 山丘剪影 ---------- */
function HillsSilhouette() {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none z-[0] overflow-hidden">
      <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="absolute bottom-0 w-full h-full">
        <path
          d="M0,80 C150,30 300,60 450,40 C600,20 700,70 850,35 C950,15 1100,55 1200,45 L1200,120 L0,120 Z"
          fill="rgba(34,197,94,0.15)"
        />
        <path
          d="M0,90 C200,50 350,75 500,55 C650,35 800,80 950,50 C1050,30 1150,65 1200,60 L1200,120 L0,120 Z"
          fill="rgba(34,197,94,0.1)"
        />
      </svg>
    </div>
  );
}

/* ---------- 主页面 ---------- */
export default function FarmPage() {
  const farm = useFarmState();
  const [shopOpen, setShopOpen] = useState(false);
  const [plantingPlot, setPlantingPlot] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [itemShopOpen, setItemShopOpen] = useState(false);

  const handlePlant = useCallback((plotIndex: number) => {
    setPlantingPlot(plotIndex);
    setShopOpen(true);
  }, []);

  const handleCropSelect = useCallback(async (cropId: CropId) => {
    if (plantingPlot === null) return;
    const targetPlot = plantingPlot;
    setShopOpen(false);
    setPlantingPlot(null);
    void farm.plant(targetPlot, cropId);
  }, [plantingPlot, farm]);

  const handleCloseHarvest = useCallback(() => {
    farm.clearLastHarvest();
    farm.clearLastBatchHarvest();
    farm.clearLevelUp();
  }, [farm]);

  const handleWaterAll = useCallback(async () => {
    await farm.waterAll();
  }, [farm]);

  const handleHarvestAll = useCallback(async () => {
    await farm.harvestAll();
  }, [farm]);

  const handleRemoveAllWithered = useCallback(async () => {
    await farm.removeAllWithered();
  }, [farm]);

  const currentWeather = farm.weather ?? 'sunny';
  const bgGradient = weatherBg[currentWeather];

  // 加载中
  if (farm.loading) {
    return (
      <div className={`min-h-screen bg-gradient-to-b ${bgGradient} flex items-center justify-center relative overflow-hidden`}>
        <FloatingClouds />
        <div className="text-center space-y-4 z-10">
          <div className="text-6xl animate-bounce drop-shadow-lg">🌻</div>
          <p className="text-white/80 font-medium animate-pulse text-lg">加载农场中...</p>
        </div>
      </div>
    );
  }

  // 未登录或加载错误
  if (!farm.farmState) {
    return (
      <div className={`min-h-screen bg-gradient-to-b ${bgGradient} flex items-center justify-center p-4 relative overflow-hidden`}>
        <FloatingClouds />
        <HillsSilhouette />
        <div className="text-center space-y-4 max-w-sm z-10 bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-xl border border-white/60">
          <div className="text-6xl drop-shadow-md">🌻</div>
          <h2 className="text-2xl font-bold text-slate-800">开心农场</h2>
          {farm.error ? (
            <>
              <p className="text-red-500 text-sm">{farm.error}</p>
              <button
                onClick={() => farm.initFarm()}
                className="px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-green-500/25 active:scale-95"
              >
                重试
              </button>
            </>
          ) : (
            <p className="text-slate-500 text-sm">请先登录</p>
          )}
        </div>
      </div>
    );
  }

  const hasWaterNeeded = farm.computedPlots.some(p => p.needsWater && p.stage !== 'withered' && p.stage !== 'mature');
  const hasMature = farm.computedPlots.some(p => p.stage === 'mature');
  const hasWithered = farm.computedPlots.some(p => p.stage === 'withered');
  const hasPest = farm.computedPlots.some(p => p.hasPest);

  return (
    <div className={`min-h-screen bg-gradient-to-b ${bgGradient} relative overflow-hidden`}>
      {/* 天气粒子层 */}
      <WeatherParticles weather={currentWeather} />
      {/* 云朵 */}
      <FloatingClouds />
      {/* 山丘 */}
      <HillsSilhouette />

      {/* 主内容 */}
      <div className="relative z-10 py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mx-auto space-y-4">
          <FarmHeader
            farmState={farm.farmState}
            balance={farm.balance}
            dailyEarned={farm.dailyEarned}
            dailyLimit={farm.dailyLimit}
            pointsLimitReached={farm.pointsLimitReached}
          />

          <WeatherBanner weather={farm.weather} />

          {/* Buff 状态条 */}
          {farm.activeBuffs.length > 0 && (
            <ActiveBuffsBar activeBuffs={farm.activeBuffs} />
          )}

          {farm.error && (
            <div className="bg-red-50/90 backdrop-blur-sm border border-red-200 text-red-600 text-sm px-4 py-2 rounded-xl animate-farm-plot-enter">
              {farm.error}
            </div>
          )}

          {farm.actionLoading && (
            <div className="bg-sky-50/90 backdrop-blur-sm border border-sky-200 text-sky-700 text-sm px-4 py-2 rounded-xl animate-farm-plot-enter">
              {farm.queuedActions > 0
                ? `农场操作队列处理中，后面还有 ${farm.queuedActions} 个动作`
                : '农场操作处理中...'}
            </div>
          )}

          {/* 快捷操作栏 */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setRulesOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-white/80 backdrop-blur-sm border border-white/60 hover:border-green-400 text-slate-600 hover:text-green-700 text-sm font-medium rounded-xl transition-all shadow-sm hover:shadow-md active:scale-95"
            >
              <span>📖</span>
              规则说明
            </button>
            <button
              onClick={() => setItemShopOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-violet-500/25 active:scale-95 relative"
            >
              <span>🏪</span>
              道具商店
              {Object.values(farm.inventory).reduce((s, n) => s + n, 0) > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center shadow-sm">
                  {Object.values(farm.inventory).reduce((s, n) => s + n, 0)}
                </span>
              )}
            </button>
            {hasWaterNeeded && (
              <button
                onClick={handleWaterAll}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-blue-500/25 active:scale-95"
              >
                <span className="animate-farm-water-drop inline-block" style={{ animationIterationCount: 'infinite', animationDuration: '2s' }}>💧</span>
                一键浇水
              </button>
            )}
            {hasMature && (
              <button
                onClick={handleHarvestAll}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-amber-500/25 active:scale-95"
              >
                <span className="animate-farm-mature inline-block">🌾</span>
                一键收获
              </button>
            )}
            {hasWithered && (
              <button
                onClick={handleRemoveAllWithered}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50 shadow-lg shadow-red-500/25 active:scale-95"
              >
                <span>🗑️</span>
                一键铲除
              </button>
            )}
            {hasPest && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-red-100/80 backdrop-blur-sm text-red-600 text-sm font-medium rounded-xl border border-red-200/60 animate-farm-plot-enter">
                <span className="animate-farm-pest inline-block">🐛</span>
                有害虫出没！
              </div>
            )}
          </div>

          <FarmGrid
            plots={farm.computedPlots}
            onPlant={handlePlant}
            onWater={(i) => farm.water(i)}
            onHarvest={(i) => farm.harvest(i)}
            onRemovePest={(i) => farm.removePest(i)}
            onRemoveCrop={(i) => farm.removeCrop(i)}
          />

          {farm.farmState.totalHarvests === 0 && farm.computedPlots.every(p => !p.cropId) && (
            <div className="bg-gradient-to-r from-green-50/90 to-emerald-50/90 backdrop-blur-sm border border-green-200/60 rounded-2xl p-5 space-y-3 animate-farm-plot-enter">
              <h3 className="font-bold text-green-800 flex items-center gap-2">
                <span>📖</span> 新手指南
              </h3>
              <div className="space-y-2 text-sm text-green-700">
                <p><b>1.</b> 点击空田地，选择种子种植（花费积分购买种子）</p>
                <p><b>2.</b> 等待作物在真实时间中生长，期间记得按时浇水</p>
                <p><b>3.</b> 作物成熟后点击收获，获得积分收益</p>
                <p><b>4.</b> 留意天气变化和害虫，不同天气会影响产量</p>
              </div>
              <button
                onClick={() => setRulesOpen(true)}
                className="text-sm font-semibold text-green-800 hover:text-green-900 underline underline-offset-2 decoration-green-400"
              >
                查看完整规则（作物表、积分公式、天气效果...）→
              </button>
            </div>
          )}

          <div className="text-center text-xs text-white/50 pt-4 pb-8">
            作物会在真实时间中生长，你可以随时回来查看
          </div>
        </div>
      </div>

      {shopOpen && farm.farmState && (
        <CropShop
          level={farm.farmState.level}
          unlockedCrops={farm.farmState.unlockedCrops}
          balance={farm.balance}
          actionLoading={farm.actionLoading}
          error={farm.error}
          onSelect={handleCropSelect}
          onClose={() => {
            setShopOpen(false);
            setPlantingPlot(null);
          }}
        />
      )}

      {(farm.lastHarvest || farm.lastBatchHarvest) && (
        <HarvestModal
          result={farm.lastHarvest}
          batchResult={farm.lastBatchHarvest}
          levelUp={farm.levelUpInfo}
          onClose={handleCloseHarvest}
        />
      )}

      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}

      {itemShopOpen && farm.farmState && (
        <ItemShop
          balance={farm.balance}
          activeBuffs={farm.activeBuffs}
          inventory={farm.inventory}
          farmLevel={farm.farmState.level}
          plots={farm.computedPlots}
          onPurchase={farm.purchaseItem}
          onUseItem={farm.useItem}
          onClose={() => setItemShopOpen(false)}
        />
      )}
    </div>
  );
}
