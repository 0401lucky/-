export interface SystemConfigValues {
  dailyPointsLimit: number;
  dailyWithdrawLimit: number;
  vipDailyWithdrawLimit: number;
  vipPricePoints: number;
  vipDurationDays: number;
  vipWithdrawFeePercent: number;
  vipDailyLotterySpins: number;
  vipMaxTotalDays: number;
  withdrawBalanceCapDollars: number;
}

export interface SystemConfig extends SystemConfigValues {
  updatedAt?: number;
  updatedBy?: string;
}

export type ConfigKey = keyof SystemConfigValues;
export type ConfigDraft = Record<ConfigKey, string>;
export type ConfigErrors = Partial<Record<ConfigKey, string>>;

// 与 Go systemconfig 的取值范围一致；保存时必须提交全部九个字段。
export const CONFIG_FIELDS: Array<{
  key: ConfigKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  description: string;
  group: 'game' | 'wallet' | 'vip';
}> = [
  {
    key: 'dailyPointsLimit',
    label: '每日游戏积分上限',
    unit: '积分 / 天',
    min: 100,
    max: 100000,
    group: 'game',
    description: '限制每位用户每天通过游戏获得的积分，次日中国时间 0 点重置。',
  },
  {
    key: 'withdrawBalanceCapDollars',
    label: '账户额度提现上限',
    unit: '美元',
    min: 1,
    max: 1000000000000,
    group: 'wallet',
    description:
      'new-api 账户额度达到此金额后暂停提现，消耗额度后可继续。VIP 与管理员同样受限。',
  },
  {
    key: 'dailyWithdrawLimit',
    label: '普通用户每日提现次数',
    unit: '次 / 天',
    min: 1,
    max: 100,
    group: 'wallet',
    description: '每日中国时间 0 点重置，管理员同样受限。',
  },
  {
    key: 'vipDailyWithdrawLimit',
    label: 'VIP 每日提现次数',
    unit: '次 / 天',
    min: 1,
    max: 100,
    group: 'vip',
    description: 'VIP 用户每天可使用的提现次数上限。',
  },
  {
    key: 'vipPricePoints',
    label: '月卡价格',
    unit: '积分',
    min: 1,
    max: 1000000,
    group: 'vip',
    description: '每次购买 VIP 月卡所需的积分。',
  },
  {
    key: 'vipDurationDays',
    label: '月卡时长',
    unit: '天',
    min: 1,
    max: 365,
    group: 'vip',
    description: '每次购买增加的天数，重复购买会累加剩余时长。',
  },
  {
    key: 'vipMaxTotalDays',
    label: 'VIP 累计时长上限',
    unit: '天',
    min: 1,
    max: 3650,
    group: 'vip',
    description: '用户可累积的剩余 VIP 时长，必须不小于单次月卡时长。',
  },
  {
    key: 'vipWithdrawFeePercent',
    label: 'VIP 手续费比例',
    unit: '%',
    min: 0,
    max: 100,
    group: 'vip',
    description: '按原阶梯费率的比例收取，50 表示五折，0 表示免手续费。',
  },
  {
    key: 'vipDailyLotterySpins',
    label: 'VIP 每日赠送抽奖次数',
    unit: '次 / 天',
    min: 0,
    max: 50,
    group: 'vip',
    description: '在每日 1 次免费抽奖的基础上额外赠送的次数。',
  },
];

export function configToDraft(config: SystemConfigValues): ConfigDraft {
  return Object.fromEntries(
    CONFIG_FIELDS.map(({ key }) => [key, String(config[key])]),
  ) as ConfigDraft;
}

export function validateConfigDraft(draft: ConfigDraft): {
  values: SystemConfigValues;
  errors: ConfigErrors;
} {
  const values = {} as SystemConfigValues;
  const errors: ConfigErrors = {};
  for (const field of CONFIG_FIELDS) {
    const raw = draft[field.key].trim();
    const value = Number(raw);
    values[field.key] = value;
    if (
      !raw ||
      !Number.isSafeInteger(value) ||
      value < field.min ||
      value > field.max
    ) {
      errors[field.key] =
        `请输入 ${field.min.toLocaleString('zh-CN')}–${field.max.toLocaleString('zh-CN')} 之间的整数`;
    }
  }
  if (
    !errors.vipMaxTotalDays &&
    !errors.vipDurationDays &&
    values.vipMaxTotalDays < values.vipDurationDays
  ) {
    errors.vipMaxTotalDays = '累计时长上限不能小于月卡时长';
  }
  return { values, errors };
}
