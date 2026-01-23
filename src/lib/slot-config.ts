import { kv } from '@vercel/kv';

const SLOT_CONFIG_KEY = 'slot:config';

export interface SlotConfig {
  betModeEnabled: boolean;
  betCost: number;
  updatedAt?: number;
  updatedBy?: string;
}

const DEFAULT_SLOT_CONFIG: SlotConfig = {
  betModeEnabled: true,
  betCost: 10,
};

export async function getSlotConfig(): Promise<SlotConfig> {
  const config = await kv.get<SlotConfig>(SLOT_CONFIG_KEY);

  if (!config) {
    return DEFAULT_SLOT_CONFIG;
  }

  return {
    ...DEFAULT_SLOT_CONFIG,
    ...config,
  };
}

export async function updateSlotConfig(
  updates: Partial<SlotConfig>,
  updatedBy?: string
): Promise<SlotConfig> {
  const current = await getSlotConfig();

  const next: SlotConfig = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
    updatedBy,
  };

  await kv.set(SLOT_CONFIG_KEY, next);
  return next;
}

