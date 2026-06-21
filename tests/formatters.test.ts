import { describe, expect, it } from "vitest";

import {
  CAPTION_LIMIT,
  MESSAGE_LIMIT,
  RICH_MESSAGE_LIMIT,
  formatTweet,
  linkifyEntities,
  renderTweetHtml,
} from "@/formatters/telegram";
import { makeTweet, type TweetData } from "@/providers/base";

function makeTweetData(overrides: Partial<TweetData> = {}): TweetData {
  return makeTweet({
    tweetId: "123",
    url: "https://x.com/user/status/123",
    authorName: "Display <Name>",
    authorUsername: "user",
    authorUrl: "https://x.com/user",
    text: "Hello <b>& world",
    ...overrides,
  });
}

describe("renderTweetHtml", () => {
  it("escapes user-supplied text", () => {
    const html = renderTweetHtml(makeTweetData());
    expect(html).toContain("Display &lt;Name&gt;");
    expect(html).toContain("Hello &lt;b&gt;&amp; world");
    expect(html).not.toContain("<b>");
  });

  it("truncates to the message limit", () => {
    const html = renderTweetHtml(makeTweetData({ text: "x".repeat(10_000) }));
    expect(html.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(html).not.toContain("https://x.com/user/status/123");
  });

  it("does not embed the original link", () => {
    const html = renderTweetHtml(makeTweetData());
    expect(html).not.toContain("https://x.com/user/status/123");
    expect(html).not.toContain("Открыть оригинал");
  });

  it("renders quoted tweet as blockquote", () => {
    const html = renderTweetHtml(
      makeTweetData({
        quotedTweet: makeTweetData({
          tweetId: "456",
          url: "https://x.com/quoted/status/456",
          authorName: "Quoted Author",
          authorUsername: "quoted",
          authorUrl: "https://x.com/quoted",
          text: "Quoted <text>",
        }),
      }),
    );
    expect(html).toContain('<a href="https://x.com/quoted/status/456">Цитируемый пост</a>:');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<a href="https://x.com/quoted">Quoted Author (@quoted)</a>:');
    expect(html).toContain("Quoted &lt;text&gt;");
  });

  it("strips leading mentions for replies", () => {
    const html = renderTweetHtml(
      makeTweetData({
        text: "@someone @other Hello world",
        repliedToTweet: makeTweetData({ tweetId: "789" }),
      }),
    );
    expect(html).toContain("Hello world");
    expect(html).not.toContain("@someone");
    expect(html).not.toContain("@other");
  });

  it("keeps mentions for non-reply tweets", () => {
    const html = renderTweetHtml(makeTweetData({ text: "@someone Hello world" }));
    expect(html).toContain("@someone");
  });

  it("does not strip Cyrillic at-sign text", () => {
    const html = renderTweetHtml(
      makeTweetData({
        text: "@привет это не хэндл",
        repliedToTweet: makeTweetData({ tweetId: "789" }),
      }),
    );
    expect(html).toContain("@привет");
  });

  it("does not strip mention without a delimiter", () => {
    const html = renderTweetHtml(
      makeTweetData({
        text: "@user-continuation text",
        repliedToTweet: makeTweetData({ tweetId: "789" }),
      }),
    );
    expect(html).toContain("@user");
  });

  it("renders replied-to tweet as blockquote", () => {
    const html = renderTweetHtml(
      makeTweetData({
        repliedToTweet: makeTweetData({
          tweetId: "789",
          url: "https://x.com/other/status/789",
          authorName: "Other Author",
          authorUsername: "other",
          authorUrl: "https://x.com/other",
          text: "Original <text>",
        }),
      }),
    );
    expect(html).toContain('<a href="https://x.com/other/status/789">Ответ на</a>:');
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<a href="https://x.com/other">Other Author (@other)</a>:');
    expect(html).toContain("Original &lt;text&gt;");
  });
});

describe("formatTweet", () => {
  it("limits caption and media", () => {
    const media = Array.from({ length: 12 }, (_, index) => ({
      type: "photo" as const,
      url: `https://example.com/${index}.jpg`,
      previewUrl: null,
      width: null,
      height: null,
      durationMs: null,
    }));
    const post = formatTweet(makeTweetData({ text: "x".repeat(5000), media }));
    expect(post.captionHtml.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(post.media.length).toBe(10);
    expect(post.extraMediaCount).toBe(2);
  });

  it("keeps long posts in richHtml beyond the plain message limit", () => {
    const post = formatTweet(makeTweetData({ text: "слово ".repeat(2000) }));
    expect(post.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(post.richHtml.length).toBeGreaterThan(MESSAGE_LIMIT);
    expect(post.richHtml.length).toBeLessThanOrEqual(RICH_MESSAGE_LIMIT);
  });

  it("appends italic original-language footer when requested", () => {
    const post = formatTweet(makeTweetData(), { originalLanguageLabel: "английский" });
    expect(post.html).toContain("<i>Язык оригинала: английский</i>");
    expect(post.captionHtml).toContain("<i>Язык оригинала: английский</i>");
  });

  it("escapes the language label", () => {
    const post = formatTweet(makeTweetData(), { originalLanguageLabel: "<lang>" });
    expect(post.html).toContain("<i>Язык оригинала: &lt;lang&gt;</i>");
  });

  it("respects the caption limit when adding the language footer", () => {
    const post = formatTweet(makeTweetData({ text: "x".repeat(5000) }), {
      originalLanguageLabel: "английский",
    });
    expect(post.captionHtml.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(post.captionHtml).toContain("<i>Язык оригинала: английский</i>");
  });
});

describe("linkifyEntities", () => {
  it("links mentions, hashtags, cashtags and urls to x.com", () => {
    const html = linkifyEntities("hi @jack #News $TSLA at https://t.co/abc");
    expect(html).toContain('<a href="https://x.com/jack">@jack</a>');
    expect(html).toContain('<a href="https://x.com/hashtag/News">#News</a>');
    expect(html).toContain('<a href="https://x.com/search?q=%24TSLA">$TSLA</a>');
    expect(html).toContain('<a href="https://t.co/abc">https://t.co/abc</a>');
  });

  it("escapes surrounding text and ignores email addresses", () => {
    const html = linkifyEntities("ping user@example.com <now>");
    expect(html).toContain("&lt;now&gt;");
    expect(html).not.toContain("<a");
  });

  it("does not link Cyrillic handles", () => {
    expect(linkifyEntities("@привет")).not.toContain("<a");
  });

  it("strips trailing punctuation from urls", () => {
    expect(linkifyEntities("see (https://t.co/abc).")).toContain(
      '<a href="https://t.co/abc">https://t.co/abc</a>',
    );
  });
});

describe("renderTweetHtml rich features", () => {
  function withLongQuote(): TweetData {
    return makeTweetData({
      quotedTweet: makeTweetData({
        tweetId: "456",
        url: "https://x.com/quoted/status/456",
        authorName: "Quoted Author",
        authorUsername: "quoted",
        authorUrl: "https://x.com/quoted",
        text: "ц".repeat(300),
      }),
    });
  }

  it("links entities in the tweet body", () => {
    expect(renderTweetHtml(makeTweetData({ text: "yo @jack" }))).toContain(
      '<a href="https://x.com/jack">@jack</a>',
    );
  });

  it("collapses long quotes into <details> only in rich mode", () => {
    const tweet = withLongQuote();
    const rich = renderTweetHtml(tweet, RICH_MESSAGE_LIMIT, { rich: true });
    expect(rich).toContain("<details><summary>");
    expect(rich).not.toContain("<blockquote>");

    const plain = renderTweetHtml(tweet, MESSAGE_LIMIT);
    expect(plain).not.toContain("<details>");
    expect(plain).toContain("<blockquote>");
  });
});
