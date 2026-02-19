// src/app/games/farm/components/WeatherBanner.tsx

'use client';

import type { WeatherType } from '@/lib/types/farm';
import { WEATHERS } from '@/lib/farm-config';

interface WeatherBannerProps {
  weather: WeatherType;
}

export default function WeatherBanner({ weather }: WeatherBannerProps) {
  const config = WEATHERS[weather];

  const bgMap: Record<WeatherType, string> = {
    sunny: 'from-yellow-100 to-orange-50 border-yellow-200',
    rainy: 'from-blue-100 to-cyan-50 border-blue-200',
    drought: 'from-amber-100 to-orange-100 border-amber-300',
    windy: 'from-gray-100 to-slate-50 border-gray-200',
    foggy: 'from-slate-200 to-gray-100 border-slate-300',
  };

  const effectTexts: Record<WeatherType, string> = {
    sunny: '万里无云，正常生长',
    rainy: '自动浇水 / 生长+30% / 产量+15%',
    drought: '生长-30% / 产量-25% / 注意浇水！',
    windy: '生长-10% / 产量-10%',
    foggy: '生长-20% / 产量+5% / 害虫减少',
  };

  return (
    <div className={`bg-gradient-to-r ${bgMap[weather]} border rounded-xl px-4 py-3 flex items-center gap-3`}>
      <span className="text-2xl">{config.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-800 text-sm">
          今日天气：{config.name}
        </div>
        <div className="text-xs text-slate-500 truncate">
          {effectTexts[weather]}
        </div>
      </div>
    </div>
  );
}
