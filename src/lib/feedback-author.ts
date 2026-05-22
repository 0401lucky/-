import type { FeedbackItem } from '@/lib/feedback';
import { getCustomUserProfile } from '@/lib/user-profile';
import { getEquippedAchievementForUser } from '@/lib/user-achievements';
import type { PublicAchievement } from '@/lib/profile-achievements';

export interface FeedbackAuthorProfile {
  displayName: string;
  avatarUrl: string | null;
  equippedAchievement: PublicAchievement | null;
}

export type FeedbackItemWithAuthor = FeedbackItem & FeedbackAuthorProfile;

export async function attachFeedbackAuthorProfile<T extends FeedbackItem>(
  item: T
): Promise<T & FeedbackAuthorProfile> {
  const [profile, equippedAchievement] = await Promise.all([
    getCustomUserProfile(item.userId),
    getEquippedAchievementForUser(item.userId),
  ]);

  return {
    ...item,
    displayName: profile.displayName ?? item.username,
    avatarUrl: profile.avatarUrl ?? null,
    equippedAchievement,
  };
}

export async function attachFeedbackAuthorProfiles<T extends FeedbackItem>(
  items: T[]
): Promise<Array<T & FeedbackAuthorProfile>> {
  return Promise.all(items.map((item) => attachFeedbackAuthorProfile(item)));
}
