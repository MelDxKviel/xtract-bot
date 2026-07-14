import { formatThread, formatTweet, type TelegramPost } from "@/formatters/telegram";
import { TweetProviderError, type TweetData, type TweetProvider } from "@/providers/base";
import type { ShareEventRepository } from "@/repositories/shareEvents";
import type { TweetCacheRepository } from "@/repositories/tweetCache";
import { extractFirstTweetUrl, type ParsedTweetUrl } from "@/utils/urls";

export type ShareMode = "private" | "inline";
export type ShareStatus = "success" | "error" | "invalid_url";

// Errors that mean the tweet will never come back (deleted/private/not found):
// safe to negative-cache so we stop hammering providers. Transient errors
// (timeouts, rate limits, HTTP errors) are intentionally excluded.
const TERMINAL_ERROR_CODES = new Set(["not_found", "private_or_deleted"]);

export interface ShareResult {
  status: ShareStatus;
  ok: boolean;
  tweetId: string | null;
  sourceUrl: string | null;
  normalizedUrl: string | null;
  tweet: TweetData | null;
  post: TelegramPost | null;
  errorCode: string | null;
  elapsedMs: number | null;
  cacheHit: boolean;
  threadSize: number;
}

export interface ProcessOptions {
  telegramUserId: number;
  chatId: number | null;
  mode: ShareMode;
  /**
   * Force-disable thread unrolling for this request (e.g. the inline
   * "share single post" variant). Defaults to the service-wide setting.
   */
  unrollThread?: boolean;
}

export interface TweetShareService {
  processText(text: string, options: ProcessOptions): Promise<ShareResult>;
  processUrl(parsed: ParsedTweetUrl, options: ProcessOptions): Promise<ShareResult>;
}

interface Deps {
  provider: TweetProvider;
  cacheRepository: TweetCacheRepository;
  shareEventsRepository: Pick<ShareEventRepository, "create">;
  cacheTtlSeconds: number;
  negativeCacheTtlSeconds: number;
  threadUnrollEnabled: boolean;
  threadMaxTweets: number;
}

export function createTweetShareService(deps: Deps): TweetShareService {
  const {
    provider,
    cacheRepository,
    shareEventsRepository,
    cacheTtlSeconds,
    negativeCacheTtlSeconds,
    threadUnrollEnabled,
    threadMaxTweets,
  } = deps;

  // Fetch from the provider and write the result back to the cache (positive on
  // success, negative for terminal errors). Throws on any provider error.
  const fetchAndCache = async (
    tweetId: string,
    sourceUrl: string,
    normalizedUrl: string,
  ): Promise<TweetData> => {
    try {
      const tweet = await provider.getTweet(tweetId, normalizedUrl);
      await cacheRepository.set(tweet, sourceUrl, { ttlSeconds: cacheTtlSeconds });
      return tweet;
    } catch (error) {
      if (
        error instanceof TweetProviderError &&
        TERMINAL_ERROR_CODES.has(error.code) &&
        negativeCacheTtlSeconds > 0
      ) {
        await cacheRepository.setNegative(tweetId, sourceUrl, error.code, {
          ttlSeconds: negativeCacheTtlSeconds,
        });
      }
      throw error;
    }
  };

  // Load an ancestor while unrolling a thread. Any failure (missing, deleted,
  // provider error) stops the unroll rather than failing the whole share.
  const loadAncestor = async (tweetId: string): Promise<TweetData | null> => {
    const url = `https://x.com/i/status/${tweetId}`;
    try {
      const entry = await cacheRepository.getEntry(tweetId);
      if (entry?.kind === "hit") return entry.tweet;
      if (entry?.kind === "negative") return null;
      return await fetchAndCache(tweetId, url, url);
    } catch {
      return null;
    }
  };

  // Walk up the reply chain while the parent is the same author (a self-thread),
  // returning the tweets oldest → newest with the shared tweet last. X handles
  // are case-insensitive, and different providers/cached entries may disagree
  // on casing, so compare them case-insensitively.
  const sameAuthor = (a: TweetData, b: TweetData): boolean =>
    a.authorUsername.toLowerCase() === b.authorUsername.toLowerCase();

  const unrollThread = async (root: TweetData): Promise<TweetData[]> => {
    if (!threadUnrollEnabled || threadMaxTweets <= 1) return [root];
    let parent: TweetData | null = root.repliedToTweet;
    if (!parent || !sameAuthor(parent, root)) return [root];

    const ancestors: TweetData[] = [];
    while (parent && sameAuthor(parent, root)) {
      const current: TweetData = parent;
      ancestors.push(current);
      // Stop before fetching another ancestor once the cap (incl. root) is hit.
      if (ancestors.length + 1 >= threadMaxTweets) break;
      const parentId = current.inReplyToTweetId;
      if (!parentId) break;
      // The provider already fetched one level; reuse it instead of refetching.
      parent =
        current.repliedToTweet && current.repliedToTweet.tweetId === parentId
          ? current.repliedToTweet
          : await loadAncestor(parentId);
    }
    ancestors.reverse();
    return [...ancestors, root];
  };

  const recordError = async (
    parsed: ParsedTweetUrl,
    options: ProcessOptions,
    code: string,
    started: number,
    extra: { negativeCacheHit?: boolean } = {},
  ): Promise<ShareResult> => {
    const elapsedMs = elapsedSince(started);
    await shareEventsRepository.create({
      telegramUserId: options.telegramUserId,
      chatId: options.chatId,
      tweetId: parsed.tweetId,
      sourceUrl: parsed.sourceUrl,
      mode: options.mode,
      status: "error",
      errorCode: code,
    });
    log("error", {
      telegramUserId: options.telegramUserId,
      chatId: options.chatId,
      tweetId: parsed.tweetId,
      mode: options.mode,
      errorCode: code,
      negativeCacheHit: extra.negativeCacheHit ?? false,
      elapsedMs,
    });
    return {
      status: "error",
      ok: false,
      tweetId: parsed.tweetId,
      sourceUrl: parsed.sourceUrl,
      normalizedUrl: parsed.normalizedUrl,
      tweet: null,
      post: null,
      errorCode: code,
      elapsedMs,
      cacheHit: false,
      threadSize: 0,
    };
  };

  return {
    async processText(text, options): Promise<ShareResult> {
      const parsed = extractFirstTweetUrl(text);
      if (!parsed) {
        return invalidUrlResult();
      }
      return this.processUrl(parsed, options);
    },

    async processUrl(parsed, options): Promise<ShareResult> {
      const started = performance.now();
      let cacheHit = false;
      try {
        const entry = await cacheRepository.getEntry(parsed.tweetId);
        let tweet: TweetData;
        if (entry?.kind === "hit") {
          tweet = entry.tweet;
          cacheHit = true;
        } else if (entry?.kind === "negative") {
          // Known-bad tweet — short-circuit without touching the provider.
          return recordError(parsed, options, entry.errorCode, started, {
            negativeCacheHit: true,
          });
        } else {
          tweet = await fetchAndCache(parsed.tweetId, parsed.sourceUrl, parsed.normalizedUrl);
        }

        const wantThread = options.unrollThread !== false;
        const thread = wantThread ? await unrollThread(tweet) : [tweet];
        const post = thread.length > 1 ? formatThread(thread) : formatTweet(tweet);

        const elapsedMs = elapsedSince(started);
        await shareEventsRepository.create({
          telegramUserId: options.telegramUserId,
          chatId: options.chatId,
          tweetId: parsed.tweetId,
          sourceUrl: parsed.sourceUrl,
          mode: options.mode,
          status: "success",
        });
        log("success", {
          telegramUserId: options.telegramUserId,
          chatId: options.chatId,
          tweetId: parsed.tweetId,
          mode: options.mode,
          cacheHit,
          threadSize: thread.length,
          elapsedMs,
        });
        return {
          status: "success",
          ok: true,
          tweetId: parsed.tweetId,
          sourceUrl: parsed.sourceUrl,
          normalizedUrl: parsed.normalizedUrl,
          tweet,
          post,
          errorCode: null,
          elapsedMs,
          cacheHit,
          threadSize: thread.length,
        };
      } catch (error) {
        if (error instanceof TweetProviderError) {
          return recordError(parsed, options, error.code, started);
        }

        console.error("tweet_share unexpected error", error);
        return recordError(parsed, options, "unexpected_error", started);
      }
    },
  };
}

function invalidUrlResult(): ShareResult {
  return {
    status: "invalid_url",
    ok: false,
    tweetId: null,
    sourceUrl: null,
    normalizedUrl: null,
    tweet: null,
    post: null,
    errorCode: "invalid_url",
    elapsedMs: null,
    cacheHit: false,
    threadSize: 0,
  };
}

function elapsedSince(started: number): number {
  return Math.round(performance.now() - started);
}

function log(status: string, fields: Record<string, unknown>): void {
  console.log(`tweet_share status=${status}`, fields);
}
