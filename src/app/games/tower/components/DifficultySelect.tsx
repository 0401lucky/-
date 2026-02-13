'use client';

import {
  DIFFICULTY_LABELS,
  DIFFICULTY_MODIFIERS,
  type TowerDifficulty,
} from '@/lib/tower-engine';

interface DifficultySelectProps {
  onSelect: (difficulty: TowerDifficulty) => void;
  disabled?: boolean;
}

const DIFFICULTIES: {
  key: TowerDifficulty;
  icon: string;
  color: string;
  borderColor: string;
  textColor: string;
  description: string;
  features: string[];
}[] = [
  {
    key: 'normal',
    icon: '🌿',
    color: 'from-emerald-400 to-green-500',
    borderColor: 'border-emerald-200',
    textColor: 'text-emerald-600',
    description: '标准挑战难度，适合所有玩家',
    features: ['怪物标准强度', '有安全路线保障', '正常陷阱概率'],
  },
  {
    key: 'hard',
    icon: '⚔️',
    color: 'from-orange-400 to-amber-500',
    borderColor: 'border-orange-200',
    textColor: 'text-orange-600',
    description: '怪物更强，迷雾更多，但积分 ×1.5',
    features: ['怪物强度 ×1.3', '迷雾概率 +15%', '安全路减少 30%'],
  },
  {
    key: 'hell',
    icon: '💀',
    color: 'from-red-500 to-rose-600',
    borderColor: 'border-red-200',
    textColor: 'text-red-600',
    description: '极限挑战，无安全路线，积分 ×2.5',
    features: ['怪物强度 ×1.6', '迷雾概率 +25%', '无安全路线保障'],
  },
];

export default function DifficultySelect({ onSelect, disabled }: DifficultySelectProps) {
  return (
    <div className="w-full max-w-3xl mx-auto">
      <h2 className="text-3xl font-black text-slate-800 text-center mb-2 tracking-tight">
        选择挑战难度
      </h2>
      <p className="text-center text-slate-400 text-sm mb-8 font-medium">
        难度越高，积分倍率越大
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {DIFFICULTIES.map((diff, idx) => {
          const mod = DIFFICULTY_MODIFIERS[diff.key];
          return (
            <button
              key={diff.key}
              onClick={() => onSelect(diff.key)}
              disabled={disabled}
              className={`
                group relative overflow-hidden rounded-[2rem] p-6
                bg-white/80 backdrop-blur-md border-4 ${diff.borderColor}
                hover:border-white hover:shadow-[0_15px_40px_-10px_rgba(0,0,0,0.1)]
                hover:-translate-y-2 active:scale-95 transition-all duration-300
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0
                animate-slide-up text-left
                shadow-lg shadow-black/5
              `}
              style={{
                animationDelay: `${idx * 100}ms`,
                animationFillMode: 'backwards',
              }}
            >
              <div
                className={`
                  absolute inset-0 opacity-0 group-hover:opacity-100
                  bg-gradient-to-br ${diff.color}
                  transition-opacity duration-500
                `}
              />

              <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                  <div className="text-5xl transform group-hover:scale-110 group-hover:rotate-12 transition-transform duration-300 origin-left filter drop-shadow-sm">
                    {diff.icon}
                  </div>
                  <div
                    className={`
                      bg-white/50 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider
                      ${diff.textColor} group-hover:text-white group-hover:bg-white/20 transition-colors
                    `}
                  >
                    ×{mod.scoreMult}
                  </div>
                </div>

                <h3
                  className={`text-2xl font-black ${diff.textColor} group-hover:text-white transition-colors mb-2`}
                >
                  {DIFFICULTY_LABELS[diff.key]}
                </h3>

                <p className="text-slate-500 group-hover:text-white/90 transition-colors text-sm mb-5 font-bold leading-relaxed">
                  {diff.description}
                </p>

                <div className="pt-3 border-t border-slate-100 group-hover:border-white/20 transition-colors space-y-1.5">
                  {diff.features.map((feat) => (
                    <div
                      key={feat}
                      className="flex items-center gap-2 text-sm"
                    >
                      <span className="text-slate-300 group-hover:text-white/50 transition-colors">
                        •
                      </span>
                      <span className="text-slate-500 group-hover:text-white/80 transition-colors font-bold">
                        {feat}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-center text-slate-400 text-xs mt-8 font-medium">
        所有难度均可触发主题楼层、祝福与诅咒系统
      </p>
    </div>
  );
}
