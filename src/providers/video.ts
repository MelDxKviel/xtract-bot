import type { TweetVideoVariant } from "@/providers/base";

/** FxTwitter, syndication and X API use slightly different MP4 variant fields. */
export function mp4Variants(value: unknown): TweetVideoVariant[] {
  if (!Array.isArray(value)) return [];
  const variants: TweetVideoVariant[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.url !== "string") continue;
    const format = String(item.content_type ?? item.container ?? "").toLowerCase();
    if (format !== "video/mp4" && format !== "mp4") continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const bitrate = Number(item.bitrate ?? item.bit_rate);
    variants.push({
      url: item.url,
      bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    });
  }
  return variants.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
}

export function isVideoPoster(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "pbs.twimg.com" &&
      /^\/(?:amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}
