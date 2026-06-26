import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');

const forbiddenRules = [
  {
    reason: '认证只允许 login/me/logout 三个精确路径，禁止 auth 通配或路径改写',
    patterns: [
      /^handle\s+\/api\/auth\*/ ,
      /^handle\s+\/api\/auth\/\*/ ,
      /^handle_path\s+\/api\/auth/,
    ],
  },
  {
    reason: '签到只允许 /api/checkin 与 /api/checkin/makeup 两个精确路径，禁止通配或路径改写',
    patterns: [
      /^handle\s+\/api\/checkin\*/ ,
      /^handle\s+\/api\/checkin\/\*/ ,
      /^handle_path\s+\/api\/checkin/,
    ],
  },
  {
    reason: '排行榜只允许已审精确路径，禁止 rankings 通配或路径改写',
    patterns: [
      /^handle\s+\/api\/rankings\*/ ,
      /^handle\s+\/api\/rankings\/\*/ ,
      /^handle_path\s+\/api\/rankings/,
    ],
  },
  {
    reason: '农场只允许已审精确路径，禁止根路径、通配或路径改写',
    patterns: [
      /^handle\s+\/api\/farm(?:\s|\{|$)/,
      /^handle\s+\/api\/farm\*/ ,
      /^handle\s+\/api\/farm\/\*/ ,
      /^handle_path\s+\/api\/farm/,
    ],
  },
  {
    reason: '个人资料只允许 overview/settings/achievements/equip 三个精确路径，禁止 profile 通配',
    patterns: [
      /^handle\s+\/api\/profile\*/ ,
      /^handle\s+\/api\/profile\/\*/ ,
      /^handle_path\s+\/api\/profile/,
    ],
  },
  {
    reason: '通知中心只允许列表、未读、已读、删除、领取五个精确路径，禁止 notifications 通配',
    patterns: [
      /^handle\s+\/api\/notifications\*/ ,
      /^handle\s+\/api\/notifications\/\*/ ,
      /^handle_path\s+\/api\/notifications/,
    ],
  },
  {
    reason: '公告只允许公开列表和后台公告管理路径，禁止公开公告通配或路径改写',
    patterns: [
      /^handle\s+\/api\/announcements\*/ ,
      /^handle\s+\/api\/announcements\/\*/ ,
      /^handle_path\s+\/api\/announcements/,
      /^handle_path\s+\/api\/admin\/announcements/,
    ],
  },
  {
    reason: '商城只允许已审精确路径，禁止 store 根通配或路径改写',
    patterns: [
      /^handle\s+\/api\/store\*/,
      /^handle\s+\/api\/store\/\*/,
      /^handle_path\s+\/api\/store/,
    ],
  },
  {
    reason: '彩票和数字炸弹只允许已审精确路径，禁止 lottery 通配或路径改写',
    patterns: [
      /^handle\s+\/api\/lottery\*/,
      /^handle\s+\/api\/lottery\/\*/,
      /^handle\s+\/api\/admin\/lottery\*/,
      /^handle\s+\/api\/admin\/lottery\/\*/,
      /^handle_path\s+\/api\/lottery/,
      /^handle_path\s+\/api\/admin\/lottery/,
    ],
  },
  {
    reason: '卡牌前台只允许已审精确路径，禁止根路径或通配切流',
    patterns: [
      /^handle\s+\/api\/cards(?:\s|\{|$)/,
      /^handle\s+\/api\/cards\*/ ,
      /^handle\s+\/api\/cards\/\*/ ,
      /^handle_path\s+\/api\/cards/,
    ],
  },
  {
    reason: '后台卡牌只允许已审精确路径，禁止根路径或通配切流',
    patterns: [
      /^handle\s+\/api\/admin\/cards(?:\s|\{|$)/,
      /^handle\s+\/api\/admin\/cards\*/ ,
      /^handle\s+\/api\/admin\/cards\/\*/ ,
      /^handle_path\s+\/api\/admin\/cards/,
    ],
  },
  {
    reason: '普通游戏和环保游戏只允许精确路径，禁止完整 games 通配',
    patterns: [
      /^handle\s+\/api\/games\/\*/ ,
      /^handle_path\s+\/api\/games/,
    ],
  },
  {
    reason: '项目路径只允许公开列表、我的领取记录、详情/领取和后台项目精确规则，禁止 projects 通配或路径改写',
    patterns: [
      /^handle\s+\/api\/projects\*/ ,
      /^handle_path\s+\/api\/projects/,
    ],
  },
  {
    reason: '后台只允许已审的 raffle 精确规则，禁止完整 admin 通配',
    patterns: [
      /^handle\s+\/api\/admin\/\*\s*\{/,
      /^handle_path\s+\/api\/admin/,
    ],
  },
];

const activeLines = readFileSync(gatewayPath, 'utf8')
  .split(/\r?\n/)
  .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
  .filter((entry) => entry.line !== '' && !entry.line.startsWith('#'));

const violations = [];
for (const entry of activeLines) {
  for (const rule of forbiddenRules) {
    if (rule.patterns.some((pattern) => pattern.test(entry.line))) {
      violations.push({
        line: entry.line,
        lineNumber: entry.lineNumber,
        reason: rule.reason,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('gateway cutover guard failed: forbidden Gateway rules are active');
  for (const violation of violations) {
    console.error(`- gateway/Caddyfile:${violation.lineNumber} ${violation.line}`);
    console.error(`  reason: ${violation.reason}`);
  }
  process.exit(1);
}

const summary = {
  ok: true,
  guardedForbiddenGroups: forbiddenRules.length,
  checkedActiveHandleLines: activeLines.filter((entry) => /^handle(?:_path)?\s+/.test(entry.line)).length,
  allowedExistingCutovers: [
    '/api/points',
    '/api/auth/login',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/checkin{,/makeup}',
    '/api/rankings/{eco,points,games,checkin-streak,history,lottery}',
    '/api/games/overview',
    '/api/games/profile',
    '/api/profile/overview',
    '/api/profile/settings',
    '/api/profile/achievements/equip',
    '/api/notifications',
    '/api/notifications/unread-count',
    '/api/notifications/read',
    '/api/notifications/delete',
    '/api/notifications/claim',
    '/api/announcements',
    '/api/admin/announcements{,/*}',
    '/api/farm/{20 exact paths}',
    '/api/games/eco/{8 exact paths}',
    '/api/games/memory/{5 exact paths}',
    '/api/games/match3/{4 exact paths}',
    '/api/games/whack-mole/{5 exact paths}',
    '/api/games/minesweeper/{5 exact paths}',
    '/api/games/linkgame/{4 exact paths}',
    '/api/games/roguelite/{5 exact paths}',
    '/api/games/2048/{5 exact paths}',
    '/api/store',
    '/api/store/exchange',
    '/api/store/topup',
    '/api/store/withdraw',
    '/api/store/admin',
    '/api/admin/store/reset',
    '/api/cards/{inventory,rules,draw,purchase tombstone,exchange,claim-reward}',
    '/api/admin/cards/{users,user/*,reset,albums,rules}',
    '/api/feedback{,/*}',
    '/api/projects',
    '/api/raffle',
    '/api/raffle/*',
    '/api/admin/raffle',
    '/api/admin/raffle/*',
    '/api/admin/eco',
    '/api/admin/points',
    '/api/admin/users{,/*}',
    '/api/admin/dashboard',
    '/api/admin/config',
    '/api/admin/rewards{,/*}',
    '/api/admin/projects{,/*}',
    '/api/admin/feedback{,/*}',
    '/api/projects{,/my-claims,/*}',
    '/api/lottery 精确路径组',
    '/api/admin/lottery 精确路径组',
  ],
  forbiddenStillClosed: [
    '/api/farm 根路径或通配',
    '/api/profile* 通配',
    '/api/notifications* 通配',
    '/api/announcements* 通配',
    '/api/lottery* 通配',
    '/api/admin/lottery* 通配',
    '/api/store* 通配',
    '/api/cards 根路径或通配',
    '/api/admin/cards 根路径或通配',
    '/api/games/*',
    '/api/projects* 通配',
    '/api/admin/*',
    '/api/checkin* 通配',
    '/api/rankings/* 通配',
  ],
};

console.log(JSON.stringify(summary, null, 2));
