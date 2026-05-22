import { kv } from '@/lib/d1-kv';
import { sendFarmMaturityEmail, isFarmMaturityEmailConfigured } from '@/lib/email';
import { getCustomUserProfile } from '@/lib/user-profile';
import type { FarmEvent, FarmStateV2 } from '@/lib/types/farm-v2';
import { CROPS_V2, PET_TYPE_LABEL } from './config';

const SENT_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface MaturityEmailProcessResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

function sentKey(userId: number, eventId: string): string {
  return `farmv2:mature-mail:sent:${userId}:${eventId}`;
}

function matureEvents(state: FarmStateV2): FarmEvent[] {
  return (state.events ?? []).filter((event) => {
    if (event.type !== 'mature' || !event.cropId || typeof event.landIndex !== 'number') {
      return false;
    }

    const land = state.lands.find((item) => item.index === event.landIndex);
    if (!land?.crop) return false;
    return (
      land.status === 'mature' &&
      land.crop.cropId === event.cropId &&
      land.crop.matureAt === event.ts
    );
  });
}

function resolvePetName(state: FarmStateV2): string | null {
  if (!state.pet) return null;
  return state.pet.name || PET_TYPE_LABEL[state.pet.type];
}

export async function processMaturityEmailEventsForState(
  state: FarmStateV2,
  now = Date.now(),
): Promise<MaturityEmailProcessResult> {
  const events = matureEvents(state);
  const result: MaturityEmailProcessResult = {
    checked: events.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  if (events.length === 0) return result;
  if (!state.pet || state.pet.stage !== 'adult') {
    result.skipped = events.length;
    return result;
  }
  if (!isFarmMaturityEmailConfigured()) {
    result.skipped = events.length;
    return result;
  }

  const profile = await getCustomUserProfile(state.userId);
  if (!profile.qqEmail) {
    result.skipped = events.length;
    return result;
  }

  const petName = resolvePetName(state);
  for (const event of events) {
    if (!event.cropId) {
      result.skipped += 1;
      continue;
    }

    const key = sentKey(state.userId, event.id);
    const claimed = await kv.set(key, { claimedAt: now }, { nx: true, ex: SENT_TTL_SECONDS });
    if (claimed !== 'OK') {
      result.skipped += 1;
      continue;
    }

    try {
      const sendResult = await sendFarmMaturityEmail({
        to: profile.qqEmail,
        cropName: CROPS_V2[event.cropId].name,
        matureAt: event.ts,
        petName,
      });
      if (sendResult.sent) {
        result.sent += 1;
      } else {
        result.skipped += 1;
        await kv.del(key);
      }
    } catch (error) {
      result.failed += 1;
      await kv.del(key);
      console.error('农场成熟邮件发送失败:', error);
    }
  }

  return result;
}
