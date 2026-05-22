import seedrandom from 'seedrandom';

export const ROGUELITE_VIEW_RADIUS = 3;
export const ROGUELITE_SIGHT_RADIUS = 1;
export const ROGUELITE_EXPANDED_SIGHT_RADIUS = 2;
export const ROGUELITE_BOARD_VIEW_RADIUS = ROGUELITE_VIEW_RADIUS;
export const ROGUELITE_VIEW_SIZE = ROGUELITE_VIEW_RADIUS * 2 + 1;
export const ROGUELITE_BOARD_SIZE = ROGUELITE_VIEW_SIZE;
export const ROGUELITE_MAX_FLOOR = 3;
export const ROGUELITE_INITIAL_HP = 30;
export const ROGUELITE_INITIAL_STEPS = 64;
export const ROGUELITE_MAX_COORDINATE = 1_000_000;

export type RogueliteCellType =
  | 'start'
  | 'empty'
  | 'monster'
  | 'stardust'
  | 'relic'
  | 'event'
  | 'shop'
  | 'rift'
  | 'chest'
  | 'exit'
  | 'boss';

export type RogueliteRisk = 'safe' | 'low' | 'medium' | 'high';

export type RogueliteRelicType =
  | 'edge_mender'
  | 'glass_aegis'
  | 'star_compass'
  | 'key_spring'
  | 'rift_filter'
  | 'battle_charm'
  | 'treasure_echo'
  | 'starlight_lens'
  | 'dust_collector'
  | 'prism_vial'
  | 'warden_glyph'
  | 'spoils_magnet'
  | 'meteor_boots';

export const ROGUELITE_RELIC_LABELS: Record<RogueliteRelicType, string> = {
  edge_mender: '环带回声',
  glass_aegis: '琉璃星盾',
  star_compass: '星门罗盘',
  key_spring: '钥匙泉',
  rift_filter: '裂隙滤镜',
  battle_charm: '锋芒护符',
  treasure_echo: '宝箱回响',
  starlight_lens: '星辉透镜',
  dust_collector: '集尘瓶',
  prism_vial: '棱光小瓶',
  warden_glyph: '守护刻印',
  spoils_magnet: '战利磁芯',
  meteor_boots: '流星靴',
};

export const ROGUELITE_RELIC_DESCRIPTIONS: Record<RogueliteRelicType, string> = {
  edge_mender: '每层首次抵达新的探索环带时回复 2 点生命',
  glass_aegis: '本局首次受到伤害时，实际伤害减半',
  star_compass: '显示星门精确坐标，星门进入视野时会提前显形',
  key_spring: '进入新层时额外获得 1 把钥匙',
  rift_filter: '裂隙伤害降低 3 点',
  battle_charm: '战斗攻击力 +2',
  treasure_echo: '宝箱额外产出 8 星尘',
  starlight_lens: '当前视野扩大一圈，可照亮外圈 16 格',
  dust_collector: '星尘格额外获得 4 星尘',
  prism_vial: '每次回复生命时额外回复 2 点',
  warden_glyph: '进入战斗时获得 3 护盾',
  spoils_magnet: '击败怪物额外获得 5 星尘',
  meteor_boots: '进入新层时额外获得 8 行动步数',
};

export const ROGUELITE_RELIC_ICONS: Record<RogueliteRelicType, string> = {
  edge_mender: '◇',
  glass_aegis: '⬡',
  star_compass: '✦',
  key_spring: '⌁',
  rift_filter: '◌',
  battle_charm: '✧',
  treasure_echo: '◆',
  starlight_lens: '◈',
  dust_collector: '✺',
  prism_vial: '◍',
  warden_glyph: '✚',
  spoils_magnet: '✹',
  meteor_boots: '↯',
};

export interface RoguelitePosition {
  row: number;
  col: number;
}

export interface RogueliteMonster {
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  rewardStardust: number;
  elite?: boolean;
}

export interface RogueliteEventOption {
  id: string;
  label: string;
  description: string;
}

export interface RogueliteShopItem {
  id: string;
  label: string;
  description: string;
  cost: number;
  kind: 'heal' | 'key' | 'relic' | 'scout';
  relic?: RogueliteRelicType;
}

export interface RogueliteChestReward {
  stardust: number;
  relic?: RogueliteRelicType;
}

export interface RogueliteCell {
  id: string;
  position: RoguelitePosition;
  type: RogueliteCellType;
  risk: RogueliteRisk;
  hint: string;
  label: string;
  icon: string;
  stardust?: number;
  damage?: number;
  monster?: RogueliteMonster;
  relic?: RogueliteRelicType;
  eventOptions?: RogueliteEventOption[];
  shopItems?: RogueliteShopItem[];
  chestReward?: RogueliteChestReward;
}

export interface RogueliteBoard {
  floor: number;
  startPosition: RoguelitePosition;
  exitPosition: RoguelitePosition;
  cells: RogueliteCell[];
}

export interface RoguelitePlayerState {
  hp: number;
  maxHp: number;
  shield: number;
  stardust: number;
  keys: number;
  stepsRemaining: number;
  attack: number;
  position: RoguelitePosition;
  relics: RogueliteRelicType[];
  monstersDefeated: number;
  chestsOpened: number;
  eventsResolved: number;
  floorsCleared: number;
  exploredCells: number;
  usedAegis: boolean;
  ringHealKeys: string[];
}

export type RoguelitePending =
  | { type: 'combat'; position: RoguelitePosition; monster: RogueliteMonster; round: number; isBoss: boolean }
  | { type: 'event'; position: RoguelitePosition; options: RogueliteEventOption[] }
  | { type: 'shop'; position: RoguelitePosition; items: RogueliteShopItem[] }
  | { type: 'chest'; position: RoguelitePosition; reward: RogueliteChestReward };

export type RogueliteGameStatus = 'playing' | 'escaped' | 'defeated';

export interface RogueliteGameState {
  seed: string;
  floor: number;
  board: RogueliteBoard;
  player: RoguelitePlayerState;
  visited: string[];
  revealed: string[];
  pending?: RoguelitePending;
  status: RogueliteGameStatus;
  defeatedReason?: string;
  cellOverrides?: Record<string, RogueliteCell>;
}

export type RogueliteAction =
  | { type: 'move'; to: RoguelitePosition }
  | { type: 'combat'; style: 'attack' | 'guard' | 'skill' }
  | { type: 'event'; optionId: string }
  | { type: 'shop'; itemId: string }
  | { type: 'chest'; open: boolean }
  | { type: 'escape' };

export interface RogueliteActionOutcome {
  message: string;
  damageTaken: number;
  shieldBlocked: number;
  stardustDelta: number;
  keyDelta: number;
  hpDelta: number;
  relicGained?: RogueliteRelicType;
  floorChanged: boolean;
  combatEnded: boolean;
  status: RogueliteGameStatus;
}

export type RogueliteActionResult =
  | { ok: true; state: RogueliteGameState; outcome: RogueliteActionOutcome }
  | { ok: false; message: string };

export interface RogueliteCellView {
  id: string;
  position: RoguelitePosition;
  viewPosition: RoguelitePosition;
  relativePosition: RoguelitePosition;
  state: 'hidden' | 'scouted' | 'revealed' | 'current';
  type: RogueliteCellType | 'hidden';
  risk: RogueliteRisk;
  hint: string;
  label: string;
  icon: string;
  adjacent: boolean;
  exhausted: boolean;
  stardust?: number;
  damage?: number;
  monster?: RogueliteMonster;
  relic?: RogueliteRelicType;
  eventOptions?: RogueliteEventOption[];
  shopItems?: RogueliteShopItem[];
  chestReward?: RogueliteChestReward;
}

export interface RogueliteStarGateView {
  position?: RoguelitePosition;
  distance: number;
  direction: string;
  exact: boolean;
  endlessUnlocked: boolean;
}

export interface RogueliteStateView {
  floor: number;
  boardSize: number;
  viewportRadius: number;
  sightRadius: number;
  board: RogueliteCellView[];
  player: RoguelitePlayerState;
  starGate: RogueliteStarGateView;
  pending?: RoguelitePending;
  status: RogueliteGameStatus;
  defeatedReason?: string;
  scorePreview: RogueliteScoreBreakdown;
}

export interface RogueliteScoreBreakdown {
  floorPoints: number;
  explorationPoints: number;
  monsterPoints: number;
  stardustPoints: number;
  lifePoints: number;
  relicPoints: number;
  chestPoints: number;
  winBonus: number;
  total: number;
}

type Rng = () => number;

export const ROGUELITE_START_POSITION: RoguelitePosition = { row: 0, col: 0 };

const ALL_RELICS: RogueliteRelicType[] = [
  'edge_mender',
  'glass_aegis',
  'star_compass',
  'key_spring',
  'rift_filter',
  'battle_charm',
  'treasure_echo',
  'starlight_lens',
  'dust_collector',
  'prism_vial',
  'warden_glyph',
  'spoils_magnet',
  'meteor_boots',
];

const MONSTER_NAMES = ['星尘守卫', '碎晶爪牙', '微光游魂', '棱镜猎手'];

export function createRogueliteRng(seed: string): Rng {
  return seedrandom(seed);
}

export function positionKey(position: RoguelitePosition): string {
  return `${position.row},${position.col}`;
}

export function isValidWorldPosition(position: RoguelitePosition): boolean {
  return (
    Number.isInteger(position.row)
    && Number.isInteger(position.col)
    && Math.abs(position.row) <= ROGUELITE_MAX_COORDINATE
    && Math.abs(position.col) <= ROGUELITE_MAX_COORDINATE
  );
}

export function isInsideBoard(position: RoguelitePosition): boolean {
  return isValidWorldPosition(position);
}

export function isAdjacentPosition(a: RoguelitePosition, b: RoguelitePosition): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function samePosition(a: RoguelitePosition, b: RoguelitePosition): boolean {
  return a.row === b.row && a.col === b.col;
}

function distanceFromStart(position: RoguelitePosition): number {
  return Math.abs(position.row) + Math.abs(position.col);
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickOne<T>(rng: Rng, values: T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function shuffle<T>(rng: Rng, values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function uniquePush(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function normalizeFloor(floor: number): number {
  return Math.max(1, Math.floor(Number.isFinite(floor) ? floor : 1));
}

function getCellIcon(type: RogueliteCellType): string {
  switch (type) {
    case 'start': return '⌂';
    case 'monster': return '✕';
    case 'boss': return '♛';
    case 'stardust': return '✦';
    case 'relic': return '◇';
    case 'event': return '?';
    case 'shop': return '¤';
    case 'rift': return '◌';
    case 'chest': return '□';
    case 'exit': return '◎';
    default: return '·';
  }
}

function getCellLabel(type: RogueliteCellType): string {
  switch (type) {
    case 'start': return '起点';
    case 'monster': return '怪物';
    case 'boss': return '守门者';
    case 'stardust': return '星尘';
    case 'relic': return '遗物';
    case 'event': return '事件';
    case 'shop': return '商店';
    case 'rift': return '裂隙';
    case 'chest': return '宝箱';
    case 'exit': return '星门';
    default: return '空格';
  }
}

function getRiskForType(type: RogueliteCellType, floor: number): RogueliteRisk {
  if (type === 'boss' || type === 'rift') return 'high';
  if (type === 'monster') return floor >= 3 ? 'high' : 'medium';
  if (type === 'event' || type === 'chest' || type === 'exit') return 'medium';
  if (type === 'relic' || type === 'stardust') return 'low';
  return 'safe';
}

function getHintForType(type: RogueliteCellType, floor: number): string {
  switch (type) {
    case 'monster': return floor >= 3 ? '强烈星压' : '低吼回声';
    case 'boss': return '门前有巨大影子';
    case 'stardust': return '微光聚集';
    case 'relic': return '古老星纹';
    case 'event': return '命运岔路';
    case 'shop': return '温暖灯火';
    case 'rift': return '空间破碎';
    case 'chest': return '金属轻响';
    case 'exit': return '远处星门';
    case 'start': return '安全营地';
    default: return '平静星砂';
  }
}

function buildMonster(rng: Rng, floor: number, boss = false): RogueliteMonster {
  if (boss) {
    const hp = 28 + Math.min(10, floor) * 7;
    return {
      name: floor <= ROGUELITE_MAX_FLOOR ? '星门守望者' : '无尽星门守望者',
      hp,
      maxHp: hp,
      attack: 7 + Math.min(10, floor) * 2,
      rewardStardust: 24 + Math.min(10, floor) * 6,
      elite: true,
    };
  }

  const eliteChance = Math.min(0.36, 0.12 + floor * 0.04);
  const elite = floor >= 2 && rng() < eliteChance;
  const hp = randInt(rng, 8 + floor * 3, 13 + floor * 5) + (elite ? 7 : 0);
  return {
    name: elite ? '精英棱镜猎手' : pickOne(rng, MONSTER_NAMES),
    hp,
    maxHp: hp,
    attack: randInt(rng, 3 + floor, 5 + floor * 2) + (elite ? 2 : 0),
    rewardStardust: randInt(rng, 6 + floor * 2, 11 + floor * 4) + (elite ? 6 : 0),
    ...(elite ? { elite } : {}),
  };
}

function buildEventOptions(rng: Rng): RogueliteEventOption[] {
  const pool: RogueliteEventOption[] = [
    { id: 'star_key', label: '折下一枚星钥', description: '失去 4 生命，获得 1 钥匙与 8 星尘' },
    { id: 'quiet_blessing', label: '接受静默祝福', description: '回复 3 生命，并获得 5 护盾' },
    { id: 'risky_map', label: '解读残破星图', description: '消耗最多 6 星尘，揭示附近格子' },
    { id: 'shard_oath', label: '立下晶片誓约', description: '当前生命 -3，最大生命 +3，攻击 +1' },
    { id: 'dust_gamble', label: '投入星尘赌局', description: '失去 5 星尘，获得 16 星尘或受到 4 伤害' },
    { id: 'shield_cache', label: '开启护盾匣', description: '消耗最多 4 星尘，获得 8 护盾' },
    { id: 'dust_bloom', label: '采摘星尘花', description: '失去 3 生命，获得 18 星尘' },
    { id: 'key_trade', label: '与钥灵交易', description: '消耗 10 星尘，不足部分失去生命，获得 2 把钥匙' },
    { id: 'blade_forge', label: '淬炼星刃', description: '消耗 8 星尘，不足部分失去生命，攻击 +2' },
    { id: 'rest_cocoon', label: '进入静息星茧', description: '消耗 1 把钥匙回复 12 生命；没有钥匙则回复 4 生命' },
    { id: 'time_spark', label: '点燃时光火花', description: '失去 2 生命，获得 10 行动步数' },
    { id: 'relic_mirror', label: '凝视遗物镜', description: '消耗 10 星尘，不足部分失去生命，获得 1 个随机遗物' },
    { id: 'rift_survey', label: '校准裂隙测仪', description: '获得 4 护盾并揭示周围格子，但受到 2 伤害' },
    { id: 'life_exchange', label: '献出星核余温', description: '最大生命 -2，获得 1 钥匙、6 护盾与 10 星尘' },
    { id: 'compass_pulse', label: '释放罗盘脉冲', description: '消耗最多 4 星尘，揭示周围格子并获得 6 行动步数' },
  ];
  return shuffle(rng, pool).slice(0, 2);
}

function buildShopItems(rng: Rng, floor: number): RogueliteShopItem[] {
  const relic = pickOne(rng, ALL_RELICS);
  return [
    {
      id: 'heal',
      label: '星露药剂',
      description: `回复 ${8 + floor * 2} 生命`,
      cost: 9 + floor * 2,
      kind: 'heal',
    },
    {
      id: 'key',
      label: '秘银星钥',
      description: '获得 1 把钥匙',
      cost: 8 + floor,
      kind: 'key',
    },
    {
      id: `relic:${relic}`,
      label: ROGUELITE_RELIC_LABELS[relic],
      description: ROGUELITE_RELIC_DESCRIPTIONS[relic],
      cost: 18 + floor * 3,
      kind: 'relic',
      relic,
    },
    {
      id: 'scout',
      label: '星图碎片',
      description: '揭示周围 8 格',
      cost: 6,
      kind: 'scout',
    },
  ];
}

function makeCell(
  rng: Rng,
  floor: number,
  position: RoguelitePosition,
  type: RogueliteCellType,
): RogueliteCell {
  const base = {
    id: `${floor}:${position.row}:${position.col}`,
    position: { ...position },
    type,
    risk: getRiskForType(type, floor),
    hint: getHintForType(type, floor),
    label: getCellLabel(type),
    icon: getCellIcon(type),
  };

  if (type === 'monster') {
    return { ...base, monster: buildMonster(rng, floor) };
  }
  if (type === 'boss') {
    return { ...base, monster: buildMonster(rng, floor, true) };
  }
  if (type === 'stardust') {
    return { ...base, stardust: randInt(rng, 7 + floor * 2, 13 + floor * 4) };
  }
  if (type === 'relic') {
    return { ...base, relic: pickOne(rng, ALL_RELICS) };
  }
  if (type === 'event') {
    return { ...base, eventOptions: buildEventOptions(rng) };
  }
  if (type === 'shop') {
    return { ...base, shopItems: buildShopItems(rng, floor) };
  }
  if (type === 'rift') {
    return { ...base, damage: randInt(rng, 5 + floor, 8 + floor * 2) };
  }
  if (type === 'chest') {
    const hasRelic = rng() < 0.45;
    return {
      ...base,
      chestReward: {
        stardust: randInt(rng, 12 + floor * 4, 22 + floor * 5),
        ...(hasRelic ? { relic: pickOne(rng, ALL_RELICS) } : {}),
      },
    };
  }

  return base;
}

export function getRogueliteExitPosition(seed: string, floor: number): RoguelitePosition {
  const safeFloor = normalizeFloor(floor);
  const rng = createRogueliteRng(`${seed}:floor:${safeFloor}:exit`);
  const distance = safeFloor === 1
    ? 6
    : safeFloor === 2
      ? 9
      : safeFloor === 3
        ? 12
        : 12 + Math.min(16, (safeFloor - 3) * 2);
  const rowAbs = randInt(rng, 0, distance);
  const colAbs = distance - rowAbs;
  const row = rowAbs === 0 ? 0 : rowAbs * (rng() < 0.5 ? -1 : 1);
  const col = colAbs === 0 ? 0 : colAbs * (rng() < 0.5 ? -1 : 1);
  return { row, col };
}

function getBossGuardPosition(exitPosition: RoguelitePosition): RoguelitePosition {
  const rowStep = exitPosition.row === 0 ? 0 : exitPosition.row > 0 ? 1 : -1;
  const colStep = exitPosition.col === 0 ? 0 : exitPosition.col > 0 ? 1 : -1;
  if (Math.abs(exitPosition.row) >= Math.abs(exitPosition.col) && rowStep !== 0) {
    return { row: exitPosition.row - rowStep, col: exitPosition.col };
  }
  return { row: exitPosition.row, col: exitPosition.col - colStep };
}

function chooseProceduralCellType(rng: Rng, floor: number, position: RoguelitePosition): RogueliteCellType {
  const distance = distanceFromStart(position);
  if (distance <= 1) {
    const roll = rng();
    if (roll < 0.55) return 'empty';
    if (roll < 0.86) return 'stardust';
    return 'event';
  }

  const depth = Math.min(10, Math.max(0, floor - 1));
  const ring = Math.min(10, Math.floor(distance / 4));
  const monsterWeight = Math.min(0.34, 0.16 + depth * 0.02 + ring * 0.012);
  const riftWeight = Math.min(0.20, (floor >= 2 ? 0.055 : 0.025) + depth * 0.01 + ring * 0.01);
  const chestWeight = Math.min(0.11, 0.055 + ring * 0.006);
  const relicWeight = Math.min(0.09, 0.06 + floor * 0.004);
  const shopWeight = distance % 7 === 0 ? 0.085 : 0.035;
  const eventWeight = 0.14;
  const stardustWeight = Math.max(0.16, 0.26 - depth * 0.01);

  const roll = rng();
  let cursor = monsterWeight;
  if (roll < cursor) return 'monster';
  cursor += riftWeight;
  if (roll < cursor) return 'rift';
  cursor += stardustWeight;
  if (roll < cursor) return 'stardust';
  cursor += eventWeight;
  if (roll < cursor) return 'event';
  cursor += relicWeight;
  if (roll < cursor) return 'relic';
  cursor += chestWeight;
  if (roll < cursor) return 'chest';
  cursor += shopWeight;
  if (roll < cursor) return 'shop';
  return 'empty';
}

export function generateRogueliteCell(
  seed: string,
  floor: number,
  position: RoguelitePosition,
  exitPosition: RoguelitePosition = getRogueliteExitPosition(seed, floor),
): RogueliteCell {
  const safeFloor = normalizeFloor(floor);
  const rng = createRogueliteRng(`${seed}:cell:${safeFloor}:${position.row}:${position.col}`);
  if (samePosition(position, ROGUELITE_START_POSITION)) {
    return makeCell(rng, safeFloor, position, 'start');
  }
  if (samePosition(position, exitPosition)) {
    return makeCell(rng, safeFloor, position, 'exit');
  }
  if (safeFloor >= 3 && samePosition(position, getBossGuardPosition(exitPosition))) {
    return makeCell(rng, safeFloor, position, 'boss');
  }
  return makeCell(rng, safeFloor, position, chooseProceduralCellType(rng, safeFloor, position));
}

export function generateRogueliteBoard(seed: string, floor: number): RogueliteBoard {
  const safeFloor = normalizeFloor(floor);
  return {
    floor: safeFloor,
    startPosition: { ...ROGUELITE_START_POSITION },
    exitPosition: getRogueliteExitPosition(seed, safeFloor),
    cells: [],
  };
}

function cloneMonster(monster: RogueliteMonster): RogueliteMonster {
  return { ...monster };
}

function cloneCell(cell: RogueliteCell): RogueliteCell {
  return {
    ...cell,
    position: { ...cell.position },
    ...(cell.monster ? { monster: cloneMonster(cell.monster) } : {}),
    ...(cell.eventOptions ? { eventOptions: cell.eventOptions.map((option) => ({ ...option })) } : {}),
    ...(cell.shopItems ? { shopItems: cell.shopItems.map((item) => ({ ...item })) } : {}),
    ...(cell.chestReward ? { chestReward: { ...cell.chestReward } } : {}),
  };
}

function cloneCellOverrides(overrides: Record<string, RogueliteCell> | undefined): Record<string, RogueliteCell> | undefined {
  if (!overrides) return undefined;
  return Object.fromEntries(Object.entries(overrides).map(([key, cell]) => [key, cloneCell(cell)]));
}

export function cloneRogueliteState(state: RogueliteGameState): RogueliteGameState {
  const legacyPlayer = state.player as RoguelitePlayerState & { edgeHealFloors?: number[] };
  return {
    seed: state.seed,
    floor: normalizeFloor(state.floor),
    board: {
      floor: normalizeFloor(state.board.floor || state.floor),
      startPosition: { ...ROGUELITE_START_POSITION },
      exitPosition: { ...(state.board.exitPosition ?? getRogueliteExitPosition(state.seed, state.floor)) },
      cells: [],
    },
    player: {
      ...state.player,
      position: { ...state.player.position },
      relics: [...state.player.relics],
      exploredCells: Math.max(1, state.player.exploredCells ?? state.visited.length),
      ringHealKeys: [...(state.player.ringHealKeys ?? legacyPlayer.edgeHealFloors?.map((floor) => `${floor}:1`) ?? [])],
    },
    visited: [...state.visited],
    revealed: [...state.revealed],
    ...(state.pending ? { pending: clonePending(state.pending) } : {}),
    status: state.status,
    ...(state.defeatedReason ? { defeatedReason: state.defeatedReason } : {}),
    ...(state.cellOverrides ? { cellOverrides: cloneCellOverrides(state.cellOverrides) } : {}),
  };
}

function clonePending(pending: RoguelitePending): RoguelitePending {
  if (pending.type === 'combat') {
    return {
      type: 'combat',
      position: { ...pending.position },
      monster: cloneMonster(pending.monster),
      round: pending.round,
      isBoss: pending.isBoss,
    };
  }
  if (pending.type === 'event') {
    return {
      type: 'event',
      position: { ...pending.position },
      options: pending.options.map((option) => ({ ...option })),
    };
  }
  if (pending.type === 'shop') {
    return {
      type: 'shop',
      position: { ...pending.position },
      items: pending.items.map((item) => ({ ...item })),
    };
  }
  return {
    type: 'chest',
    position: { ...pending.position },
    reward: { ...pending.reward },
  };
}

export function createInitialRogueliteState(seed: string): RogueliteGameState {
  const board = generateRogueliteBoard(seed, 1);
  return {
    seed,
    floor: 1,
    board,
    player: {
      hp: ROGUELITE_INITIAL_HP,
      maxHp: ROGUELITE_INITIAL_HP,
      shield: 0,
      stardust: 0,
      keys: 1,
      stepsRemaining: ROGUELITE_INITIAL_STEPS,
      attack: 6,
      position: { ...ROGUELITE_START_POSITION },
      relics: [],
      monstersDefeated: 0,
      chestsOpened: 0,
      eventsResolved: 0,
      floorsCleared: 0,
      exploredCells: 1,
      usedAegis: false,
      ringHealKeys: [],
    },
    visited: [positionKey(ROGUELITE_START_POSITION)],
    revealed: [],
    status: 'playing',
  };
}

function getCellAt(state: RogueliteGameState, position: RoguelitePosition): RogueliteCell {
  const key = positionKey(position);
  const override = state.cellOverrides?.[key];
  if (override) {
    return cloneCell(override);
  }
  return generateRogueliteCell(state.seed, state.floor, position, state.board.exitPosition);
}

function hasRelic(state: RogueliteGameState, relic: RogueliteRelicType): boolean {
  return state.player.relics.includes(relic);
}

function addRelic(state: RogueliteGameState, relic: RogueliteRelicType): { gained: boolean; stardustDelta: number } {
  if (state.player.relics.includes(relic)) {
    state.player.stardust += 12;
    return { gained: false, stardustDelta: 12 };
  }
  state.player.relics.push(relic);
  return { gained: true, stardustDelta: 0 };
}

function healPlayer(state: RogueliteGameState, amount: number): number {
  const before = state.player.hp;
  const bonus = amount > 0 && hasRelic(state, 'prism_vial') ? 2 : 0;
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + Math.max(0, amount + bonus));
  return state.player.hp - before;
}

function revealAround(state: RogueliteGameState, center: RoguelitePosition): void {
  const next = [...state.revealed];
  for (let row = center.row - 1; row <= center.row + 1; row += 1) {
    for (let col = center.col - 1; col <= center.col + 1; col += 1) {
      const position = { row, col };
      if (isValidWorldPosition(position)) {
        const key = positionKey(position);
        if (!state.visited.includes(key) && !next.includes(key)) {
          next.push(key);
        }
      }
    }
  }
  state.revealed = next;
}

function defeat(state: RogueliteGameState, reason: string): void {
  state.status = 'defeated';
  state.defeatedReason = reason;
  state.pending = undefined;
  state.player.hp = Math.max(0, state.player.hp);
}

function applyDamage(
  state: RogueliteGameState,
  rawAmount: number,
  source: 'combat' | 'rift' | 'event',
): { hpLoss: number; shieldBlocked: number } {
  let amount = Math.max(0, Math.floor(rawAmount));
  if (source === 'rift' && hasRelic(state, 'rift_filter')) {
    amount = Math.max(1, amount - 3);
  }
  if (amount > 0 && hasRelic(state, 'glass_aegis') && !state.player.usedAegis) {
    amount = Math.ceil(amount / 2);
    state.player.usedAegis = true;
  }

  const shieldBlocked = Math.min(state.player.shield, amount);
  state.player.shield -= shieldBlocked;
  amount -= shieldBlocked;
  state.player.hp -= amount;
  if (state.player.hp <= 0) {
    defeat(state, source === 'rift' ? '被裂隙吞没' : source === 'event' ? '事件代价过高' : '战斗失败');
  }
  return { hpLoss: amount, shieldBlocked };
}

function getEffectiveAttack(state: RogueliteGameState): number {
  return state.player.attack + (hasRelic(state, 'battle_charm') ? 2 : 0);
}

function touchRingHeal(state: RogueliteGameState): number {
  if (!hasRelic(state, 'edge_mender')) return 0;
  const ring = Math.floor(distanceFromStart(state.player.position) / 4);
  if (ring <= 0) return 0;
  const key = `${state.floor}:${ring}`;
  if (state.player.ringHealKeys.includes(key)) {
    return 0;
  }
  state.player.ringHealKeys.push(key);
  return healPlayer(state, 2);
}

function checkStepDepletion(state: RogueliteGameState): void {
  if (state.status === 'playing' && state.player.stepsRemaining <= 0 && !state.pending) {
    defeat(state, '行动步数耗尽');
  }
}

function enterNextFloor(state: RogueliteGameState): void {
  state.player.floorsCleared = Math.max(state.player.floorsCleared, state.floor);
  state.floor += 1;
  state.board = generateRogueliteBoard(state.seed, state.floor);
  state.player.position = { ...ROGUELITE_START_POSITION };
  state.player.stepsRemaining += 18;
  if (hasRelic(state, 'meteor_boots')) {
    state.player.stepsRemaining += 8;
  }
  state.player.shield = Math.min(10, state.player.shield + 1);
  if (hasRelic(state, 'key_spring')) {
    state.player.keys += 1;
  }
  state.visited = [positionKey(ROGUELITE_START_POSITION)];
  state.revealed = [];
  state.pending = undefined;
  state.cellOverrides = undefined;
}

function buildOutcome(
  state: RogueliteGameState,
  message: string,
  partial: Partial<RogueliteActionOutcome> = {},
): RogueliteActionOutcome {
  return {
    message,
    damageTaken: partial.damageTaken ?? 0,
    shieldBlocked: partial.shieldBlocked ?? 0,
    stardustDelta: partial.stardustDelta ?? 0,
    keyDelta: partial.keyDelta ?? 0,
    hpDelta: partial.hpDelta ?? 0,
    ...(partial.relicGained ? { relicGained: partial.relicGained } : {}),
    floorChanged: partial.floorChanged ?? false,
    combatEnded: partial.combatEnded ?? false,
    status: state.status,
  };
}

function resolveMove(state: RogueliteGameState, to: RoguelitePosition): RogueliteActionResult {
  if (state.pending) {
    return { ok: false, message: '当前事件尚未处理完成' };
  }
  if (!isValidWorldPosition(to) || !isAdjacentPosition(state.player.position, to)) {
    return { ok: false, message: '只能移动到相邻格子' };
  }
  if (state.player.stepsRemaining <= 0) {
    defeat(state, '行动步数耗尽');
    return { ok: true, state, outcome: buildOutcome(state, '行动步数耗尽，迷阵关闭') };
  }

  const cell = getCellAt(state, to);
  state.player.stepsRemaining -= 1;
  state.player.position = { ...to };
  const hpFromRing = touchRingHeal(state);
  const key = positionKey(to);
  const wasVisited = state.visited.includes(key);

  if (wasVisited) {
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, hpFromRing > 0 ? '环带回声回复了生命' : '这里已经安全', {
        hpDelta: hpFromRing,
      }),
    };
  }

  state.visited = uniquePush(state.visited, key);
  state.player.exploredCells += 1;

  if (cell.type === 'empty' || cell.type === 'start') {
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, hpFromRing > 0 ? '环带回声回复了生命' : '这是一片安静的星砂地', { hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'stardust') {
    const amount = (cell.stardust ?? 0) + (hasRelic(state, 'dust_collector') ? 4 : 0);
    state.player.stardust += amount;
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, `获得 ${amount} 星尘`, { stardustDelta: amount, hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'relic' && cell.relic) {
    const relicResult = addRelic(state, cell.relic);
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(
        state,
        relicResult.gained
          ? `获得遗物：${ROGUELITE_RELIC_LABELS[cell.relic]}`
          : `遗物共鸣，转化为 ${relicResult.stardustDelta} 星尘`,
        {
          relicGained: relicResult.gained ? cell.relic : undefined,
          stardustDelta: relicResult.stardustDelta,
          hpDelta: hpFromRing,
        },
      ),
    };
  }

  if (cell.type === 'rift') {
    const damage = applyDamage(state, cell.damage ?? 0, 'rift');
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, state.status === 'defeated' ? '裂隙吞没了你' : '穿过裂隙，空间割伤了你', {
        damageTaken: damage.hpLoss,
        shieldBlocked: damage.shieldBlocked,
        hpDelta: hpFromRing - damage.hpLoss,
      }),
    };
  }

  if ((cell.type === 'monster' || cell.type === 'boss') && cell.monster) {
    if (hasRelic(state, 'warden_glyph')) {
      state.player.shield += 3;
    }
    state.pending = {
      type: 'combat',
      position: { ...to },
      monster: cloneMonster(cell.monster),
      round: 1,
      isBoss: cell.type === 'boss',
    };
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, `${cell.monster.name} 挡住了去路`, { hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'event' && cell.eventOptions) {
    state.pending = {
      type: 'event',
      position: { ...to },
      options: cell.eventOptions.map((option) => ({ ...option })),
    };
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, '星尘在这里凝成一个选择', { hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'shop' && cell.shopItems) {
    state.pending = {
      type: 'shop',
      position: { ...to },
      items: cell.shopItems.map((item) => ({ ...item })),
    };
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, '抵达星灯小铺', { hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'chest' && cell.chestReward) {
    state.pending = {
      type: 'chest',
      position: { ...to },
      reward: { ...cell.chestReward },
    };
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, '发现一只星纹宝箱', { hpDelta: hpFromRing }),
    };
  }

  if (cell.type === 'exit') {
    const completedFloor = state.floor;
    enterNextFloor(state);
    const message = completedFloor >= ROGUELITE_MAX_FLOOR
      ? `穿过第 ${completedFloor} 层星门，无尽星域展开，现在可以撤离结算`
      : `进入第 ${state.floor} 层星尘迷阵`;
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, message, { floorChanged: true, hpDelta: hpFromRing }),
    };
  }

  return { ok: false, message: '无法处理该格子' };
}

function resolveCombat(state: RogueliteGameState, style: 'attack' | 'guard' | 'skill'): RogueliteActionResult {
  if (!state.pending || state.pending.type !== 'combat') {
    return { ok: false, message: '当前没有战斗' };
  }

  const pending = state.pending;
  let damage = getEffectiveAttack(state);
  let stardustDelta = 0;
  let hpDelta = 0;

  if (style === 'guard') {
    state.player.shield += 5;
    damage = Math.max(1, Math.floor(damage / 2));
  } else if (style === 'skill') {
    if (state.player.stardust < 8) {
      return { ok: false, message: '星尘不足，无法释放星爆' };
    }
    state.player.stardust -= 8;
    stardustDelta -= 8;
    damage = damage * 2 + 4;
  }

  pending.monster.hp = Math.max(0, pending.monster.hp - damage);

  if (pending.monster.hp <= 0) {
    const reward = pending.monster.rewardStardust
      + (pending.isBoss ? 12 : 0)
      + (hasRelic(state, 'spoils_magnet') ? 5 : 0);
    state.player.stardust += reward;
    state.player.monstersDefeated += 1;
    stardustDelta += reward;
    state.pending = undefined;
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, `击败 ${pending.monster.name}，获得 ${reward} 星尘`, {
        stardustDelta,
        combatEnded: true,
      }),
    };
  }

  const damageTaken = applyDamage(state, pending.monster.attack, 'combat');
  hpDelta -= damageTaken.hpLoss;
  if (state.status === 'playing') {
    state.pending = {
      ...pending,
      monster: cloneMonster(pending.monster),
      round: pending.round + 1,
    };
  }

  return {
    ok: true,
    state,
    outcome: buildOutcome(state, `${pending.monster.name} 还剩 ${pending.monster.hp} 生命`, {
      damageTaken: damageTaken.hpLoss,
      shieldBlocked: damageTaken.shieldBlocked,
      stardustDelta,
      hpDelta,
    }),
  };
}

function resolveEvent(state: RogueliteGameState, optionId: string): RogueliteActionResult {
  if (!state.pending || state.pending.type !== 'event') {
    return { ok: false, message: '当前没有事件可处理' };
  }
  const option = state.pending.options.find((item) => item.id === optionId);
  if (!option) {
    return { ok: false, message: '无效的事件选项' };
  }

  let stardustDelta = 0;
  let keyDelta = 0;
  let hpDelta = 0;
  let relicGained: RogueliteRelicType | undefined;

  if (option.id === 'star_key') {
    const damage = applyDamage(state, 4, 'event');
    state.player.keys += 1;
    state.player.stardust += 8;
    hpDelta -= damage.hpLoss;
    keyDelta += 1;
    stardustDelta += 8;
  } else if (option.id === 'quiet_blessing') {
    hpDelta += healPlayer(state, 3);
    state.player.shield += 5;
  } else if (option.id === 'risky_map') {
    const cost = Math.min(6, state.player.stardust);
    state.player.stardust -= cost;
    stardustDelta -= cost;
    revealAround(state, state.pending.position);
  } else if (option.id === 'shard_oath') {
    const damage = applyDamage(state, 3, 'event');
    state.player.maxHp += 3;
    state.player.attack += 1;
    hpDelta -= damage.hpLoss;
  } else if (option.id === 'dust_gamble') {
    const cost = Math.min(5, state.player.stardust);
    state.player.stardust -= cost;
    stardustDelta -= cost;
    const won = createRogueliteRng(`${state.seed}:event:${state.floor}:${positionKey(state.pending.position)}:${state.player.eventsResolved}`)() >= 0.35;
    if (won) {
      state.player.stardust += 16;
      stardustDelta += 16;
    } else {
      const damage = applyDamage(state, 4, 'event');
      hpDelta -= damage.hpLoss;
    }
  } else if (option.id === 'shield_cache') {
    const cost = Math.min(4, state.player.stardust);
    state.player.stardust -= cost;
    state.player.shield += 8;
    stardustDelta -= cost;
  } else if (option.id === 'dust_bloom') {
    const damage = applyDamage(state, 3, 'event');
    state.player.stardust += 18;
    hpDelta -= damage.hpLoss;
    stardustDelta += 18;
  } else if (option.id === 'key_trade') {
    const cost = Math.min(10, state.player.stardust);
    const shortage = 10 - cost;
    state.player.stardust -= cost;
    if (shortage > 0) {
      const damage = applyDamage(state, shortage, 'event');
      hpDelta -= damage.hpLoss;
    }
    state.player.keys += 2;
    stardustDelta -= cost;
    keyDelta += 2;
  } else if (option.id === 'blade_forge') {
    const cost = Math.min(8, state.player.stardust);
    const shortage = 8 - cost;
    state.player.stardust -= cost;
    if (shortage > 0) {
      const damage = applyDamage(state, shortage, 'event');
      hpDelta -= damage.hpLoss;
    }
    state.player.attack += 2;
    stardustDelta -= cost;
  } else if (option.id === 'rest_cocoon') {
    if (state.player.keys > 0) {
      state.player.keys -= 1;
      keyDelta -= 1;
      hpDelta += healPlayer(state, 12);
    } else {
      hpDelta += healPlayer(state, 4);
    }
  } else if (option.id === 'time_spark') {
    const damage = applyDamage(state, 2, 'event');
    state.player.stepsRemaining += 10;
    hpDelta -= damage.hpLoss;
  } else if (option.id === 'relic_mirror') {
    const cost = Math.min(10, state.player.stardust);
    const shortage = 10 - cost;
    const relicRng = createRogueliteRng(`${state.seed}:event-relic:${state.floor}:${positionKey(state.pending.position)}:${state.player.eventsResolved}`);
    const relicType = pickOne(relicRng, ALL_RELICS);
    const relic = addRelic(state, relicType);
    state.player.stardust -= cost;
    if (shortage > 0) {
      const damage = applyDamage(state, shortage, 'event');
      hpDelta -= damage.hpLoss;
    }
    stardustDelta -= cost;
    if (relic.gained) {
      relicGained = relicType;
    } else {
      stardustDelta += relic.stardustDelta;
    }
  } else if (option.id === 'rift_survey') {
    state.player.shield += 4;
    revealAround(state, state.pending.position);
    const damage = applyDamage(state, 2, 'event');
    hpDelta -= damage.hpLoss;
  } else if (option.id === 'life_exchange') {
    state.player.maxHp = Math.max(1, state.player.maxHp - 2);
    state.player.hp = Math.min(state.player.hp, state.player.maxHp);
    state.player.keys += 1;
    state.player.shield += 6;
    state.player.stardust += 10;
    keyDelta += 1;
    stardustDelta += 10;
  } else if (option.id === 'compass_pulse') {
    const cost = Math.min(4, state.player.stardust);
    state.player.stardust -= cost;
    state.player.stepsRemaining += 6;
    stardustDelta -= cost;
    revealAround(state, state.pending.position);
  }

  state.player.eventsResolved += 1;
  state.pending = undefined;
  checkStepDepletion(state);

  return {
    ok: true,
    state,
    outcome: buildOutcome(state, option.label, {
      stardustDelta,
      keyDelta,
      hpDelta,
      relicGained,
    }),
  };
}

function resolveShop(state: RogueliteGameState, itemId: string): RogueliteActionResult {
  if (!state.pending || state.pending.type !== 'shop') {
    return { ok: false, message: '当前没有商店可处理' };
  }
  if (itemId === 'leave') {
    state.pending = undefined;
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, '离开星灯小铺'),
    };
  }

  const item = state.pending.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    return { ok: false, message: '商店没有这个物品' };
  }
  if (state.player.stardust < item.cost) {
    return { ok: false, message: '星尘不足' };
  }

  state.player.stardust -= item.cost;
  let stardustDelta = -item.cost;
  let keyDelta = 0;
  let hpDelta = 0;
  let relicGained: RogueliteRelicType | undefined;

  if (item.kind === 'heal') {
    hpDelta += healPlayer(state, 8 + state.floor * 2);
  } else if (item.kind === 'key') {
    state.player.keys += 1;
    keyDelta += 1;
  } else if (item.kind === 'relic' && item.relic) {
    const relic = addRelic(state, item.relic);
    if (relic.gained) {
      relicGained = item.relic;
    } else {
      stardustDelta += relic.stardustDelta;
    }
  } else if (item.kind === 'scout') {
    revealAround(state, state.pending.position);
  }

  const remainingItems = state.pending.items.filter((candidate) => candidate.id !== item.id);
  state.pending = remainingItems.length > 0
    ? { ...state.pending, items: remainingItems }
    : undefined;

  return {
    ok: true,
    state,
    outcome: buildOutcome(state, `购买了 ${item.label}`, {
      stardustDelta,
      keyDelta,
      hpDelta,
      relicGained,
    }),
  };
}

function resolveChest(state: RogueliteGameState, open: boolean): RogueliteActionResult {
  if (!state.pending || state.pending.type !== 'chest') {
    return { ok: false, message: '当前没有宝箱可处理' };
  }
  if (!open) {
    state.pending = undefined;
    checkStepDepletion(state);
    return {
      ok: true,
      state,
      outcome: buildOutcome(state, '保留钥匙，离开宝箱'),
    };
  }
  if (state.player.keys <= 0) {
    return { ok: false, message: '没有钥匙，无法打开宝箱' };
  }

  const reward = state.pending.reward;
  state.player.keys -= 1;
  state.player.chestsOpened += 1;

  const stardust = reward.stardust + (hasRelic(state, 'treasure_echo') ? 8 : 0);
  let bonusStardust = 0;
  let relicGained: RogueliteRelicType | undefined;
  if (reward.relic) {
    const relic = addRelic(state, reward.relic);
    if (relic.gained) {
      relicGained = reward.relic;
    } else {
      bonusStardust += relic.stardustDelta;
    }
  }

  state.player.stardust += stardust;
  state.pending = undefined;
  checkStepDepletion(state);

  return {
    ok: true,
    state,
    outcome: buildOutcome(state, `打开宝箱，获得 ${stardust + bonusStardust} 星尘`, {
      stardustDelta: stardust + bonusStardust,
      keyDelta: -1,
      relicGained,
    }),
  };
}

function resolveEscape(state: RogueliteGameState): RogueliteActionResult {
  if (state.pending) {
    return { ok: false, message: '当前事件尚未处理完成' };
  }
  if (state.player.floorsCleared < ROGUELITE_MAX_FLOOR) {
    return { ok: false, message: '穿过第 3 层星门后才能撤离结算' };
  }
  state.status = 'escaped';
  return {
    ok: true,
    state,
    outcome: buildOutcome(state, '你带着星尘从无尽星域撤离'),
  };
}

export function resolveRogueliteAction(
  inputState: RogueliteGameState,
  action: RogueliteAction,
): RogueliteActionResult {
  if (!action || typeof action !== 'object') {
    return { ok: false, message: '无效的行动' };
  }

  const state = cloneRogueliteState(inputState);
  if (state.status !== 'playing') {
    return { ok: false, message: '本局已经结束' };
  }

  switch (action.type) {
    case 'move':
      return resolveMove(state, action.to);
    case 'combat':
      return resolveCombat(state, action.style);
    case 'event':
      return resolveEvent(state, action.optionId);
    case 'shop':
      return resolveShop(state, action.itemId);
    case 'chest':
      return resolveChest(state, action.open);
    case 'escape':
      return resolveEscape(state);
    default:
      return { ok: false, message: '未知行动类型' };
  }
}

function parsePositionKey(key: string): RoguelitePosition | null {
  const [row, col] = key.split(',').map(Number);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { row, col };
}

function getSightRadius(state: RogueliteGameState): number {
  return hasRelic(state, 'starlight_lens') ? ROGUELITE_EXPANDED_SIGHT_RADIUS : ROGUELITE_SIGHT_RADIUS;
}

function isWithinSight(center: RoguelitePosition, target: RoguelitePosition, radius: number): boolean {
  return Math.max(Math.abs(center.row - target.row), Math.abs(center.col - target.col)) <= radius;
}

function isInPersistentSight(state: RogueliteGameState, position: RoguelitePosition): boolean {
  const radius = getSightRadius(state);
  return state.visited.some((key) => {
    const visitedPosition = parsePositionKey(key);
    return !!visitedPosition && isWithinSight(visitedPosition, position, radius);
  });
}

function shouldRevealExact(state: RogueliteGameState, cell: RogueliteCell): boolean {
  const key = positionKey(cell.position);
  return (
    state.revealed.includes(key)
    || isInPersistentSight(state, cell.position)
    || (hasRelic(state, 'star_compass') && cell.type === 'exit')
  );
}

function toViewPosition(state: RogueliteGameState, cell: RogueliteCell): RoguelitePosition {
  return {
    row: cell.position.row - state.player.position.row + ROGUELITE_VIEW_RADIUS,
    col: cell.position.col - state.player.position.col + ROGUELITE_VIEW_RADIUS,
  };
}

function buildHiddenCellView(state: RogueliteGameState, cell: RogueliteCell): RogueliteCellView {
  const relativePosition = {
    row: cell.position.row - state.player.position.row,
    col: cell.position.col - state.player.position.col,
  };
  return {
    id: cell.id,
    position: { ...cell.position },
    viewPosition: toViewPosition(state, cell),
    relativePosition,
    state: 'hidden',
    type: 'hidden',
    risk: 'medium',
    hint: '尚未照亮',
    label: '迷雾',
    icon: '░',
    adjacent: isAdjacentPosition(state.player.position, cell.position),
    exhausted: false,
  };
}

function buildExactCellView(state: RogueliteGameState, cell: RogueliteCell): RogueliteCellView {
  const key = positionKey(cell.position);
  const current = samePosition(state.player.position, cell.position);
  const visited = state.visited.includes(key);
  return {
    id: cell.id,
    position: { ...cell.position },
    viewPosition: toViewPosition(state, cell),
    relativePosition: {
      row: cell.position.row - state.player.position.row,
      col: cell.position.col - state.player.position.col,
    },
    state: current ? 'current' : visited ? 'revealed' : 'scouted',
    type: cell.type,
    risk: cell.risk,
    hint: cell.hint,
    label: cell.label,
    icon: cell.icon,
    adjacent: isAdjacentPosition(state.player.position, cell.position),
    exhausted: visited && !current && cell.type !== 'exit',
    ...(cell.stardust !== undefined ? { stardust: cell.stardust } : {}),
    ...(cell.damage !== undefined ? { damage: cell.damage } : {}),
    ...(cell.monster ? { monster: cloneMonster(cell.monster) } : {}),
    ...(cell.relic ? { relic: cell.relic } : {}),
    ...(cell.eventOptions ? { eventOptions: cell.eventOptions.map((option) => ({ ...option })) } : {}),
    ...(cell.shopItems ? { shopItems: cell.shopItems.map((item) => ({ ...item })) } : {}),
    ...(cell.chestReward ? { chestReward: { ...cell.chestReward } } : {}),
  };
}

function buildViewportCells(state: RogueliteGameState): RogueliteCell[] {
  const cells: RogueliteCell[] = [];
  for (let row = state.player.position.row - ROGUELITE_VIEW_RADIUS; row <= state.player.position.row + ROGUELITE_VIEW_RADIUS; row += 1) {
    for (let col = state.player.position.col - ROGUELITE_VIEW_RADIUS; col <= state.player.position.col + ROGUELITE_VIEW_RADIUS; col += 1) {
      cells.push(getCellAt(state, { row, col }));
    }
  }
  return cells;
}

function getDirectionLabel(from: RoguelitePosition, to: RoguelitePosition): string {
  const rowDelta = to.row - from.row;
  const colDelta = to.col - from.col;
  if (rowDelta === 0 && colDelta === 0) return '脚下';

  const vertical = rowDelta < 0 ? '北' : rowDelta > 0 ? '南' : '';
  const horizontal = colDelta < 0 ? '西' : colDelta > 0 ? '东' : '';
  return `${vertical}${horizontal}` || '附近';
}

function buildStarGateView(state: RogueliteGameState): RogueliteStarGateView {
  const exact = hasRelic(state, 'star_compass');
  return {
    ...(exact ? { position: { ...state.board.exitPosition } } : {}),
    distance: Math.abs(state.board.exitPosition.row - state.player.position.row)
      + Math.abs(state.board.exitPosition.col - state.player.position.col),
    direction: getDirectionLabel(state.player.position, state.board.exitPosition),
    exact,
    endlessUnlocked: state.player.floorsCleared >= ROGUELITE_MAX_FLOOR,
  };
}

export function buildRogueliteStateView(state: RogueliteGameState): RogueliteStateView {
  const nextState = cloneRogueliteState(state);
  const sightRadius = getSightRadius(nextState);
  const board = buildViewportCells(nextState)
    .map((cell) =>
      shouldRevealExact(nextState, cell)
        ? buildExactCellView(nextState, cell)
        : buildHiddenCellView(nextState, cell),
    )
    .sort((a, b) => (a.viewPosition.row - b.viewPosition.row) || (a.viewPosition.col - b.viewPosition.col));

  return {
    floor: nextState.floor,
    boardSize: ROGUELITE_VIEW_SIZE,
    viewportRadius: ROGUELITE_VIEW_RADIUS,
    sightRadius,
    board,
    player: {
      ...nextState.player,
      position: { ...nextState.player.position },
      relics: [...nextState.player.relics],
      ringHealKeys: [...nextState.player.ringHealKeys],
    },
    starGate: buildStarGateView(nextState),
    ...(nextState.pending ? { pending: clonePending(nextState.pending) } : {}),
    status: nextState.status,
    ...(nextState.defeatedReason ? { defeatedReason: nextState.defeatedReason } : {}),
    scorePreview: calculateRogueliteScore(nextState),
  };
}

export function isCurrentRogueliteState(value: unknown): value is RogueliteGameState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RogueliteGameState>;
  const board = state.board as Partial<RogueliteBoard> | undefined;
  const player = state.player as Partial<RoguelitePlayerState> | undefined;
  return (
    typeof state.seed === 'string'
    && typeof state.floor === 'number'
    && !!board
    && samePosition(board.startPosition ?? { row: NaN, col: NaN }, ROGUELITE_START_POSITION)
    && Array.isArray(board.cells)
    && board.cells.length === 0
    && !!player
    && !!player.position
    && isValidWorldPosition(player.position)
    && Array.isArray(player.relics)
    && Array.isArray(state.visited)
    && Array.isArray(state.revealed)
    && (state.status === 'playing' || state.status === 'escaped' || state.status === 'defeated')
  );
}

export function calculateRogueliteScore(state: RogueliteGameState): RogueliteScoreBreakdown {
  const clearedFloors = Math.max(0, state.player.floorsCleared);
  const storyFloors = Math.min(ROGUELITE_MAX_FLOOR, clearedFloors);
  const endlessFloors = Math.max(0, clearedFloors - ROGUELITE_MAX_FLOOR);
  const floorPoints = storyFloors * 220 + endlessFloors * 120;
  const exploredCells = Math.max(state.player.exploredCells ?? state.visited.length, state.visited.length);
  const explorationPoints = Math.min(420, Math.max(0, exploredCells - 1) * 8);
  const monsterPoints = state.player.monstersDefeated * 55;
  const stardustPoints = Math.floor(state.player.stardust * 5);
  const lifePoints = state.status === 'defeated' ? 0 : state.player.hp * 7;
  const relicPoints = state.player.relics.length * 75;
  const chestPoints = state.player.chestsOpened * 55;
  const winBonus = state.status === 'escaped' ? 360 + endlessFloors * 80 : 0;
  const total = Math.min(
    3000,
    Math.max(0, floorPoints + explorationPoints + monsterPoints + stardustPoints + lifePoints + relicPoints + chestPoints + winBonus),
  );

  return {
    floorPoints,
    explorationPoints,
    monsterPoints,
    stardustPoints,
    lifePoints,
    relicPoints,
    chestPoints,
    winBonus,
    total,
  };
}

export function calculateRoguelitePointReward(score: number): number {
  return Math.max(0, Math.floor(score / 10));
}
