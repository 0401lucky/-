// src/app/games/farm/components/RulesPanel.tsx

'use client';

import { CROPS, FARM_LEVELS, WEATHERS } from '@/lib/farm-config';
import type { FarmLevel, CropId } from '@/lib/types/farm';

interface RulesPanelProps {
  onClose: () => void;
}

// 格式化时间
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}分钟`;
  const hours = ms / 3_600_000;
  return hours === Math.floor(hours) ? `${hours}小时` : `${hours.toFixed(1)}小时`;
}

export default function RulesPanel({ onClose }: RulesPanelProps) {
  const cropList: CropId[] = ['wheat', 'carrot', 'tomato', 'strawberry', 'corn', 'pumpkin', 'watermelon', 'golden_apple'];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-12 overflow-y-auto" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden mb-12"
        onClick={e => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>📖</span> 游戏规则
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-6 text-sm text-slate-700">

          {/* ===== 基本玩法 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
              基本玩法
            </h3>
            <div className="space-y-2 pl-8">
              <p><b>种植：</b>点击空田地 → 打开种子商店 → 花积分购买种子种植</p>
              <p><b>生长：</b>作物在真实时间中生长，关掉页面也会继续。经历 <span className="text-green-700 font-medium">种子 → 幼苗 → 生长中 → 成熟</span> 四个阶段</p>
              <p><b>浇水：</b>生长过程中需要按时浇水，否则会减产甚至枯萎</p>
              <p><b>收获：</b>作物成熟后点击收获，积分入账</p>
            </div>
          </section>

          {/* ===== 积分规则 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-bold">2</span>
              积分计算
            </h3>
            <div className="space-y-2 pl-8">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 font-mono text-xs text-amber-800 text-center">
                最终积分 = 基础产出 × 天气倍率 × 浇水倍率 × 害虫倍率
              </div>
              <p><b>种子成本：</b>种植时立即从你的积分中扣除</p>
              <p><b>收获收益：</b>成熟后收获获得积分，实际金额受天气、浇水、害虫影响</p>
              <p><b>每日上限：</b>收获积分和其他游戏共享每日上限，达到后超出部分不计入</p>
            </div>
          </section>

          {/* ===== 作物一览 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-lime-100 text-lime-700 flex items-center justify-center text-xs font-bold">3</span>
              作物一览
            </h3>
            <div className="overflow-x-auto -mx-5 px-5">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="py-2 px-2 text-left font-semibold">作物</th>
                    <th className="py-2 px-2 text-right font-semibold">成本</th>
                    <th className="py-2 px-2 text-right font-semibold">产出</th>
                    <th className="py-2 px-2 text-right font-semibold">利润</th>
                    <th className="py-2 px-2 text-right font-semibold">生长</th>
                    <th className="py-2 px-2 text-right font-semibold">浇水</th>
                    <th className="py-2 px-2 text-center font-semibold">解锁</th>
                  </tr>
                </thead>
                <tbody>
                  {cropList.map(id => {
                    const c = CROPS[id];
                    return (
                      <tr key={id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <span className="mr-1">{c.icon}</span>{c.name}
                        </td>
                        <td className="py-1.5 px-2 text-right text-red-500">{c.seedCost}</td>
                        <td className="py-1.5 px-2 text-right text-green-600">{c.baseYield}</td>
                        <td className="py-1.5 px-2 text-right font-medium text-amber-600">+{c.baseYield - c.seedCost}</td>
                        <td className="py-1.5 px-2 text-right text-slate-500">{formatDuration(c.growthTime)}</td>
                        <td className="py-1.5 px-2 text-right text-blue-500">{formatDuration(c.waterInterval)}</td>
                        <td className="py-1.5 px-2 text-center text-slate-400">Lv.{c.unlockLevel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 mt-2 pl-8">
              * 产出为理想值，实际受天气/浇水/害虫影响
            </p>
          </section>

          {/* ===== 浇水规则 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">4</span>
              浇水规则
            </h3>
            <div className="space-y-2 pl-8">
              <p>每种作物有固定的<b>浇水间隔</b>（见上表），需要在间隔内至少浇一次水</p>
              <p>种植时自动算一次浇水，之后需要手动浇水或等雨天</p>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-1">
                <p className="text-blue-800"><b>超时惩罚：</b></p>
                <p className="text-blue-700">错过 1 个周期 → 产量 <b>80%</b></p>
                <p className="text-blue-700">错过 2 个周期 → 产量 <b>60%</b></p>
                <p className="text-red-600 font-medium">错过 3 个周期 → 作物枯萎！只能铲除</p>
              </div>
              <p>提示：可以用<b>「一键浇水」</b>按钮快速给所有田地浇水</p>
            </div>
          </section>

          {/* ===== 天气系统 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">5</span>
              天气系统
            </h3>
            <div className="space-y-2 pl-8">
              <p>每天北京时间 0 点随机生成一种天气，所有玩家当天看到<b>相同天气</b></p>
              <div className="space-y-1.5">
                {(['sunny', 'rainy', 'drought', 'windy', 'foggy'] as const).map(type => {
                  const w = WEATHERS[type];
                  const effects: string[] = [];
                  if (w.growthModifier !== 1) effects.push(`生长速度 ×${w.growthModifier}`);
                  if (w.yieldModifier !== 1) {
                    const pct = Math.round((w.yieldModifier - 1) * 100);
                    effects.push(`产量 ${pct > 0 ? '+' : ''}${pct}%`);
                  }
                  if (w.autoWater) effects.push('自动浇水');
                  if (w.pestModifier < 1) effects.push(`害虫概率 -${Math.round((1 - w.pestModifier) * 100)}%`);
                  if (w.pestModifier > 1) effects.push(`害虫概率 +${Math.round((w.pestModifier - 1) * 100)}%`);

                  return (
                    <div key={type} className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2">
                      <span className="text-base shrink-0">{w.icon}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800">{w.name}</span>
                        <span className="text-slate-400 ml-1">({w.probability}%)</span>
                        {effects.length > 0 && (
                          <span className="text-slate-500 ml-1">— {effects.join('、')}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ===== 害虫 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">6</span>
              害虫事件
            </h3>
            <div className="space-y-2 pl-8">
              <p>种植 <b>10 分钟后</b>开始，每 10 分钟有 <b>8%</b> 基础概率出现害虫（受天气修正）</p>
              <p>害虫出现后<b>每 10 分钟减产 15%</b>，最低减到 30%，拖得越久损失越大</p>
              <p>看到害虫图标后，点击田地上的<b>「除虫」</b>按钮即可清除</p>
              <p className="text-slate-500">小贴士：雾天和大风天害虫概率降低，雨天害虫概率减半</p>
            </div>
          </section>

          {/* ===== 农场等级 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold">7</span>
              农场升级
            </h3>
            <div className="space-y-2 pl-8">
              <p>每次收获获得<b>经验值</b>，经验累积到阈值后自动升级</p>
              <p>升级后解锁<b>更多田地</b>和<b>新作物</b></p>
              <div className="space-y-1.5">
                {([1, 2, 3, 4, 5] as FarmLevel[]).map(lv => {
                  const cfg = FARM_LEVELS[lv];
                  const newCrops = cfg.unlockedCrops.map(id => `${CROPS[id].icon}${CROPS[id].name}`);
                  return (
                    <div key={lv} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 text-xs">
                      <span className="font-bold text-purple-600 shrink-0">Lv.{lv}</span>
                      <span className="text-slate-700 font-medium">{cfg.title}</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-500">{cfg.plotCount}块田</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-500">{cfg.expRequired} EXP</span>
                      <span className="text-slate-400">|</span>
                      <span className="text-green-600">{newCrops.join(' ')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ===== 其他说明 ===== */}
          <section>
            <h3 className="font-bold text-slate-900 text-base mb-3 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-xs font-bold">!</span>
              其他说明
            </h3>
            <div className="space-y-2 pl-8">
              <p><b>铲除：</b>可以随时铲除田地上的作物（包括枯萎的），但<b>不退还</b>种子费用</p>
              <p><b>离线生长：</b>关闭页面后作物继续生长，回来时自动计算进度。但离线期间浇水超时也会正常计算减产或枯萎</p>
              <p><b>收获举例：</b>种一株草莓（成本 50），雨天 (+15% 产量)、浇水正常、无害虫 → 收获 120 × 1.15 = <b>138 积分</b>，净赚 88</p>
            </div>
          </section>
        </div>

        {/* 底部关闭 */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-3">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors"
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
