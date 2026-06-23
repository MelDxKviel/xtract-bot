import { formatProfile } from "@/formatters/profile";
import type { TelegramPost } from "@/formatters/telegram";
import { TweetProviderError } from "@/providers/base";
import type { ProfileData, ProfileProvider } from "@/providers/profileBase";
import type { ProfileCacheRepository } from "@/repositories/profileCache";
import type { ShareEventRepository } from "@/repositories/shareEvents";
import { extractFirstProfileUrl, type ParsedProfileUrl } from "@/utils/urls";

export type ShareMode = "private" | "inline";
export type ShareStatus = "success" | "error" | "invalid_url";

// Errors that mean the profile will never come back (deleted/suspended/not
// found): safe to negative-cache. Transient errors are intentionally excluded.
const TERMINAL_ERROR_CODES = new Set(["not_found", "private_or_deleted"]);

export interface ProfileShareResult {
  status: ShareStatus;
  ok: boolean;
  username: string | null;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  profile: ProfileData | null;
  post: TelegramPost | null;
  errorCode: string | null;
  elapsedMs: number | null;
  cacheHit: boolean;
}

export interface ProcessOptions {
  telegramUserId: number;
  chatId: number | null;
  mode: ShareMode;
}

export interface ProfileShareService {
  processText(text: string, options: ProcessOptions): Promise<ProfileShareResult>;
  processUrl(parsed: ParsedProfileUrl, options: ProcessOptions): Promise<ProfileShareResult>;
}

interface Deps {
  provider: ProfileProvider;
  cacheRepository: ProfileCacheRepository;
  shareEventsRepository: Pick<ShareEventRepository, "create">;
  cacheTtlSeconds: number;
  negativeCacheTtlSeconds: number;
}

export function createProfileShareService(deps: Deps): ProfileShareService {
  const {
    provider,
    cacheRepository,
    shareEventsRepository,
    cacheTtlSeconds,
    negativeCacheTtlSeconds,
  } = deps;

  // Fetch from the provider and write the result back to the cache (positive on
  // success, negative for terminal errors). Throws on any provider error.
  const fetchAndCache = async (
    username: string,
    sourceUrl: string,
    normalizedUrl: string,
  ): Promise<ProfileData> => {
    try {
      const profile = await provider.getProfile(username, normalizedUrl);
      await cacheRepository.set(profile, sourceUrl, { ttlSeconds: cacheTtlSeconds });
      return profile;
    } catch (error) {
      if (
        error instanceof TweetProviderError &&
        TERMINAL_ERROR_CODES.has(error.code) &&
        negativeCacheTtlSeconds > 0
      ) {
        await cacheRepository.setNegative(username, sourceUrl, error.code, {
          ttlSeconds: negativeCacheTtlSeconds,
        });
      }
      throw error;
    }
  };

  const recordError = async (
    parsed: ParsedProfileUrl,
    options: ProcessOptions,
    code: string,
    started: number,
    extra: { negativeCacheHit?: boolean } = {},
  ): Promise<ProfileShareResult> => {
    const elapsedMs = elapsedSince(started);
    await shareEventsRepository.create({
      telegramUserId: options.telegramUserId,
      chatId: options.chatId,
      tweetId: `profile:${parsed.username}`,
      sourceUrl: parsed.sourceUrl,
      mode: options.mode,
      status: "error",
      errorCode: code,
    });
    log("error", {
      telegramUserId: options.telegramUserId,
      chatId: options.chatId,
      username: parsed.username,
      mode: options.mode,
      errorCode: code,
      negativeCacheHit: extra.negativeCacheHit ?? false,
      elapsedMs,
    });
    return {
      status: "error",
      ok: false,
      username: parsed.username,
      sourceUrl: parsed.sourceUrl,
      normalizedUrl: parsed.normalizedUrl,
      profile: null,
      post: null,
      errorCode: code,
      elapsedMs,
      cacheHit: false,
    };
  };

  return {
    async processText(text, options): Promise<ProfileShareResult> {
      const parsed = extractFirstProfileUrl(text);
      if (!parsed) {
        return invalidUrlResult();
      }
      return this.processUrl(parsed, options);
    },

    async processUrl(parsed, options): Promise<ProfileShareResult> {
      const started = performance.now();
      let cacheHit = false;
      try {
        const entry = await cacheRepository.getEntry(parsed.username);
        let profile: ProfileData;
        if (entry?.kind === "hit") {
          profile = entry.profile;
          cacheHit = true;
        } else if (entry?.kind === "negative") {
          // Known-bad handle — short-circuit without touching the provider.
          return recordError(parsed, options, entry.errorCode, started, {
            negativeCacheHit: true,
          });
        } else {
          profile = await fetchAndCache(parsed.username, parsed.sourceUrl, parsed.normalizedUrl);
        }

        const post = formatProfile(profile);
        const elapsedMs = elapsedSince(started);
        await shareEventsRepository.create({
          telegramUserId: options.telegramUserId,
          chatId: options.chatId,
          tweetId: `profile:${profile.username}`,
          sourceUrl: parsed.sourceUrl,
          mode: options.mode,
          status: "success",
        });
        log("success", {
          telegramUserId: options.telegramUserId,
          chatId: options.chatId,
          username: profile.username,
          mode: options.mode,
          cacheHit,
          elapsedMs,
        });
        return {
          status: "success",
          ok: true,
          username: profile.username,
          sourceUrl: parsed.sourceUrl,
          normalizedUrl: parsed.normalizedUrl,
          profile,
          post,
          errorCode: null,
          elapsedMs,
          cacheHit,
        };
      } catch (error) {
        if (error instanceof TweetProviderError) {
          return recordError(parsed, options, error.code, started);
        }

        console.error("profile_share unexpected error", error);
        return recordError(parsed, options, "unexpected_error", started);
      }
    },
  };
}

function invalidUrlResult(): ProfileShareResult {
  return {
    status: "invalid_url",
    ok: false,
    username: null,
    sourceUrl: null,
    normalizedUrl: null,
    profile: null,
    post: null,
    errorCode: "invalid_url",
    elapsedMs: null,
    cacheHit: false,
  };
}

function elapsedSince(started: number): number {
  return Math.round(performance.now() - started);
}

function log(status: string, fields: Record<string, unknown>): void {
  console.log(`profile_share status=${status}`, fields);
}
