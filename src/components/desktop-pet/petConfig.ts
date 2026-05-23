import type { PetType } from '@/lib/types/farm-v2';

/** 当前已实现桌宠素材的宠物类型 */
export type DesktopPetType = PetType;

export const SUPPORTED_DESKTOP_PETS: ReadonlyArray<DesktopPetType> = ['cat', 'red_panda', 'dog', 'rabbit'];

export function isSupportedDesktopPet(type: PetType): type is DesktopPetType {
  return (SUPPORTED_DESKTOP_PETS as ReadonlyArray<PetType>).includes(type);
}

export type PetStateName =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export interface PetStateDef {
  /** 单循环时长（毫秒） */
  durationMs: number;
  /** 帧数 */
  frames: number;
}

export interface PetAssetConfig {
  type: DesktopPetType;
  cellWidth: number;
  cellHeight: number;
  /** strip 文件目录，结尾不含斜杠 */
  stripBaseUrl: string;
  states: Record<PetStateName, PetStateDef>;
}

const COMMON_STATES: Record<PetStateName, PetStateDef> = {
  idle: { durationMs: 1400, frames: 60 },
  'running-right': { durationMs: 800, frames: 60 },
  'running-left': { durationMs: 800, frames: 60 },
  waving: { durationMs: 1000, frames: 60 },
  jumping: { durationMs: 900, frames: 60 },
  failed: { durationMs: 1300, frames: 60 },
  waiting: { durationMs: 1600, frames: 60 },
  running: { durationMs: 950, frames: 60 },
  review: { durationMs: 1300, frames: 60 },
};

export const PET_ASSETS: Record<DesktopPetType, PetAssetConfig> = {
  cat: {
    type: 'cat',
    cellWidth: 192,
    cellHeight: 208,
    stripBaseUrl: '/desktop-pet/cat/strips',
    states: COMMON_STATES,
  },
  red_panda: {
    type: 'red_panda',
    cellWidth: 192,
    cellHeight: 208,
    stripBaseUrl: '/desktop-pet/red_panda/strips',
    states: COMMON_STATES,
  },
  dog: {
    type: 'dog',
    cellWidth: 192,
    cellHeight: 208,
    stripBaseUrl: '/desktop-pet/dog/strips',
    states: COMMON_STATES,
  },
  rabbit: {
    type: 'rabbit',
    cellWidth: 192,
    cellHeight: 208,
    stripBaseUrl: '/desktop-pet/rabbit/strips',
    states: COMMON_STATES,
  },
};

export const PET_DISPLAY_NAME: Record<DesktopPetType, string> = {
  cat: '小白猫',
  red_panda: '红熊猫',
  dog: '边牧',
  rabbit: '小兔子',
};

/** 桌宠默认显示比例（相对 192x208 原始单元） */
export const DEFAULT_PET_SCALE = 0.55;

/** localStorage 键 */
export const LS_HIDDEN_KEY = 'desktop-pet:hidden';
export const LS_POSITION_KEY = 'desktop-pet:position-x';

export interface DesktopPetVisibilityChangeDetail {
  hidden: boolean;
}

/** 自定义事件：同一个页面内切换桌宠显示状态时同步组件 */
export const PET_VISIBILITY_EVENT = 'desktop-pet:visibility-changed';

/** 行为参数 */
export const BEHAVIOR = {
  /** 单次行为段最短/最长时长（毫秒） */
  segmentMinMs: 3000,
  segmentMaxMs: 6500,
  /** 行走速度（屏幕像素每秒），按 scale 后计算 */
  walkSpeedPx: 60,
  /** 跳跃高度（像素） */
  jumpHeightPx: 60,
  /** 跳跃时长（毫秒），与 jumping sprite 时长一致，确保动画完整播放 */
  jumpDurationMs: 900,
  /** 点击判定阈值：按住小于该时长且未拖拽视为单击 */
  clickThresholdMs: 220,
  /** 拖拽阈值：移动距离小于该值视为未拖拽 */
  dragThresholdPx: 4,
  /** 距底部留白（像素），用于初始 y 计算 */
  groundOffset: 12,
};

/** 自定义事件：farm 页领养/状态变化后 dispatch，让桌宠立即重新拉取 */
export const PET_UPDATED_EVENT = 'farm:pet-updated';
