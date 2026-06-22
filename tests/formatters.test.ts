import { describe, expect, it } from "vitest";

import {
  CAPTION_LIMIT,
  MESSAGE_LIMIT,
  RICH_MESSAGE_LIMIT,
  formatThread,
  formatTweet,
  linkifyEntities,
  pollHtml,
  richPollHtml,
  renderTweetHtml,
} from "@/formatters/telegram";
import { makeMedia, makeTweet, type TweetData, type TweetMedia } from "@/providers/base";

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

describe("pollHtml", () => {
  it("renders options with percentages and totals", () => {
    const html = pollHtml({
      options: [
        { label: "Yes", votes: 30 },
        { label: "No", votes: 70 },
      ],
      totalVotes: 100,
      closed: false,
    });
    expect(html).toContain("🗳");
    expect(html).toContain("Yes — 30% (30)");
    expect(html).toContain("No — 70% (70)");
    expect(html).toContain("Всего голосов: 100");
    expect(html).toContain("идёт");
  });

  it("escapes labels and marks closed polls", () => {
    const html = pollHtml({ options: [{ label: "<b>x", votes: 1 }], totalVotes: 1, closed: true });
    expect(html).toContain("&lt;b&gt;x");
    expect(html).toContain("завершён");
  });

  it("groups large vote counts and tolerates a zero total", () => {
    const html = pollHtml({ options: [{ label: "A", votes: 0 }], totalVotes: 0, closed: false });
    expect(html).toContain("A — 0% (0)");
    const big = pollHtml({
      options: [{ label: "A", votes: 1234 }],
      totalVotes: 1234,
      closed: false,
    });
    expect(big).toContain("1 234");
  });
});

describe("renderTweetHtml polls", () => {
  it("includes a plain poll block in the plain rendered tweet", () => {
    const html = renderTweetHtml(
      makeTweetData({
        poll: { options: [{ label: "A", votes: 1 }], totalVotes: 1, closed: false },
      }),
    );
    expect(html).toContain("🗳");
    expect(html).toContain("A — 100% (1)");
    expect(html).not.toContain("█");
  });

  it("uses the rich progress-bar poll in rich mode", () => {
    const html = renderTweetHtml(
      makeTweetData({
        poll: { options: [{ label: "A", votes: 1 }], totalVotes: 1, closed: false },
      }),
      RICH_MESSAGE_LIMIT,
      { rich: true },
    );
    expect(html).toContain("🗳");
    expect(html).toContain("█");
  });
});

describe("richPollHtml", () => {
  const poll = {
    options: [
      { label: "Yes", votes: 75 },
      { label: "No", votes: 25 },
    ],
    totalVotes: 100,
    closed: false,
  };

  it("draws a monospace bar and bolds the leading option", () => {
    const html = richPollHtml(poll);
    expect(html).toContain("🗳");
    expect(html).toContain("<code>");
    expect(html).toContain("█");
    expect(html).toContain("░");
    // The winning option is emphasised.
    expect(html).toContain("<b>Yes</b>");
    expect(html).toContain("75% · 75");
    expect(html).toContain("идёт");
  });

  it("escapes option labels and marks closed polls", () => {
    const html = richPollHtml({
      options: [{ label: "<b>x", votes: 1 }],
      totalVotes: 1,
      closed: true,
    });
    expect(html).toContain("&lt;b&gt;x");
    expect(html).toContain("завершён");
  });

  it("tolerates a zero total without dividing by zero", () => {
    const html = richPollHtml({
      options: [{ label: "A", votes: 0 }],
      totalVotes: 0,
      closed: false,
    });
    expect(html).toContain("A — 0% · 0");
    expect(html).toContain("░".repeat(12));
  });
});

describe("formatThread", () => {
  function photo(url: string): TweetMedia {
    return makeMedia({ type: "photo", url });
  }
  function segment(id: string, text: string, overrides: Partial<TweetData> = {}): TweetData {
    return makeTweetData({
      tweetId: id,
      url: `https://x.com/user/status/${id}`,
      text,
      ...overrides,
    });
  }

  it("merges a thread with a marker and un-numbered segments", () => {
    const post = formatThread([
      segment("1", "first"),
      segment("2", "second"),
      segment("3", "third"),
    ]);
    expect(post.html).toContain("🧵");
    expect(post.html).toContain("Тред — 3 поста");
    expect(post.html).toContain("first");
    expect(post.html).toContain("second");
    expect(post.html).toContain("third");
    // No numbering — posts are chained, not enumerated.
    expect(post.html).not.toContain("1. first");
    expect(post.html).not.toContain("2. second");
  });

  it("exposes per-post segments with their own media", () => {
    const post = formatThread([
      segment("1", "first", { media: [photo("https://pbs.twimg.com/1.jpg")] }),
      segment("2", "second", { media: [photo("https://pbs.twimg.com/2.jpg")] }),
    ]);
    expect(post.segments).toBeDefined();
    expect(post.segments!.length).toBe(2);
    expect(post.segments![0]!.html).toContain("first");
    expect(post.segments![0]!.media[0]!.url).toBe("https://pbs.twimg.com/1.jpg");
    expect(post.segments![1]!.media[0]!.url).toBe("https://pbs.twimg.com/2.jpg");
    expect(post.threadHeaderHtml).toContain("🧵");
  });

  it("links to the shared (last) tweet", () => {
    const post = formatThread([segment("1", "a"), segment("2", "b")]);
    expect(post.linkHtml).toContain("https://x.com/user/status/2");
  });

  it("combines media from every tweet", () => {
    const post = formatThread([
      segment("1", "a", { media: [photo("https://pbs.twimg.com/1.jpg")] }),
      segment("2", "b", { media: [photo("https://pbs.twimg.com/2.jpg")] }),
    ]);
    expect(post.media.length).toBe(2);
  });

  it("renders a poll attached to a thread segment", () => {
    const post = formatThread([
      segment("1", "intro"),
      segment("2", "vote", {
        poll: { options: [{ label: "A", votes: 1 }], totalVotes: 1, closed: false },
      }),
    ]);
    expect(post.html).toContain("🗳");
    expect(post.segments![1]!.html).toContain("🗳");
  });

  it("drops trailing posts from the plain fallback to fit the limit", () => {
    // Eight ~800-char posts overflow the 4096 plain limit but fit the rich one.
    const tweets = Array.from({ length: 8 }, (_, index) =>
      segment(String(index + 1), `post${index + 1} ${"y".repeat(800)}`),
    );
    const post = formatThread(tweets);
    expect(post.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(post.html).toContain("ещё");
    // The rich text fallback has room for every post.
    expect(post.richHtml).toContain("post8 ");
  });

  it("falls back to single-tweet formatting for a one-item thread", () => {
    const post = formatThread([segment("1", "only")]);
    expect(post.html).not.toContain("🧵");
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
