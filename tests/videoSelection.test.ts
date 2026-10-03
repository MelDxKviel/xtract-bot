import { afterEach, describe, expect, it, vi } from "vitest";

import { makeMedia, makeTweet, tweetFromPayload, tweetToPayload } from "@/providers/base";
import { PublicEmbedTweetProvider } from "@/providers/publicEmbed";
import { mp4Variants } from "@/providers/video";
import { needsVideoRefresh, selectTweetVideos } from "@/services/videoSelection";

import fixture from "./fixtures/video-2105979012426174943.json";

const media = fixture.tweet.media.all[0]!;
const high = media.url;
const medium = media.variants.find((variant) => variant.url.includes("1280x720"))!.url;
const low = media.variants.find((variant) => variant.url.includes("480x270"))!.url;

async function reportedTweet() {
  const provider = new PublicEmbedTweetProvider({
    fetch: async () => new Response(JSON.stringify(fixture)),
  });
  return provider.getTweet(fixture.tweet.id, fixture.tweet.url);
}

afterEach(() => vi.useRealTimers());

describe("video rendition selection", () => {
  it("selects the 12.3 MB 720p video instead of the reported post's 56.9 MB original", async () => {
    const tweet = await reportedTweet();
    expect(tweet.media[0]!.durationMs).toBe(71450);
    const fetch = vi.fn(
      async (url: string) =>
        new Response(null, {
          headers: { "content-length": url === high ? "56861214" : "12328458" },
        }),
    );
    await selectTweetVideos(tweet, fetch);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([high, medium]);
    expect(fetch).toHaveBeenCalledWith(high, {
      method: "HEAD",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(tweet.media[0]).toMatchObject({ type: "video", url: medium, width: 1280, height: 720 });
    const cached = tweetFromPayload(tweetToPayload(tweet));
    expect(cached.media).toEqual(tweet.media);
    expect(needsVideoRefresh(cached)).toBe(false);
  });

  it("keeps the highest quality when it already fits the URL limit", async () => {
    const tweet = await reportedTweet();
    const fetch = vi.fn(
      async () => new Response(null, { headers: { "content-length": "20000000" } }),
    );
    await selectTweetVideos(tweet, fetch);
    expect(tweet.media[0]!.url).toBe(high);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["missing size", "HEAD unsupported", "network failure"])(
    "uses duration and bitrate when probes return %s",
    async (failure) => {
      const tweet = await reportedTweet();
      await selectTweetVideos(tweet, async () => {
        if (failure === "network failure") throw new Error("network failure");
        return new Response(null, { status: failure === "HEAD unsupported" ? 405 : 200 });
      });
      expect(tweet.media[0]!.url).toBe(medium);
    },
  );

  it("keeps the smallest video for the upload fallback if all variants exceed 20 MB", async () => {
    const tweet = await reportedTweet();
    await selectTweetVideos(
      tweet,
      async (url) =>
        new Response(null, {
          headers: { "content-length": url === low ? "30000000" : "60000000" },
        }),
    );
    expect(tweet.media[0]).toMatchObject({ type: "video", url: low });
  });

  it("bounds all probes with one timeout and falls back without failing the share", async () => {
    vi.useFakeTimers();
    const tweet = await reportedTweet();
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const selection = selectTweetVideos(tweet, fetch);
    await vi.advanceTimersByTimeAsync(5000);
    await selection;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(tweet.media[0]!.url).toBe(medium);
  });

  it("does not probe arbitrary hosts or credential-bearing URLs", async () => {
    const tweet = await reportedTweet();
    tweet.media[0]!.videoVariants = [
      { url: "https://example.com/high.mp4", bitrate: 200 },
      { url: "https://user:secret@video.twimg.com/low.mp4", bitrate: 100 },
    ];
    const fetch = vi.fn();
    await selectTweetVideos(tweet, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("selects videos in quoted posts and thread ancestors too", async () => {
    const tweet = await reportedTweet();
    tweet.quotedTweet = await reportedTweet();
    tweet.repliedToTweet = await reportedTweet();
    await selectTweetVideos(
      tweet,
      async (url) =>
        new Response(null, {
          headers: { "content-length": url === high ? "56861214" : "12328458" },
        }),
    );
    expect(tweet.quotedTweet.media[0]!.url).toBe(medium);
    expect(tweet.repliedToTweet.media[0]!.url).toBe(medium);
  });

  it("refreshes old cached videos and posters, but preserves ordinary photo cache hits", async () => {
    const tweet = await reportedTweet();
    const payload = tweetToPayload(tweet);
    delete payload.media[0]!.video_variants;
    expect(needsVideoRefresh(tweetFromPayload(payload))).toBe(true);
    tweet.media = [makeMedia({ type: "photo", url: media.thumbnail_url })];
    expect(needsVideoRefresh(tweet)).toBe(true);
    tweet.media = [makeMedia({ type: "photo", url: "https://pbs.twimg.com/media/photo.jpg" })];
    expect(needsVideoRefresh(tweet)).toBe(false);
  });

  it("does not probe media without alternatives", async () => {
    const tweet = makeTweet({
      ...fixture.tweet,
      tweetId: "1",
      authorName: "User",
      authorUsername: "user",
      authorUrl: "https://x.com/user",
      media: [makeMedia({ type: "video", url: high })],
    });
    const fetch = vi.fn();
    await selectTweetVideos(tweet, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes FxTwitter formats and X API bit_rate without including HLS", () => {
    expect(
      mp4Variants([
        { url: low, container: "mp4", bitrate: 256000 },
        { url: "https://video.twimg.com/master.m3u8", content_type: "application/x-mpegURL" },
        { url: high, content_type: "video/mp4", bit_rate: 10368000 },
      ]),
    ).toEqual([
      { url: high, bitrate: 10368000 },
      { url: low, bitrate: 256000 },
    ]);
  });
});
