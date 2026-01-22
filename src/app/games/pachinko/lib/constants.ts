
// 游戏画布尺寸
export const CANVAS_WIDTH = 400;
export const CANVAS_HEIGHT = 600;

// 弹珠配置
export const BALL_RADIUS = 10;
export const BALLS_PER_GAME = 5;

// 槽位配置
export const SLOT_SCORES = [5, 10, 20, 40, 80, 40, 20, 10, 5];
export const SLOT_COUNT = SLOT_SCORES.length;
export const SLOT_WIDTH = CANVAS_WIDTH / SLOT_COUNT;

// 钉子配置
export const PIN_RADIUS = 5;
export const PIN_ROWS = 10;
export const PIN_OFFSET = 30;  // 钉子起始高度

// 发射配置
export const LAUNCH_Y = 50;          // 发射位置 Y
export const LAUNCH_X = CANVAS_WIDTH / 2;  // 发射位置 X
export const MIN_POWER = 0.5;
export const MAX_POWER = 1.0;
export const MAX_ANGLE = 30;         // 最大偏移角度（度）

// 颜色配置
export const COLORS = {
  background: '#1a1a2e',
  ball: '#ffd700',
  pin: '#4a4a6a',
  slot5: '#3a3a5a',
  slot10: '#4a5a6a',
  slot20: '#5a6a7a',
  slot40: '#6a7a8a',
  slot80: '#ff6b6b',
  border: '#2a2a4e',
  text: '#ffffff',
};
