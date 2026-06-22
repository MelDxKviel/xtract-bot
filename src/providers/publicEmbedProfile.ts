import { getFetch, withTimeout, type FetchLike } from "@/providers/http";
import {
  makeProfile,
  TweetProviderError,
  type ProfileData,
  type ProfileProvider,
} from "@/providers/profileBase";

// FxTwitter exposes a public user endpoint at /<handle> that returns profile
// metadata (followers, bio, avatar, …) without authentication.
const FXTWITTER_USER_URL = "https://api.fxtwitter.com/{handle}";
const USER_AGENT = "xtract-bot/0.1 (+https://github.com/)";

const log = (message: string, ...args: unknown[]): void => {
  console.log(`[public_embed_profile] ${message}`, ...args);
};

export interface PublicEmbedProfileOptions {
  timeoutSeconds?: number;
  fetch?: FetchLike;
}

export class PublicEmbedProfileProvider implements ProfileProvider {
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: PublicEmbedProfileOptions = {}) {
    this.timeoutMs = Math.round((options.timeoutSeconds ?? 10) * 1000);
    this.fetchImpl = getFetch(options.fetch);
  }

  async getProfile(username: string, _sourceUrl: string): Promise<ProfileData> {
    const payload = await this.getJson(
      FXTWITTER_USER_URL.replace("{handle}", encodeURIComponent(username)),
    );
    const user = isRecord(payload.user) ? (payload.user as Record<string, any>) : payload;
    const profile = profileFromFxtwitter(user, username);
    ensureUsableProfile(profile);
    log(`username=${profile.username} ok`);
    return profile;
  }

  async close(): Promise<void> {
    // no-op
  }

  private async getJson(url: string): Promise<Record<string, any>> {
    const { signal, clear } = withTimeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        redirect: "follow",
        signal,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new TweetProviderError("request timed out", { code: "provider_timeout" });
      }
      throw new TweetProviderError(String(error), { code: "provider_http_error" });
    } finally {
      clear();
    }

    if (response.status === 404) {
      throw new TweetProviderError("profile not found", { code: "not_found" });
    }
    if (response.status === 403) {
      throw new TweetProviderError("profile is private or unavailable", {
        code: "private_or_deleted",
      });
    }
    if (response.status === 429) {
      throw new TweetProviderError("profile endpoint rate limit exceeded", {
        code: "provider_rate_limited",
      });
    }
    if (response.status >= 400) {
      throw new TweetProviderError(`profile endpoint returned HTTP ${response.status}`, {
        code: "provider_http_error",
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TweetProviderError("profile endpoint returned invalid JSON", {
        code: "provider_bad_response",
      });
    }
    if (!isRecord(payload)) {
      throw new TweetProviderError("profile endpoint returned non-object JSON", {
        code: "provider_bad_response",
      });
    }
    raiseForFxtwitterError(payload);
    return payload;
  }
}

function raiseForFxtwitterError(payload: Record<string, any>): void {
  const code = payload.code;
  if (code === undefined || code === null || code === 200 || code === "200") return;
  const message = String(payload.message ?? payload.error ?? "profile API error");
  if (code === 401 || code === 403 || code === "401" || code === "403") {
    throw new TweetProviderError(message, { code: "private_or_deleted" });
  }
  if (code === 404 || code === "404") {
    throw new TweetProviderError(message, { code: "not_found" });
  }
  if (code === 429 || code === "429") {
    throw new TweetProviderError(message, { code: "provider_rate_limited" });
  }
  throw new TweetProviderError(message, { code: "provider_http_error" });
}

function profileFromFxtwitter(user: Record<string, any>, requestedUsername: string): ProfileData {
  const username = (firstStr(user, "screen_name", "username") ?? requestedUsername).replace(
    /^@+/,
    "",
  );
  const name = firstStr(user, "name", "display_name") ?? username;
  return makeProfile({
    username,
    name,
    url: `https://x.com/${username}`,
    bio: cleanText(firstStr(user, "description", "bio")),
    location: cleanText(firstStr(user, "location")),
    website: websiteUrl(user),
    avatarUrl: imageUrl(firstStr(user, "avatar_url", "profile_image_url", "avatar")),
    bannerUrl: imageUrl(firstStr(user, "banner_url", "profile_banner_url", "banner")),
    joinedAt: parseDatetime(user.joined ?? user.created_at ?? user.join_date),
    followersCount: intOrNull(user.followers ?? user.followers_count),
    followingCount: intOrNull(user.following ?? user.following_count ?? user.friends_count),
    tweetCount: intOrNull(user.tweets ?? user.statuses_count ?? user.tweet_count ?? user.posts),
    likeCount: intOrNull(user.likes ?? user.favourites_count ?? user.like_count),
    verified: verifiedFlag(user),
  });
}

function ensureUsableProfile(profile: ProfileData): void {
  if (!profile.username || profile.username === "unknown") {
    throw new TweetProviderError("provider returned profile without a handle", {
      code: "provider_bad_response",
    });
  }
}

function verifiedFlag(user: Record<string, any>): boolean {
  const value = user.verified ?? user.is_verified ?? user.blue_verified;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" || value === "blue";
  return false;
}

function websiteUrl(user: Record<string, any>): string | null {
  const website = user.website;
  if (isRecord(website)) {
    const url = firstStr(website, "url", "expanded_url", "display_url");
    return url ? cleanText(url) : null;
  }
  return cleanText(firstStr(user, "website", "url_expanded", "external_url"));
}

function imageUrl(value: string | null): string | null {
  if (!value || !/^https?:\/\//.test(value)) return null;
  // Twitter delivers a "_normal" (48px) avatar by default; widen it.
  return value.replace(/_normal(\.\w+)(\?.*)?$/, "_400x400$1$2");
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstStr(payload: Record<string, any>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function intOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/,/g, "");
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function parseDatetime(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value.replace("Z", "+00:00"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
