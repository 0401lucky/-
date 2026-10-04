import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: '软软西瓜 · 游戏中心',
  description: '拖动投放软弹水果，合成大西瓜，挑战赢取游戏积分。',
};

export default function WatermelonLayout({ children }: { children: ReactNode }) {
  return children;
}
