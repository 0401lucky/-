import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const gatewayPath = path.join(repoRoot, 'gateway', 'Caddyfile');

const forbiddenRules = [
  {
    reason: '农场需要真实导入数据后的登录态直连 API 和页面级冒烟，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/farm(?:\s|\{|$)/,
      /^handle\s+\/api\/farm\*/ ,
      /^handle\s+\/api\/farm\/\*/ ,
      /^handle_path\s+\/api\/farm/,
    ],
  },
  {
    reason: '个人资料需要真实资料/成就导入验证和页面冒烟，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/profile(?:\s|\{|$)/,
      /^handle\s+\/api\/profile\*/ ,
      /^handle\s+\/api\/profile\/\*/ ,
      /^handle_path\s+\/api\/profile/,
    ],
  },
  {
    reason: '通知需要真实 D1 导出导入和真实样本账号复跑，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/notifications(?:\s|\{|$)/,
      /^handle\s+\/api\/notifications\*/ ,
      /^handle\s+\/api\/notifications\/\*/ ,
      /^handle_path\s+\/api\/notifications/,
    ],
  },
  {
    reason: '钱包充值/提现需要 new-api 配置和认证只读余额冒烟，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/store\/topup(?:\s|\{|$)/,
      /^handle\s+\/api\/store\/withdraw(?:\s|\{|$)/,
      /^handle_path\s+\/api\/store\/topup/,
      /^handle_path\s+\/api\/store\/withdraw/,
    ],
  },
  {
    reason: '卡牌前台需要真实导入数据/样本账号最终复核，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/cards(?:\s|\{|$)/,
      /^handle\s+\/api\/cards\*/ ,
      /^handle\s+\/api\/cards\/\*/ ,
      /^handle_path\s+\/api\/cards/,
    ],
  },
  {
    reason: '后台卡牌需要真实导入数据或生产等价样本账号最终复核，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/admin\/cards(?:\s|\{|$)/,
      /^handle\s+\/api\/admin\/cards\*/ ,
      /^handle\s+\/api\/admin\/cards\/\*/ ,
      /^handle_path\s+\/api\/admin\/cards/,
    ],
  },
  {
    reason: '游戏 overview 当前无前端直接调用，暂不切 Gateway',
    patterns: [
      /^handle\s+\/api\/games\/overview(?:\s|\{|$)/,
      /^handle_path\s+\/api\/games\/overview/,
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
    reason: '项目详情/后台项目尚未切流，只允许公开项目列表精确路径',
    patterns: [
      /^handle\s+\/api\/projects\/\*/ ,
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
    '/api/rankings/eco',
    '/api/games/profile',
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
    '/api/store/admin',
    '/api/projects',
    '/api/raffle',
    '/api/raffle/*',
    '/api/admin/raffle',
    '/api/admin/raffle/*',
    '/api/admin/eco',
    '/api/admin/points',
    '/api/admin/users{,/*}',
    '/api/admin/dashboard',
    '/api/admin/projects{,/*}',
    '/api/admin/feedback{,/*}',
  ],
  forbiddenStillClosed: [
    '/api/farm*',
    '/api/profile*',
    '/api/notifications*',
    '/api/store/topup',
    '/api/store/withdraw',
    '/api/cards*',
    '/api/admin/cards*',
    '/api/games/overview',
    '/api/games/*',
    '/api/projects/*',
    '/api/admin/*',
  ],
};

console.log(JSON.stringify(summary, null, 2));
