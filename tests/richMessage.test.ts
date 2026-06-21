import { describe, expect, it } from "vitest";

import { formatTweet } from "@/formatters/telegram";
import { buildRichMessage, mediaCarouselHtml } from "@/formatters/richMessage";
import { makeMedia, makeTweet, type TweetData, type TweetMedia } from "@/providers/base";

function makeTweetData(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: "https://x.com/user/status/123",
    authorName: "Display Name",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "Hello world",
    ...overrides,
  });
}

function photo(url: string): TweetMedia {
  return makeMedia({ type: "photo", url });
}

describe("mediaCarouselHtml", () => {
  it("returns null without media", () => {
    expect(mediaCarouselHtml([])).toBeNull();
  });

  it("renders a single photo as a bare <img> block, not a slideshow", () => {
    const html = mediaCarouselHtml([photo("https://example.com/0.jpg")]);
    expect(html).toBe('<img src="https://example.com/0.jpg"/>');
    expect(html).not.toContain("<tg-slideshow>");
  });

  it("wraps several items in a <tg-slideshow> carousel", () => {
    const html = mediaCarouselHtml([
      photo("https://example.com/0.jpg"),
      makeMedia({ type: "video", url: "https://example.com/1.mp4" }),
    ]);
    expect(html).toBe(
      '<tg-slideshow><img src="https://example.com/0.jpg"/>' +
        '<video src="https://example.com/1.mp4"></video></tg-slideshow>',
    );
  });

  it("maps animated GIFs to <video>", () => {
    const html = mediaCarouselHtml([makeMedia({ type: "gif", url: "https://example.com/a.mp4" })]);
    expect(html).toBe('<video src="https://example.com/a.mp4"></video>');
  });

  it("escapes media URLs for use in attributes", () => {
    const html = mediaCarouselHtml([photo("https://example.com/a.jpg?x=1&y=2")]);
    expect(html).toContain('src="https://example.com/a.jpg?x=1&amp;y=2"');
  });
});

describe("buildRichMessage", () => {
  it("includes every media item in the carousel", () => {
    const media = Array.from({ length: 4 }, (_, index) =>
      photo(`https://example.com/${index}.jpg`),
    );
    const { html } = buildRichMessage(formatTweet(makeTweetData({ media })));
    expect(html).toContain("<tg-slideshow>");
    for (let index = 0; index < 4; index += 1) {
      expect(html).toContain(`<img src="https://example.com/${index}.jpg"/>`);
    }
  });

  it("renders the tweet text as the body above the media block", () => {
    const { html } = buildRichMessage(
      formatTweet(makeTweetData({ media: [photo("https://example.com/0.jpg")] })),
    );
    const textEnd = html!.indexOf("Hello world");
    const mediaStart = html!.indexOf("<img");
    expect(textEnd).toBeGreaterThanOrEqual(0);
    expect(mediaStart).toBeGreaterThan(textEnd);
  });

  it("converts text line breaks into <br> tags", () => {
    const { html } = buildRichMessage(formatTweet(makeTweetData()));
    expect(html).toContain("<br>");
    expect(html).not.toContain("\n");
  });

  it("keeps the author link from the formatter", () => {
    const { html } = buildRichMessage(formatTweet(makeTweetData()));
    expect(html).toContain('<a href="https://x.com/user">');
  });
});
