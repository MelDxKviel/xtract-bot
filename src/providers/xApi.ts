import {
  makeTweet,
  TweetProviderError,
  type TweetData,
  type TweetMedia,
  type TweetProvider,
} from "@/providers/base";
import { buildUrl, getFetch, withTimeout, type FetchLike } from "@/providers/http";

const BASE_URL = "https://api.twitter.com/2";

interface XApiUser {
  id: string;
  name?: string;
  username?: string;
  url?: string;
}

interface XApiMedia {
  media_key: string;
  type: string;
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
  variants?: Array<{ content_type?: string; bit_rate?: number; url?: string }>;
}

interface XApiTweet {
  id: string;
  author_id?: string;
  text?: string;
  created_at?: string;
  lang?: string;
  attachments?: { media_keys?: string[] };
  referenced_tweets?: Array<{ type: string; id: string }>;
}

interface XApiResponse {
  data: XApiTweet;
  includes?: {
    users?: XApiUser[];
    tweets?: XApiTweet[];
    media?: XApiMedia[];
  };
}

export class XApiTweetProvider implements TweetProvider {
  private readonly bearerToken: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(bearerToken: string, options: { timeoutSeconds?: number; fetch?: FetchLike } = {}) {
    this.bearerToken = bearerToken;
    this.timeoutMs = Math.round((options.timeoutSeconds ?? 10) * 1000);
    this.fetchImpl = getFetch(options.fetch);
  }

  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    const url = buildUrl(BASE_URL + "/", `tweets/${encodeURIComponent(tweetId)}`, {
      "tweet.fields": "attachments,author_id,created_at,lang,referenced_tweets",
      expansions:
        "author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id",
      "user.fields": "name,username,url",
      "media.fields": "duration_ms,height,preview_image_url,type,url,variants,width",
    });

    const { signal, clear } = withTimeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
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
      throw new TweetProviderError("tweet not found", { code: "not_found" });
    }
    if (response.status === 401) {
      throw new TweetProviderError("X API authentication failed", { code: "provider_auth" });
    }
    if (response.status === 429) {
      throw new TweetProviderError("X API rate limit exceeded", { code: "provider_rate_limited" });
    }
    if (!response.ok) {
      throw new TweetProviderError(`X API HTTP ${response.status}`, {
        code: "provider_http_error",
      });
    }

    let payload: XApiResponse;
    try {
      payload = (await response.json()) as XApiResponse;
    } catch (error) {
      throw new TweetProviderError(String(error), { code: "provider_bad_response" });
    }

    if (!payload.data) {
      throw new TweetProviderError("X API returned empty response", { code: "not_found" });
    }
    return this.parseResponse(payload, sourceUrl);
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // no-op
  }

  private parseResponse(payload: XApiResponse, sourceUrl: string): TweetData {
    const includes = payload.includes ?? {};
    const usersById = new Map<string, XApiUser>(
      (includes.users ?? []).map((item) => [item.id, item]),
    );
    const tweetsById = new Map<string, XApiTweet>(
      (includes.tweets ?? []).map((item) => [item.id, item]),
    );
    const mediaByKey = new Map<string, XApiMedia>(
      (includes.media ?? []).map((item) => [item.media_key, item]),
    );

    const rootId = String(payload.data.id);
    const build = (tweet: XApiTweet, seen: Set<string>): TweetData => {
      const currentId = String(tweet.id);
      seen.add(currentId);
      const user = (tweet.author_id ? usersById.get(tweet.author_id) : undefined) ?? {};
      const username = (user as XApiUser).username ?? "unknown";
      const authorUrl = `https://x.com/${username}`;

      const media: TweetMedia[] = [];
      for (const key of tweet.attachments?.media_keys ?? []) {
        const parsed = this.parseMedia(mediaByKey.get(key));
        if (parsed) media.push(parsed);
      }

      let quotedTweet: TweetData | null = null;
      let repliedToTweet: TweetData | null = null;
      for (const ref of tweet.referenced_tweets ?? []) {
        const refId = String(ref.id);
        if (seen.has(refId) || !tweetsById.has(refId)) continue;
        if (ref.type === "quoted" && quotedTweet === null) {
          quotedTweet = build(tweetsById.get(refId)!, new Set(seen));
        }
        if (ref.type === "replied_to" && repliedToTweet === null) {
          repliedToTweet = build(tweetsById.get(refId)!, new Set(seen));
        }
      }

      return makeTweet({
        tweetId: currentId,
        url: currentId === rootId ? sourceUrl : `${authorUrl}/status/${currentId}`,
        authorName: (user as XApiUser).name ?? username,
        authorUsername: username,
        authorUrl,
        text: tweet.text ?? null,
        createdAt: tweet.created_at ? parseIsoDate(tweet.created_at) : null,
        media,
        quotedTweet,
        repliedToTweet,
        lang: tweet.lang ?? null,
      });
    };

    return build(payload.data, new Set());
  }

  private parseMedia(payload: XApiMedia | undefined): TweetMedia | null {
    if (!payload) return null;
    const type = payload.type;
    if (type === "photo") {
      const url = payload.url ?? payload.preview_image_url;
      if (!url) return null;
      return {
        type: "photo",
        url,
        previewUrl: null,
        width: payload.width ?? null,
        height: payload.height ?? null,
        durationMs: null,
      };
    }
    if (type === "video" || type === "animated_gif") {
      const url = this.bestVariantUrl(payload) ?? payload.preview_image_url;
      if (!url) return null;
      return {
        type: type === "animated_gif" ? "gif" : "video",
        url,
        previewUrl: payload.preview_image_url ?? null,
        width: payload.width ?? null,
        height: payload.height ?? null,
        durationMs: payload.duration_ms ?? null,
      };
    }
    return null;
  }

  private bestVariantUrl(payload: XApiMedia): string | null {
    const variants = (payload.variants ?? []).filter(
      (item) => item.content_type === "video/mp4" && item.url,
    );
    if (variants.length === 0) return null;
    variants.sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
    return variants[0]!.url!;
  }
}

function parseIsoDate(value: string): Date | null {
  const date = new Date(value.replace("Z", "+00:00"));
  return Number.isNaN(date.getTime()) ? null : date;
}
