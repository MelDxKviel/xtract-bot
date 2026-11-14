import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { loadSettings } from "@/config";
import { formatThread, formatTweet } from "@/formatters/telegram";
import { buildPostWidget, fitsWidget, widgetMediaBatches, widgetText } from "@/formatters/widget";
import { makeMedia, makeTweet, tweetFromPayload, tweetToPayload } from "@/providers/base";
import { PublicEmbedTweetProvider } from "@/providers/publicEmbed";
import { loadWidgetAvatar } from "@/services/widgetAvatar";

const tweet = makeTweet({
  tweetId: "123",
  url: "https://x.com/user/status/123",
  authorName: "Автор",
  authorUsername: "user",
  authorUrl: "https://x.com/user",
  text: "Привет! 🐦\nНовая строка",
});
const avatar =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfQAAAAASUVORK5CYII=";

describe("HTML post widgets", () => {
  it("is opt-in and can be enabled just for the PR deployment", () => {
    const env = { BOT_TOKEN: "12345:TEST", DATABASE_URL: "postgres://localhost/test" };
    expect(loadSettings(env).postWidgetsEnabled).toBe(false);
    expect(loadSettings({ ...env, POST_WIDGETS_ENABLED: "true" }).postWidgetsEnabled).toBe(true);
  });

  it("embeds the avatar, native theme colors and complete text inside both size limits", () => {
    const html = buildPostWidget(formatTweet(tweet), tweet, `data:image/png;base64,${avatar}`)!;
    expect(html).toContain(`data:image/png;base64,${avatar}`);
    expect(html).toContain("--tg-theme-text-color");
    expect(html).toContain("Привет! 🐦\nНовая строка");
    expect(html).toContain("getBoundingClientRect");
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(32768);
    expect(deflateSync(html, { level: 9 }).length).toBeLessThan(3900);
    expect(html).not.toContain("<video");
    expect(html).not.toContain('src="https:');
  });

  it("escapes hostile post and author markup, and rejects arbitrary avatar markup", () => {
    const hostile = {
      ...tweet,
      authorName: '<img src=x onerror="oops()">',
      text: "</div><script>alert(1)</script>\0& hi",
    };
    const html = buildPostWidget(
      formatTweet(hostile),
      hostile,
      'data:image/png;base64,x" onerror="oops()',
    )!;
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toMatch(/<[^>]*\bonerror=/);
    expect(html).not.toContain("\0");
  });

  it("drops an oversized avatar before falling back to initials", () => {
    const large = `data:image/png;base64,${randomBytes(2800).toString("base64")}`;
    const html = buildPostWidget(formatTweet(tweet), tweet, large)!;
    expect(html).not.toContain(large);
    expect(html).toContain('class="avatar">АВ');
  });

  it("never truncates posts to squeeze them into a widget", () => {
    const tooBig = { ...tweet, text: "текст".repeat(8000) + "THE END" };
    expect(buildPostWidget(formatTweet(tooBig), tooBig)).toBeNull();
    const highEntropy = { ...tweet, text: randomBytes(5000).toString("base64") };
    expect(buildPostWidget(formatTweet(highEntropy), highEntropy)).toBeNull();
    expect(fitsWidget("\0")).toBe(false);
  });

  it("retains polls, related text, thread endings and all attachment batches", () => {
    const photos = Array.from({ length: 24 }, (_, i) =>
      makeMedia({ type: "photo", url: `https://pbs.twimg.com/${i}.jpg` }),
    );
    const root = {
      ...tweet,
      tweetId: "124",
      text: "THREAD END",
      media: photos,
      quotedTweet: {
        ...tweet,
        text: "QUOTE",
        media: [makeMedia({ type: "gif", url: "https://video.twimg.com/quote.mp4" })],
      },
      poll: { options: [{ label: "Да", votes: 3 }], totalVotes: 3, closed: false },
    };
    const post = formatThread([tweet, root]);
    const text = widgetText(post);
    expect(text).toContain("THREAD END");
    expect(text).toContain("QUOTE");
    expect(text).toContain("Да");
    const batches = widgetMediaBatches(post);
    expect(batches.map((batch) => batch.media.length)).toEqual([10, 10, 4, 1]);
    expect(batches.flatMap((batch) => batch.media).map((item) => item.url)).toEqual([
      ...photos.map((item) => item.url),
      "https://video.twimg.com/quote.mp4",
    ]);
  });

  it("roundtrips avatar metadata through the cache and reads older cache entries", () => {
    const data = { ...tweet, authorAvatarUrl: "https://pbs.twimg.com/profile_images/1_normal.jpg" };
    expect(tweetFromPayload(tweetToPayload(data)).authorAvatarUrl).toBe(data.authorAvatarUrl);
    const old = tweetToPayload(tweet);
    delete old.author_avatar_url;
    expect(tweetFromPayload(old).authorAvatarUrl).toBeNull();
  });

  it("extracts avatar metadata from public provider responses", async () => {
    const provider = new PublicEmbedTweetProvider({
      fetch: async () =>
        new Response(
          JSON.stringify({
            code: 200,
            tweet: {
              id: "123",
              text: "hi",
              author: {
                screen_name: "user",
                name: "User",
                avatar_url: "https://pbs.twimg.com/profile_images/1_normal.jpg",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    });
    expect((await provider.getTweet("123", tweet.url)).authorAvatarUrl).toContain("1_normal.jpg");
  });
});

describe("widget avatars", () => {
  it("requests the mini variant even when the provider gives a full-size image", async () => {
    const fetch = vi.fn(async () => new Response(Buffer.from(avatar, "base64")));
    expect(await loadWidgetAvatar("https://pbs.twimg.com/profile_images/1/hash.jpg", fetch)).toBe(
      `data:image/png;base64,${avatar}`,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://pbs.twimg.com/profile_images/1/hash_mini.jpg",
      expect.anything(),
    );
  });
  it("requests a tiny avatar, embeds actual raster bytes and blocks redirects", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(Buffer.from(avatar, "base64"), { headers: { "content-type": "image/png" } }),
    );
    expect(await loadWidgetAvatar("https://pbs.twimg.com/profile_images/1_normal.jpg", fetch)).toBe(
      `data:image/png;base64,${avatar}`,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://pbs.twimg.com/profile_images/1_mini.jpg",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    "http://pbs.twimg.com/profile_images/1.jpg",
    "https://evil.test/a.jpg",
    "https://pbs.twimg.com.evil.test/profile_images/a.jpg",
    "https://pbs.twimg.com:444/profile_images/a.jpg",
    "https://pbs.twimg.com@127.0.0.1/profile_images/a.jpg",
    "https://pbs.twimg.com/media/a.jpg",
    "file:///etc/passwd",
  ])("does not fetch untrusted avatars: %s", async (url) => {
    const fetch = vi.fn();
    expect(await loadWidgetAvatar(url, fetch)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    new Response("<svg onload='oops()'/>", { headers: { "content-type": "image/png" } }),
    new Response(new Uint8Array(3073)),
    new Response(null, { status: 403 }),
  ])("ignores invalid, large and failed avatars", async (response) => {
    expect(
      await loadWidgetAvatar("https://pbs.twimg.com/profile_images/a.jpg", async () => response),
    ).toBeNull();
  });

  it("treats network errors as optional missing avatars", async () => {
    expect(
      await loadWidgetAvatar("https://pbs.twimg.com/profile_images/a.jpg", async () => {
        throw new Error("offline");
      }),
    ).toBeNull();
  });
});
