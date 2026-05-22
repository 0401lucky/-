'use client';

import React from 'react';
import type { PetType, PetStage } from '@/lib/types/farm-v2';

export type PetExpression =
  | 'normal'
  | 'happy'
  | 'blush'
  | 'love'
  | 'surprised'
  | 'sleepy'
  | 'angry'
  | 'sad'
  | 'excited';

type PetEmotion = PetExpression | 'working';

interface Props {
  type: PetType;
  stage: PetStage;
  size?: number;
  emotion?: PetEmotion;
  className?: string;
}

function petScale(stage: PetStage): number {
  if (stage === 'child') return 0.9;
  return 1;
}

function petOffset(stage: PetStage): number {
  if (stage === 'child') return 7;
  return 0;
}

export default function PetSprite({ type, stage, size = 100, emotion = 'normal', className }: Props) {
  const scale = petScale(stage);
  const offset = petOffset(stage);
  const sprite = PET_SPRITES[type][stage];
  const expression = normalizeExpression(emotion);
  const animationClass = emotion === 'working' ? 'farm-pet-walking' : 'farm-pet-bouncing';

  return (
    <svg
      className={`${className || ''} farm-pet-sprite ${animationClass}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${PET_ACCESSIBLE_LABEL[type]}，${PET_EXPRESSION_LABEL[expression]}`}
      style={{ overflow: 'visible' }}
    >
      <ellipse cx="50" cy="92" rx={stage === 'child' ? 21 : 28} ry="5" fill="rgba(15,23,42,0.18)" />
      <g transform={`translate(50 ${54 + offset}) scale(${scale}) translate(-50 -54)`}>
        <image
          className="farm-pet-pixel-image"
          href={`/images/farm/pets/${sprite.dir}/${stage}/${expression}.png`}
          x={sprite.x}
          y={sprite.y}
          width={sprite.width}
          height={sprite.height}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    </svg>
  );
}

interface PetSpriteConfig {
  dir: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PET_SPRITES: Record<PetType, Record<PetStage, PetSpriteConfig>> = {
  cat: {
    child: { dir: 'cat', x: 4, y: 2, width: 92, height: 92 },
    adult: { dir: 'cat', x: 3, y: 0, width: 94, height: 96 },
  },
  dog: {
    child: { dir: 'dog', x: 3, y: 2, width: 94, height: 92 },
    adult: { dir: 'dog', x: 2, y: 0, width: 96, height: 96 },
  },
  rabbit: {
    child: { dir: 'rabbit', x: 5, y: 2, width: 90, height: 92 },
    adult: { dir: 'rabbit', x: 4, y: 0, width: 92, height: 96 },
  },
  red_panda: {
    child: { dir: 'red_panda', x: 2, y: 2, width: 96, height: 92 },
    adult: { dir: 'red_panda', x: 0, y: 0, width: 100, height: 96 },
  },
};

const PET_ACCESSIBLE_LABEL: Record<PetType, string> = {
  cat: '可爱的白色像素小猫宠物',
  dog: '可爱的黑白像素边牧宠物',
  rabbit: '可爱的白色像素兔子宠物',
  red_panda: '可爱的红熊猫像素宠物',
};

const PET_EXPRESSION_LABEL: Record<PetExpression, string> = {
  normal: '普通表情',
  happy: '开心表情',
  blush: '脸红表情',
  love: '爱心眼表情',
  surprised: '惊讶表情',
  sleepy: '困倦表情',
  angry: '生气表情',
  sad: '哭泣表情',
  excited: '星星眼表情',
};

function normalizeExpression(emotion: PetEmotion): PetExpression {
  if (emotion === 'working') return 'excited';
  if (emotion === 'normal') return 'normal';
  return emotion;
}
