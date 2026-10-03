import type { TweetData, TweetMedia, TweetVideoVariant } from "@/providers/base";
import { getFetch, withTimeout, type FetchLike } from "@/providers/http";
import { isVideoPoster } from "@/providers/video";

// https://core.telegram.org/bots/api#sending-files — URL fetches are capped at 20 MB.
const MAX_URL_VIDEO_BYTES = 20_000_000;
const PROBE_TIMEOUT_MS = 5_000;

/** Old cache entries discarded the alternatives or stored a video poster as a photo. */
export function needsVideoRefresh(tweet: TweetData): boolean {
  return (
    tweet.media.some((item) =>
      item.type === "photo" ? isVideoPoster(item.url) : item.videoVariants === undefined,
    ) ||
    Boolean(tweet.quotedTweet && needsVideoRefresh(tweet.quotedTweet)) ||
    Boolean(tweet.repliedToTweet && needsVideoRefresh(tweet.repliedToTweet))
  );
}

/** Select once before caching so private and inline messages use the same playable file. */
export async function selectTweetVideos(tweet: TweetData, fetch?: FetchLike): Promise<void> {
  const { signal, clear } = withTimeout(PROBE_TIMEOUT_MS);
  const visit = async (current: TweetData): Promise<void> => {
    await Promise.all([
      ...current.media.map((item) => selectVideo(item, getFetch(fetch), signal)),
      current.quotedTweet ? visit(current.quotedTweet) : undefined,
      current.repliedToTweet ? visit(current.repliedToTweet) : undefined,
    ]);
  };
  try {
    await visit(tweet);
  } finally {
    clear();
  }
}

async function selectVideo(item: TweetMedia, fetch: FetchLike, signal: AbortSignal): Promise<void> {
  if (item.type === "photo") return;
  const variants = item.videoVariants ?? [];
  item.videoVariants = variants;
  if (variants.length < 2) return;

  const ordered = [...variants].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const unknown: TweetVideoVariant[] = [];
  const sized: Array<{ variant: TweetVideoVariant; size: number }> = [];
  for (const variant of ordered) {
    const size = await videoSize(variant.url, fetch, signal);
    if (size === null) {
      unknown.push(variant);
    } else if (size <= MAX_URL_VIDEO_BYTES) {
      useVariant(item, variant);
      return;
    } else {
      sized.push({ variant, size });
    }
  }

  // A failed HEAD request must not fail the share. Estimate only unverified files;
  // never retry a known oversized variant just because its bitrate looks smaller.
  const estimated = unknown.find(
    (variant) =>
      item.durationMs !== null &&
      item.durationMs > 0 &&
      variant.bitrate !== null &&
      (variant.bitrate * item.durationMs) / 8000 <= MAX_URL_VIDEO_BYTES,
  );
  const fallback = estimated ?? unknown.at(-1) ?? sized.sort((a, b) => a.size - b.size)[0]?.variant;
  // Even when every file exceeds 20 MB, the smallest can still fit the private
  // chat's upload limit. Keep it as video; the handlers never substitute a poster.
  if (fallback) useVariant(item, fallback);
}

async function videoSize(
  url: string,
  fetch: FetchLike,
  signal: AbortSignal,
): Promise<number | null> {
  try {
    const parsed = new URL(url);
    if (
      signal.aborted ||
      parsed.protocol !== "https:" ||
      parsed.hostname !== "video.twimg.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password
    )
      return null;
    const response = await fetch(url, { method: "HEAD", redirect: "error", signal });
    try {
      if (!response.ok) return null;
      const size = Number(response.headers.get("content-length"));
      return Number.isSafeInteger(size) && size > 0 ? size : null;
    } finally {
      await response.body?.cancel();
    }
  } catch {
    return null;
  }
}

function useVariant(item: TweetMedia, variant: TweetVideoVariant): void {
  if (item.url === variant.url) return;
  item.url = variant.url;
  // X MP4 paths include the rendition's dimensions; do not retain 1080p metadata
  // when sending 720p. Unknown paths let Telegram detect the dimensions itself.
  let dimensions: RegExpMatchArray | null = null;
  try {
    dimensions = new URL(variant.url).pathname.match(/\/(\d+)x(\d+)\//);
  } catch {
    // The formatter will discard malformed URLs from external providers.
  }
  item.width = dimensions ? Number(dimensions[1]) : null;
  item.height = dimensions ? Number(dimensions[2]) : null;
}
