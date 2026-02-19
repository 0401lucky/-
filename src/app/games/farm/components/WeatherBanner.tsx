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
    sunny: 'from-yellow-100/80 to-orange-50/80 border-yellow-200/60',
    rainy: 'from-blue-100/80 to-cyan-50/80 border-blue-200/60',
    drought: 'from-amber-100/80 to-orange-100/80 border-amber-300/60',
    windy: 'from-gray-100/80 to-slate-50/80 border-gray-200/60',
    foggy: 'from-slate-200/80 to-gray-100/80 border-slate-300/60',
  };

  const effectTexts: Record<WeatherType, string> = {
    sunny: '万里无云，正常生长',
    rainy: '自动浇水 / 生长+30% / 产量+15%',
    drought: '生长-30% / 产量-25% / 注意浇水！',
    windy: '生长-10% / 产量-10%',
    foggy: '生长-20% / 产量+5% / 害虫减少',
  };

  const weatherDecoration: Record<WeatherType, string> = {
    sunny: '☀️',
    rainy: '🌧️',
    drought: '🏜️',
    windy: '💨',
    foggy: '🌫️',
  };

  return (
    <div className={`bg-gradient-to-r ${bgMap[weather]} backdrop-blur-sm border rounded-xl px-4 py-3 flex items-center gap-3 animate-farm-plot-enter relative overflow-hidden`} style={{ animationDelay: '100ms' }}>
      {/* 微妙的动态背景 */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        {weather === 'sunny' && (
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-yellow-300 rounded-full blur-2xl" style={{ animation: 'farmSunRay 4s ease-in-out infinite' }} />
        )}
        {weather === 'rainy' && (
          <>
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="absolute w-0.5 h-3 bg-blue-400 rounded-full"
                style={{
                  left: `${15 + i * 18}%`,
                  top: '-12px',
                  animation: `farmRainFall ${0.6 + i * 0.1}s linear infinite`,
                  animationDelay: `${i * 0.15}s`,
                }}
              />
            ))}
          </>
        )}
      </div>

      <span className="text-2xl relative z-10 drop-shadow-sm">{weatherDecoration[weather]}</span>
      <div className="flex-1 min-w-0 relative z-10">
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
