import { TweetProviderError } from "@/providers/base";

/**
 * A normalised X/Twitter user profile. Fields are best-effort: providers fill in
 * what they can and leave the rest null so the formatter can omit empty rows.
 */
export interface ProfileData {
  username: string;
  name: string;
  url: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  joinedAt: Date | null;
  followersCount: number | null;
  followingCount: number | null;
  tweetCount: number | null;
  likeCount: number | null;
  verified: boolean;
}

export interface ProfileProvider {
  getProfile(username: string, sourceUrl: string): Promise<ProfileData>;
  close(): Promise<void>;
}

export function makeProfile(
  partial: Partial<ProfileData> & Pick<ProfileData, "username" | "name" | "url">,
): ProfileData {
  return {
    username: partial.username,
    name: partial.name,
    url: partial.url,
    bio: partial.bio ?? null,
    location: partial.location ?? null,
    website: partial.website ?? null,
    avatarUrl: partial.avatarUrl ?? null,
    bannerUrl: partial.bannerUrl ?? null,
    joinedAt: partial.joinedAt ?? null,
    followersCount: partial.followersCount ?? null,
    followingCount: partial.followingCount ?? null,
    tweetCount: partial.tweetCount ?? null,
    likeCount: partial.likeCount ?? null,
    verified: partial.verified ?? false,
  };
}

export interface ProfileDataPayload {
  username: string;
  name: string;
  url: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  joined_at: string | null;
  followers_count: number | null;
  following_count: number | null;
  tweet_count: number | null;
  like_count: number | null;
  verified: boolean;
}

export function profileToPayload(profile: ProfileData): ProfileDataPayload {
  return {
    username: profile.username,
    name: profile.name,
    url: profile.url,
    bio: profile.bio,
    location: profile.location,
    website: profile.website,
    avatar_url: profile.avatarUrl,
    banner_url: profile.bannerUrl,
    joined_at: profile.joinedAt ? profile.joinedAt.toISOString() : null,
    followers_count: profile.followersCount,
    following_count: profile.followingCount,
    tweet_count: profile.tweetCount,
    like_count: profile.likeCount,
    verified: profile.verified,
  };
}

export function profileFromPayload(payload: ProfileDataPayload): ProfileData {
  return {
    username: String(payload.username),
    name: String(payload.name),
    url: String(payload.url),
    bio: payload.bio ?? null,
    location: payload.location ?? null,
    website: payload.website ?? null,
    avatarUrl: payload.avatar_url ?? null,
    bannerUrl: payload.banner_url ?? null,
    joinedAt: parseDatetime(payload.joined_at),
    followersCount: numberOrNull(payload.followers_count),
    followingCount: numberOrNull(payload.following_count),
    tweetCount: numberOrNull(payload.tweet_count),
    likeCount: numberOrNull(payload.like_count),
    verified: Boolean(payload.verified),
  };
}

function parseDatetime(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

// Re-export so profile providers can throw the shared provider error type.
export { TweetProviderError };
