import { formatTweet, type TelegramPost } from "@/formatters/telegram";
import { TweetProviderError, type TweetData, type TweetProvider } from "@/providers/base";
import type { ShareEventRepository } from "@/repositories/shareEvents";
import type { TweetCacheRepository } from "@/repositories/tweetCache";
import { extractFirstTweetUrl, type ParsedTweetUrl } from "@/utils/urls";

export type ShareMode = "private" | "inline";
export type ShareStatus = "success" | "error" | "invalid_url";

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
}

export interface ProcessOptions {
  telegramUserId: number;
  chatId: number | null;
  mode: ShareMode;
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
}

export function createTweetShareService(deps: Deps): TweetShareService {
  const { provider, cacheRepository, shareEventsRepository, cacheTtlSeconds } = deps;

  const recordError = async (
    parsed: ParsedTweetUrl,
    options: ProcessOptions,
    code: string,
    started: number,
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
        let tweet = await cacheRepository.get(parsed.tweetId);
        if (tweet === null) {
          tweet = await provider.getTweet(parsed.tweetId, parsed.normalizedUrl);
          await cacheRepository.set(tweet, parsed.sourceUrl, { ttlSeconds: cacheTtlSeconds });
        } else {
          cacheHit = true;
        }

        const post = formatTweet(tweet);
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
  };
}

function elapsedSince(started: number): number {
  return Math.round(performance.now() - started);
}

function log(status: string, fields: Record<string, unknown>): void {
  console.log(`tweet_share status=${status}`, fields);
}
