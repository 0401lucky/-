// src/app/games/tower/lib/constants.ts

/** 动画时长（毫秒） */
export const ANIM_WALK_DURATION = 600;
export const ANIM_ATTACK_DURATION = 400;
export const ANIM_POWERUP_DURATION = 500;
export const ANIM_DEATH_DURATION = 800;
export const ANIM_FLOOR_TRANSITION = 300;

/** Canvas 尺寸 */
export const CANVAS_WIDTH = 360;
export const CANVAS_HEIGHT = 480;
export const PIXEL_SCALE = 3;
export const SPRITE_SIZE = 16;

/** 颜色方案 */
export const COLORS = {
  bg: '#1a1a2e',
  brick: '#3d2b1f',
  brickLight: '#5c4033',
  floor: '#2d2d44',
  player: '#4fc3f7',
  playerOutline: '#0288d1',
  monster: '#ef5350',
  monsterOutline: '#b71c1c',
  addBuff: '#66bb6a',
  multiplyBuff: '#ffa726',
  text: '#ffffff',
  textShadow: '#000000',
  powerText: '#ffeb3b',
  floorText: '#80cbc4',
  deathFlash: '#ff1744',
} as const;
