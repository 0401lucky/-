// src/app/games/farm/page.tsx

'use client';

import { useState, useCallback } from 'react';
import { useFarmState } from './hooks/useFarmState';
import FarmHeader from './components/FarmHeader';
import WeatherBanner from './components/WeatherBanner';
import FarmGrid from './components/FarmGrid';
import CropShop from './components/CropShop';
import HarvestModal from './components/HarvestModal';
import RulesPanel from './components/RulesPanel';
import type { CropId } from '@/lib/types/farm';

export default function FarmPage() {
  const farm = useFarmState();
  const [shopOpen, setShopOpen] = useState(false);
  const [plantingPlot, setPlantingPlot] = useState<number | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 点击空地 → 打开商店
  const handlePlant = useCallback((plotIndex: number) => {
    setPlantingPlot(plotIndex);
    setShopOpen(true);
  }, []);

  // 从商店选择作物
  const handleCropSelect = useCallback(async (cropId: CropId) => {
    if (plantingPlot === null) return;
    const ok = await farm.plant(plantingPlot, cropId);
    if (ok) {
      setShopOpen(false);
      setPlantingPlot(null);
    }
  }, [plantingPlot, farm]);

  // 关闭收获弹窗
  const handleCloseHarvest = useCallback(() => {
    farm.clearLastHarvest();
    farm.clearLevelUp();
  }, [farm]);

  // 一键浇水
  const handleWaterAll = useCallback(async () => {
    const count = await farm.waterAll();
    if (count === 0) {
      // 无需浇水的提示可以通过 error 显示
    }
  }, [farm]);

  // 加载中
  if (farm.loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-5xl animate-bounce">🌻</div>
          <p className="text-slate-500 animate-pulse">加载农场中...</p>
        </div>
      </div>
    );
  }

  // 未登录或加载错误且无状态
  if (!farm.farmState) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-5xl">🌻</div>
          <h2 className="text-xl font-bold text-slate-800">开心农场</h2>
          {farm.error ? (
            <>
              <p className="text-red-500 text-sm">{farm.error}</p>
              <button
                onClick={() => farm.initFarm()}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium transition-colors"
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

  // 计算是否有田地需要浇水
  const hasWaterNeeded = farm.computedPlots.some(p => p.needsWater && p.stage !== 'withered' && p.stage !== 'mature');
  // 计算是否有成熟作物
  const hasMature = farm.computedPlots.some(p => p.stage === 'mature');
  // 计算是否有害虫
  const hasPest = farm.computedPlots.some(p => p.hasPest);

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* 头部信息 */}
        <FarmHeader
          farmState={farm.farmState}
          balance={farm.balance}
          dailyEarned={farm.dailyEarned}
          dailyLimit={farm.dailyLimit}
          pointsLimitReached={farm.pointsLimitReached}
        />

        {/* 天气 */}
        <WeatherBanner weather={farm.weather} />

        {/* 错误提示 */}
        {farm.error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2 rounded-xl">
            {farm.error}
          </div>
        )}

        {/* 快捷操作栏 */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setRulesOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 hover:border-green-400 text-slate-600 hover:text-green-700 text-sm font-medium rounded-xl transition-colors shadow-sm"
          >
            <span>📖</span>
            规则说明
          </button>
          {hasWaterNeeded && (
            <button
              onClick={handleWaterAll}
              disabled={farm.actionLoading}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50 shadow-sm"
            >
              <span>💧</span>
              一键浇水
            </button>
          )}
          {hasMature && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 text-amber-700 text-sm font-medium rounded-xl">
              <span>🌾</span>
              有作物可收获！
            </div>
          )}
          {hasPest && (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-red-100 text-red-600 text-sm font-medium rounded-xl">
              <span>🐛</span>
              有害虫出没！
            </div>
          )}
        </div>

        {/* 农场网格 */}
        <FarmGrid
          plots={farm.computedPlots}
          actionLoading={farm.actionLoading}
          onPlant={handlePlant}
          onWater={(i) => farm.water(i)}
          onHarvest={(i) => farm.harvest(i)}
          onRemovePest={(i) => farm.removePest(i)}
          onRemoveCrop={(i) => farm.removeCrop(i)}
        />

        {/* 新手引导 */}
        {farm.farmState.totalHarvests === 0 && farm.computedPlots.every(p => !p.cropId) && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-2xl p-5 space-y-3">
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

        {/* 底部信息 */}
        <div className="text-center text-xs text-slate-400 pt-4 pb-8">
          作物会在真实时间中生长，你可以随时回来查看
        </div>
      </div>

      {/* 种子商店弹窗 */}
      {shopOpen && farm.farmState && (
        <CropShop
          level={farm.farmState.level}
          unlockedCrops={farm.farmState.unlockedCrops}
          balance={farm.balance}
          onSelect={handleCropSelect}
          onClose={() => {
            setShopOpen(false);
            setPlantingPlot(null);
          }}
        />
      )}

      {/* 收获结果弹窗 */}
      {farm.lastHarvest && (
        <HarvestModal
          result={farm.lastHarvest}
          levelUp={farm.levelUpInfo}
          onClose={handleCloseHarvest}
        />
      )}

      {/* 规则说明弹窗 */}
      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
