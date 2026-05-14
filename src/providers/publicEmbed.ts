import { Parser } from "htmlparser2";

import {
  makeTweet,
  TweetProviderError,
  type TweetData,
  type TweetMedia,
  type TweetProvider,
} from "@/providers/base";
import { buildUrl, getFetch, withTimeout, type FetchLike } from "@/providers/http";

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const OEMBED_URL = "https://publish.twitter.com/oembed";
const FXTWITTER_URL = "https://api.fxtwitter.com/status/{tweet_id}";
const VXTWITTER_URL = "https://api.vxtwitter.com/Twitter/status/{tweet_id}";
const USER_AGENT = "xtract-bot/0.1 (+https://github.com/)";
const WHITESPACE_RE = /[ \t\r\f\v]+/g;

const log = (message: string, ...args: unknown[]): void => {
  console.log(`[public_embed] ${message}`, ...args);
};

type Getter = (tweetId: string, sourceUrl: string) => Promise<TweetData>;
type GetterEntry = readonly [name: string, fn: Getter];

export interface PublicEmbedOptions {
  timeoutSeconds?: number;
  fetch?: FetchLike;
}

export class PublicEmbedTweetProvider implements TweetProvider {
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: PublicEmbedOptions = {}) {
    this.timeoutMs = Math.round((options.timeoutSeconds ?? 10) * 1000);
    this.fetchImpl = getFetch(options.fetch);
  }

  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    const errors: TweetProviderError[] = [];
    const getters: GetterEntry[] = [
      ["fxtwitter", (id, src) => this.getFromFxtwitter(id, src)],
      ["vxtwitter", (id, src) => this.getFromVxtwitter(id, src)],
      ["syndication", (id, src) => this.getFromSyndication(id, src)],
      ["oembed", (id, src) => this.getFromOembed(id, src)],
    ];

    for (const [name, getter] of getters) {
      try {
        const tweet = await getter(tweetId, sourceUrl);
        ensureUsableTweet(tweet);
        log(`tweet_id=${tweetId} provider=${name} ok`);
        return tweet;
      } catch (error) {
        if (error instanceof TweetProviderError) {
          log(`tweet_id=${tweetId} provider=${name} failed: ${error.code}`);
          errors.push(error);
        } else {
          throw error;
        }
      }
    }

    throw selectProviderError(errors);
  }

  async health(): Promise<boolean> {
    try {
      const url = buildUrl(OEMBED_URL, "", {
        url: "https://twitter.com/jack/status/20",
        omit_script: "1",
        dnt: "1",
      });
      const { signal, clear } = withTimeout(this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, this.fetchInit(signal));
        return response.status < 500;
      } finally {
        clear();
      }
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    // no-op
  }

  private async getFromFxtwitter(tweetId: string, sourceUrl: string): Promise<TweetData> {
    return this.fetchPublicApiTweet(FXTWITTER_URL, tweetId, sourceUrl);
  }

  private async getFromVxtwitter(tweetId: string, sourceUrl: string): Promise<TweetData> {
    return this.fetchPublicApiTweet(VXTWITTER_URL, tweetId, sourceUrl);
  }

  private async fetchPublicApiTweet(
    urlTemplate: string,
    tweetId: string,
    sourceUrl: string,
  ): Promise<TweetData> {
    const payload = await this.getJson(urlTemplate.replace("{tweet_id}", tweetId));
    const tweet = tweetFromPublicApi(payload, sourceUrl, tweetId, new Set());
    const data = isRecord(payload.tweet) ? (payload.tweet as Record<string, any>) : payload;
    const repliedToId = repliedToIdFromPublicApi(data);
    if (repliedToId && repliedToId !== tweetId) {
      try {
        const parentPayload = await this.getJson(urlTemplate.replace("{tweet_id}", repliedToId));
        tweet.repliedToTweet = tweetFromPublicApi(
          parentPayload,
          `https://x.com/i/status/${repliedToId}`,
          repliedToId,
          new Set(),
        );
      } catch (error) {
        if (error instanceof TweetProviderError) {
          log(`tweet_id=${tweetId} replied_to fetch failed: ${error.code}`);
        } else {
          throw error;
        }
      }
    }
    return tweet;
  }

  private async getFromSyndication(tweetId: string, sourceUrl: string): Promise<TweetData> {
    const payload = await this.getJson(SYNDICATION_URL, { id: tweetId, lang: "en" });
    if (isTombstone(payload)) {
      throw new TweetProviderError("tweet is unavailable", { code: "private_or_deleted" });
    }
    const tweet = tweetFromSyndication(payload, sourceUrl, tweetId, new Set());
    const repliedToId = firstStr(payload, "in_reply_to_status_id_str", "in_reply_to_status_id");
    if (repliedToId && repliedToId !== tweetId) {
      try {
        const parentPayload = await this.getJson(SYNDICATION_URL, {
          id: repliedToId,
          lang: "en",
        });
        if (!isTombstone(parentPayload)) {
          tweet.repliedToTweet = tweetFromSyndication(
            parentPayload,
            `https://x.com/i/status/${repliedToId}`,
            repliedToId,
            new Set(),
          );
        }
      } catch (error) {
        if (error instanceof TweetProviderError) {
          log(`syndication tweet_id=${tweetId} replied_to failed: ${error.code}`);
        } else {
          throw error;
        }
      }
    }
    return tweet;
  }

  private async getFromOembed(tweetId: string, sourceUrl: string): Promise<TweetData> {
    const payload = await this.getJson(OEMBED_URL, {
      url: oembedTweetUrl(sourceUrl),
      omit_script: "1",
      dnt: "1",
    });
    const html = String(payload.html ?? "");
    if (!html) {
      throw new TweetProviderError("embed response has no html", { code: "provider_bad_response" });
    }

    const parsed = parseEmbedHtml(html);
    let authorUrl = String(payload.author_url ?? "");
    const username = usernameFromUrl(authorUrl) ?? usernameFromUrl(sourceUrl) ?? "unknown";
    authorUrl = canonicalAuthorUrl(username);
    const text = parsed.tweetText;
    if (!text) {
      throw new TweetProviderError("embed response has no tweet text", {
        code: "provider_bad_response",
      });
    }

    const media: TweetMedia[] = parsed.imageUrls.filter(looksLikeTwitterMedia).map((url) => ({
      type: "photo" as const,
      url,
      previewUrl: null,
      width: null,
      height: null,
      durationMs: null,
    }));
    const tweetUrl = canonicalizeTweetUrl(String(payload.url ?? sourceUrl));
    return makeTweet({
      tweetId,
      url: tweetUrl,
      authorName: String(payload.author_name ?? username),
      authorUsername: username,
      authorUrl,
      text,
      media,
      lang: parsed.lang,
    });
  }

  private async getJson(
    url: string,
    params?: Record<string, string>,
  ): Promise<Record<string, any>> {
    const fullUrl = params ? buildUrl(url, "", params) : url;
    const { signal, clear } = withTimeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(fullUrl, this.fetchInit(signal));
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
    if (response.status === 403) {
      throw new TweetProviderError("tweet is private or unavailable", {
        code: "private_or_deleted",
      });
    }
    if (response.status === 429) {
      throw new TweetProviderError("embed endpoint rate limit exceeded", {
        code: "provider_rate_limited",
      });
    }
    if (response.status >= 400) {
      throw new TweetProviderError(`embed endpoint returned HTTP ${response.status}`, {
        code: "provider_http_error",
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TweetProviderError("embed endpoint returned invalid JSON", {
        code: "provider_bad_response",
      });
    }
    if (!isRecord(payload)) {
      throw new TweetProviderError("embed endpoint returned non-object JSON", {
        code: "provider_bad_response",
      });
    }
    return payload;
  }

  private fetchInit(signal: AbortSignal): RequestInit {
    return {
      headers: {
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal,
    };
  }
}

// -------- helpers shared with both APIs --------

function tweetFromPublicApi(
  payload: Record<string, any>,
  sourceUrl: string,
  requestedTweetId: string,
  seenIds: Set<string>,
): TweetData {
  raiseForPublicApiError(payload);
  const data = isRecord(payload.tweet) ? (payload.tweet as Record<string, any>) : payload;
  if (!isRecord(data)) {
    throw new TweetProviderError("public API returned no tweet object", {
      code: "provider_bad_response",
    });
  }

  const tweetId = firstStr(data, "id", "tweetID", "id_str", "conversationID") ?? requestedTweetId;
  const username = publicApiUsername(data);
  const authorName = publicApiAuthorName(data, username);
  const tweetUrl = publicApiTweetUrl(data, username, tweetId, sourceUrl);

  let quotedTweet: TweetData | null = null;
  const quotedPayload = firstDict(
    data,
    "qrt",
    "quote",
    "quoted",
    "quoted_tweet",
    "quotedTweet",
    "quoted_status",
    "quotedStatus",
  );
  if (isRecord(quotedPayload)) {
    const quotedId = firstStr(quotedPayload, "id", "tweetID", "id_str", "conversationID");
    const nextSeen = new Set(seenIds);
    nextSeen.add(tweetId);
    if (quotedId && !seenIds.has(quotedId) && quotedId !== tweetId) {
      quotedTweet = tweetFromPublicApi(
        quotedPayload,
        publicApiTweetUrl(quotedPayload, publicApiUsername(quotedPayload), quotedId, tweetUrl),
        quotedId,
        nextSeen,
      );
    }
  }

  return makeTweet({
    tweetId,
    url: tweetUrl,
    authorName,
    authorUsername: username,
    authorUrl: publicApiAuthorUrl(data, username),
    text: publicApiText(data),
    createdAt: publicApiDatetime(data),
    media: mediaFromPublicApi(data),
    quotedTweet,
    lang: typeof data.lang === "string" ? data.lang : null,
  });
}

function raiseForPublicApiError(payload: Record<string, any>): void {
  const code = payload.code;
  if (code === undefined || code === null || code === 200 || code === "200") return;

  const message = String(payload.message ?? payload.error ?? "public API error");
  if (code === 403 || code === "403") {
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

function publicApiText(data: Record<string, any>): string | null {
  let value: unknown = data.text;
  if (typeof value !== "string") {
    const rawText = data.raw_text;
    value = isRecord(rawText) ? rawText.text : null;
  }
  if (typeof value !== "string") return null;
  const normalized = normalizeText(decodeHtmlEntities(value));
  return normalized || null;
}

function publicApiUsername(data: Record<string, any>): string {
  const author = isRecord(data.author) ? (data.author as Record<string, any>) : {};
  const candidate =
    author.screen_name ??
    author.username ??
    data.user_screen_name ??
    usernameFromUrl(String(data.url ?? data.tweetURL ?? ""));
  if (typeof candidate === "string" && candidate.trim()) {
    return candidate.trim().replace(/^@+/, "");
  }
  return "unknown";
}

function publicApiAuthorName(data: Record<string, any>, username: string): string {
  const author = isRecord(data.author) ? (data.author as Record<string, any>) : {};
  const value = author.name ?? data.user_name ?? username;
  return String(value ?? username);
}

function publicApiAuthorUrl(data: Record<string, any>, username: string): string {
  const author = isRecord(data.author) ? (data.author as Record<string, any>) : {};
  const value = author.url;
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return canonicalizeAuthorUrl(value);
  }
  return canonicalAuthorUrl(username);
}

function publicApiTweetUrl(
  data: Record<string, any>,
  username: string,
  tweetId: string,
  fallback: string,
): string {
  if (username !== "unknown" && tweetId) {
    return canonicalTweetUrl(username, tweetId, fallback);
  }
  const value = data.url ?? data.tweetURL;
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return canonicalizeTweetUrl(value);
  }
  return canonicalizeTweetUrl(fallback);
}

function publicApiDatetime(data: Record<string, any>): Date | null {
  const value = data.created_at ?? data.date;
  const parsed = parseDatetime(value);
  if (parsed !== null) return parsed;
  const timestamp = intOrNull(data.created_timestamp ?? data.date_epoch);
  if (timestamp === null) return null;
  return new Date(timestamp * 1000);
}

function mediaFromPublicApi(data: Record<string, any>): TweetMedia[] {
  const media: TweetMedia[] = [];
  const seen = new Set<string>();
  const add = (item: TweetMedia | null): void => {
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    media.push(item);
  };

  const mediaPayload = isRecord(data.media) ? (data.media as Record<string, any>) : {};
  const allMedia = mediaPayload.all;
  if (Array.isArray(allMedia)) {
    for (const item of allMedia) {
      if (isRecord(item)) add(mediaFromPublicItem(item));
    }
  } else {
    for (const key of ["photos", "videos", "gifs"]) {
      const items = mediaPayload[key];
      if (Array.isArray(items)) {
        for (const item of items) {
          if (isRecord(item)) add(mediaFromPublicItem(item));
        }
      }
    }
  }

  const mediaExtended = data.media_extended;
  if (Array.isArray(mediaExtended)) {
    for (const item of mediaExtended) {
      if (isRecord(item)) add(mediaFromPublicItem(item));
    }
  }

  const mediaUrls = data.mediaURLs;
  if (Array.isArray(mediaUrls)) {
    for (const url of mediaUrls) {
      if (typeof url === "string") {
        add({
          type: "photo",
          url,
          previewUrl: null,
          width: null,
          height: null,
          durationMs: null,
        });
      }
    }
  }

  return media;
}

function mediaFromPublicItem(item: Record<string, any>): TweetMedia | null {
  const mediaTypeRaw = String(item.type ?? "").toLowerCase();
  const url = mediaUrl(item) ?? firstStr(item, "video_url", "download_url");
  if (!url) return null;

  let normalizedType: TweetMedia["type"];
  if (mediaTypeRaw === "photo" || mediaTypeRaw === "image") normalizedType = "photo";
  else if (mediaTypeRaw === "gif" || mediaTypeRaw === "animated_gif") normalizedType = "gif";
  else if (mediaTypeRaw === "video") normalizedType = "video";
  else if (looksLikeTwitterMedia(url)) normalizedType = "photo";
  else return null;

  return {
    type: normalizedType,
    url,
    previewUrl: firstStr(item, "thumbnail_url", "preview_url", "poster"),
    width: intOrNull(item.width) ?? nestedInt(item, "size", "width"),
    height: intOrNull(item.height) ?? nestedInt(item, "size", "height"),
    durationMs: intOrNull(item.duration_ms ?? item.duration_millis),
  };
}

function tweetFromSyndication(
  payload: Record<string, any>,
  sourceUrl: string,
  requestedTweetId: string,
  seenIds: Set<string>,
): TweetData {
  if (isTombstone(payload)) {
    throw new TweetProviderError("tweet is unavailable", { code: "private_or_deleted" });
  }

  const tweetId = String(payload.id_str ?? payload.id ?? requestedTweetId);
  const user = isRecord(payload.user) ? (payload.user as Record<string, any>) : {};
  const username = usernameFromUser(user) ?? usernameFromUrl(sourceUrl) ?? "unknown";
  const authorName = String(user.name ?? user.display_name ?? username);

  let quotedTweet: TweetData | null = null;
  const quotedPayload = firstDict(
    payload,
    "quoted_tweet",
    "quotedTweet",
    "quoted_status",
    "quotedStatus",
    "quote",
    "quoted",
    "qrt",
  );
  if (isRecord(quotedPayload)) {
    const quotedId = String(quotedPayload.id_str ?? quotedPayload.id ?? "");
    if (quotedId && !seenIds.has(quotedId) && quotedId !== tweetId) {
      const nextSeen = new Set(seenIds);
      nextSeen.add(tweetId);
      quotedTweet = tweetFromSyndication(
        quotedPayload,
        tweetUrlFromPayload(quotedPayload, sourceUrl),
        quotedId,
        nextSeen,
      );
    }
  }

  return makeTweet({
    tweetId,
    url: canonicalTweetUrl(username, tweetId, sourceUrl),
    authorName,
    authorUsername: username,
    authorUrl: canonicalAuthorUrl(username),
    text: textFromSyndication(payload),
    createdAt: parseDatetime(payload.created_at),
    media: mediaFromSyndication(payload),
    quotedTweet,
    lang: typeof payload.lang === "string" ? payload.lang : null,
  });
}

function textFromSyndication(payload: Record<string, any>): string | null {
  const value = payload.text ?? payload.full_text ?? payload.description;
  if (typeof value !== "string") return null;
  return normalizeText(decodeHtmlEntities(value)) || null;
}

function mediaFromSyndication(payload: Record<string, any>): TweetMedia[] {
  const media: TweetMedia[] = [];
  const seen = new Set<string>();
  const add = (item: TweetMedia | null): void => {
    if (!item || seen.has(item.url)) return;
    seen.add(item.url);
    media.push(item);
  };

  const photos = payload.photos;
  if (Array.isArray(photos)) {
    for (const photo of photos) {
      if (isRecord(photo)) add(photoFromPayload(photo));
    }
  }

  for (const detailsKey of ["mediaDetails", "media_details"]) {
    const details = payload[detailsKey];
    if (Array.isArray(details)) {
      for (const item of details) {
        if (isRecord(item)) add(mediaFromDetail(item));
      }
    }
  }

  const entities = payload.entities;
  const entityMedia = isRecord(entities) ? entities.media : null;
  if (Array.isArray(entityMedia)) {
    for (const item of entityMedia) {
      if (isRecord(item)) add(mediaFromDetail(item));
    }
  }

  const video = payload.video;
  if (isRecord(video)) add(videoFromPayload(video));

  return media;
}

function photoFromPayload(payload: Record<string, any>): TweetMedia | null {
  const url = mediaUrl(payload);
  if (!url) return null;
  return {
    type: "photo",
    url,
    previewUrl: null,
    width: intOrNull(payload.width),
    height: intOrNull(payload.height),
    durationMs: null,
  };
}

function mediaFromDetail(payload: Record<string, any>): TweetMedia | null {
  const mediaType = payload.type;
  if (mediaType === "photo") return photoFromPayload(payload);
  if (mediaType !== "video" && mediaType !== "animated_gif") return null;

  const videoInfo = isRecord(payload.video_info) ? (payload.video_info as Record<string, any>) : {};
  const url = bestVariantUrl(videoInfo.variants);
  const preview = mediaUrl(payload);
  if (!url) return null;
  return {
    type: mediaType === "animated_gif" ? "gif" : "video",
    url,
    previewUrl: preview,
    width: sizeValue(payload, "w") ?? intOrNull(payload.width),
    height: sizeValue(payload, "h") ?? intOrNull(payload.height),
    durationMs: intOrNull(videoInfo.duration_millis),
  };
}

function videoFromPayload(payload: Record<string, any>): TweetMedia | null {
  const url = bestVariantUrl(payload.variants);
  const preview = String(payload.poster ?? payload.thumbnail ?? payload.preview_image_url ?? "");
  if (!url) return null;
  const type: TweetMedia["type"] = payload.type === "animated_gif" ? "gif" : "video";
  return {
    type,
    url,
    previewUrl: preview || null,
    width: intOrNull(payload.width),
    height: intOrNull(payload.height),
    durationMs: intOrNull(payload.duration_ms ?? payload.duration_millis),
  };
}

function bestVariantUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const variants = value.filter(
    (item) =>
      isRecord(item) &&
      typeof item.url === "string" &&
      String(item.content_type ?? "").toLowerCase() === "video/mp4",
  );
  if (variants.length === 0) return null;
  variants.sort(
    (a: any, b: any) =>
      (intOrNull(a.bitrate ?? a.bit_rate) ?? 0) - (intOrNull(b.bitrate ?? b.bit_rate) ?? 0),
  );
  return String(variants[variants.length - 1]!.url);
}

function mediaUrl(payload: Record<string, any>): string | null {
  const value = payload.url ?? payload.media_url_https ?? payload.media_url ?? payload.mediaUrl;
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) return null;
  return value;
}

function tweetUrlFromPayload(payload: Record<string, any>, fallback: string): string {
  const tweetId = String(payload.id_str ?? payload.id ?? "");
  const user = isRecord(payload.user) ? (payload.user as Record<string, any>) : {};
  const username = usernameFromUser(user);
  if (tweetId && username) return `https://x.com/${username}/status/${tweetId}`;
  return fallback;
}

function oembedTweetUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname) return url;
    return `https://twitter.com${parsed.pathname}`;
  } catch {
    return url;
  }
}

function ensureUsableTweet(tweet: TweetData): void {
  const hasContent = Boolean(
    tweet.text || tweet.media.length || tweet.quotedTweet || tweet.repliedToTweet,
  );
  if (!hasContent) {
    throw new TweetProviderError("provider returned tweet without content", {
      code: "provider_bad_response",
    });
  }
  if (tweet.authorUsername === "unknown") {
    throw new TweetProviderError("provider returned tweet without author", {
      code: "provider_bad_response",
    });
  }
}

function selectProviderError(errors: TweetProviderError[]): TweetProviderError {
  if (errors.length === 0) {
    return new TweetProviderError("tweet provider failed", { code: "provider_error" });
  }
  for (const code of ["not_found", "private_or_deleted", "provider_rate_limited"] as const) {
    for (let i = errors.length - 1; i >= 0; i -= 1) {
      if (errors[i]!.code === code) return errors[i]!;
    }
  }
  return errors[errors.length - 1]!;
}

function canonicalTweetUrl(username: string, tweetId: string, fallback: string): string {
  if (username && username !== "unknown" && tweetId) {
    return `https://x.com/${username.replace(/^@+/, "")}/status/${tweetId}`;
  }
  return canonicalizeTweetUrl(fallback);
}

function canonicalizeTweetUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    if ((part !== "status" && part !== "statuses") || index + 1 >= parts.length) continue;
    const tweetId = parts[index + 1]!;
    const username = index > 0 ? parts[index - 1]! : "";
    if (username && username !== "i" && username !== "intent" && username !== "share") {
      return `https://x.com/${username}/status/${tweetId}`;
    }
  }
  return url;
}

function canonicalizeAuthorUrl(url: string): string {
  const username = usernameFromUrl(url);
  return username ? canonicalAuthorUrl(username) : url;
}

function firstStr(payload: Record<string, any>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function repliedToIdFromPublicApi(data: Record<string, any>): string | null {
  const direct = firstStr(data, "replying_to_status", "replyingToID");
  if (direct) return direct;
  const replyingTo = data.replying_to;
  if (isRecord(replyingTo)) return firstStr(replyingTo, "status");
  return null;
}

function firstDict(payload: Record<string, any>, ...keys: string[]): Record<string, any> | null {
  for (const key of keys) {
    const value = payload[key];
    if (isRecord(value)) {
      const nested = isRecord((value as Record<string, any>).tweet)
        ? ((value as Record<string, any>).tweet as Record<string, any>)
        : null;
      return nested ?? (value as Record<string, any>);
    }
  }
  return null;
}

function nestedInt(
  payload: Record<string, any>,
  objectKey: string,
  valueKey: string,
): number | null {
  const nested = payload[objectKey];
  if (!isRecord(nested)) return null;
  return intOrNull(nested[valueKey]);
}

function usernameFromUser(user: Record<string, any>): string | null {
  const value = user.screen_name ?? user.username;
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().replace(/^@+/, "");
}

function usernameFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (
    host !== "x.com" &&
    host !== "twitter.com" &&
    host !== "mobile.twitter.com" &&
    host !== "vxtwitter.com"
  ) {
    return null;
  }
  const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts[0] === "i" || parts[0] === "intent" || parts[0] === "share") {
    return null;
  }
  return parts[0]!.replace(/^@+/, "");
}

function canonicalAuthorUrl(username: string): string {
  return `https://x.com/${username.replace(/^@+/, "")}`;
}

function looksLikeTwitterMedia(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "twimg.com" ||
    host.endsWith(".twimg.com") ||
    host === "twitter.com" ||
    host.endsWith(".twitter.com") ||
    host === "x.com" ||
    host.endsWith(".x.com")
  );
}

function normalizeText(value: string): string {
  const normalized = value.replace(/ /g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized
    .split("\n")
    .map((line) => line.replace(WHITESPACE_RE, " ").trim())
    .join("\n")
    .trim();
}

function parseDatetime(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value) return null;
  // Try ISO first
  const iso = value.replace("Z", "+00:00");
  const parsedIso = new Date(iso);
  if (!Number.isNaN(parsedIso.getTime()) && /\d{4}-\d{2}-\d{2}/.test(value)) {
    return parsedIso;
  }
  // Twitter format: "Sat Apr 25 09:27:25 +0000 2026"
  const twitter = parseTwitterDate(value);
  if (twitter) return twitter;
  // Fallback: maybe ISO without explicit yyyy-mm-dd marker still parseable
  if (!Number.isNaN(parsedIso.getTime())) return parsedIso;
  return null;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseTwitterDate(value: string): Date | null {
  // "Sat Apr 25 09:27:25 +0000 2026"
  const match = value.match(
    /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})\s+(\d{4})$/,
  );
  if (!match) return null;
  const [, monthName, day, hh, mm, ss, tz, year] = match;
  const month = MONTHS[monthName!];
  if (month === undefined) return null;
  const offsetSign = tz!.charAt(0) === "-" ? -1 : 1;
  const offsetMin = offsetSign * (Number(tz!.slice(1, 3)) * 60 + Number(tz!.slice(3, 5)));
  const utc = Date.UTC(Number(year), month, Number(day), Number(hh), Number(mm), Number(ss));
  const epoch = utc - offsetMin * 60_000;
  const date = new Date(epoch);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isTombstone(payload: Record<string, any>): boolean {
  const typename = String(payload.__typename ?? "").toLowerCase();
  return Boolean(payload.tombstone) || typename.includes("tombstone");
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function sizeValue(payload: Record<string, any>, key: string): number | null {
  const sizes = payload.sizes;
  if (!isRecord(sizes)) return null;
  const large = sizes.large;
  if (!isRecord(large)) return null;
  return intOrNull(large[key]);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

// -------- embed HTML parser --------

interface ParsedEmbed {
  tweetText: string;
  imageUrls: string[];
  lang: string | null;
}

function parseEmbedHtml(html: string): ParsedEmbed {
  let blockquoteDepth = 0;
  let paragraphDepth = 0;
  const paragraphParts: string[] = [];
  const blockquoteParts: string[] = [];
  const imageUrls: string[] = [];
  let lang: string | null = null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "blockquote") {
          blockquoteDepth += 1;
        } else if (name === "p" && blockquoteDepth && paragraphDepth === 0) {
          paragraphDepth = 1;
          if (attrs.lang) lang = attrs.lang;
        } else if (name === "br" && paragraphDepth) {
          paragraphParts.push("\n");
        }
        if (name === "img" && attrs.src) {
          imageUrls.push(attrs.src);
        }
      },
      ontext(text) {
        if (blockquoteDepth) blockquoteParts.push(text);
        if (paragraphDepth) paragraphParts.push(text);
      },
      onclosetag(name) {
        if (name === "p" && paragraphDepth) paragraphDepth = 0;
        else if (name === "blockquote" && blockquoteDepth) blockquoteDepth -= 1;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const direct = normalizeText(paragraphParts.join(""));
  let tweetText = direct;
  if (!tweetText) {
    const fallback = normalizeText(blockquoteParts.join(""));
    tweetText = fallback.split("—")[0]!.trim();
  }

  return { tweetText, imageUrls, lang };
}
