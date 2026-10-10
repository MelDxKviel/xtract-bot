import { describe, expect, it } from "vitest";

import { formatThread, formatTweet } from "@/formatters/telegram";
import {
  buildRichMessage,
  legacyTextHtml,
  mediaCarouselHtml,
  renderedTextLength,
  withoutRichMedia,
} from "@/formatters/richMessage";
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

  it("drops unsafe and credential-bearing media URLs", () => {
    expect(mediaCarouselHtml([photo("javascript:alert(1)")])).toBeNull();
    expect(mediaCarouselHtml([photo("http://example.com/a.jpg")])).toBeNull();
    expect(mediaCarouselHtml([photo("https://user:secret@example.com/a.jpg")])).toBeNull();
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

  it("preserves long text beyond the legacy 4096-char limit", () => {
    const { html } = buildRichMessage(formatTweet(makeTweetData({ text: "слово ".repeat(2000) })));
    expect(html!.length).toBeGreaterThan(4096);
  });

  it("keeps long text and images in one rich message even when HTML source exceeds 32k", () => {
    const text = "@jack & < > ".repeat(1900) + " THE END";
    const message = buildRichMessage(
      formatTweet(makeTweetData({ text, media: [photo("https://pbs.twimg.com/a.jpg")] })),
    );
    expect(message.html!.length).toBeGreaterThan(32768);
    expect(renderedTextLength(message.html!)).toBeLessThan(32768);
    expect(message.html).toContain("THE END");
    expect(message.html).toContain('<img src="https://pbs.twimg.com/a.jpg"/>');
  });

  it("disables auto entity detection so Twitter handles aren't mis-linked", () => {
    expect(buildRichMessage(formatTweet(makeTweetData())).skip_entity_detection).toBe(true);
  });

  it.each(["quotedTweet", "repliedToTweet"] as const)(
    "keeps %s photos and videos inside their own quote block after the main media",
    (relation) => {
      const related = makeTweetData({
        tweetId: "456",
        url: "https://x.com/other/status/456",
        authorName: "Other <author>",
        authorUsername: "other",
        authorUrl: "https://x.com/other",
        text: "related <text>",
        media: [
          photo("https://pbs.twimg.com/related.jpg"),
          makeMedia({ type: "video", url: "https://video.twimg.com/related.mp4" }),
        ],
      });
      const post = formatTweet(
        makeTweetData({ media: [photo("https://pbs.twimg.com/main.jpg")], [relation]: related }),
      );
      const { html } = buildRichMessage(post);
      expect(html).toContain(relation === "quotedTweet" ? "Цитируемый пост" : "Ответ на");
      expect(html).toContain('href="https://x.com/other/status/456"');
      expect(html).toContain("Other &lt;author&gt;");
      expect(html).toContain("related &lt;text&gt;");
      const quoteStart = html!.indexOf("<blockquote>");
      const quoteEnd = html!.indexOf("</blockquote>");
      expect(html!.indexOf("https://pbs.twimg.com/main.jpg")).toBeLessThan(quoteStart);
      const quote = html!.slice(quoteStart, quoteEnd);
      expect(quote).toContain(
        '<tg-slideshow><img src="https://pbs.twimg.com/related.jpg"/>' +
          '<video src="https://video.twimg.com/related.mp4"></video></tg-slideshow>',
      );
      // Legacy text/caption fallbacks still contain context but no rich media tags.
      expect(legacyTextHtml(post)).toContain("related &lt;text&gt;");
      expect(legacyTextHtml(post)).not.toContain("<img");
      expect(legacyTextHtml(post)).not.toContain("<video");
    },
  );

  it("shows an animated media-only reply even when the main tweet has no attachments", () => {
    const { html } = buildRichMessage(
      formatTweet(
        makeTweetData({
          repliedToTweet: makeTweetData({
            text: null,
            media: [makeMedia({ type: "gif", url: "https://video.twimg.com/animation.mp4" })],
          }),
        }),
      ),
    );
    expect(html).toContain("Ответ на");
    expect(html).toContain('<video src="https://video.twimg.com/animation.mp4"></video>');
  });

  it("collapses long context together with its media and preserves the complete text", () => {
    const { html } = buildRichMessage(
      formatTweet(
        makeTweetData({
          quotedTweet: makeTweetData({
            text: "ц".repeat(5000) + " QUOTE END",
            media: [photo("https://pbs.twimg.com/quoted.jpg")],
          }),
        }),
      ),
    );
    const details = html!.slice(html!.indexOf("<details>"), html!.indexOf("</details>"));
    expect(details).toContain("<summary>");
    expect(details).toContain("QUOTE END");
    expect(details).toContain('<img src="https://pbs.twimg.com/quoted.jpg"/>');
  });

  it("filters unsafe context media and escapes URL attributes", () => {
    const post = formatTweet(
      makeTweetData({
        quotedTweet: makeTweetData({
          media: [
            photo("javascript:alert(1)"),
            photo("https://user:secret@example.com/private.jpg"),
            photo("https://pbs.twimg.com/quoted.jpg?x=1&y=2"),
          ],
        }),
      }),
    );
    expect(buildRichMessage(post).html).toContain(
      'src="https://pbs.twimg.com/quoted.jpg?x=1&amp;y=2"',
    );
    expect(buildRichMessage(post).html).not.toContain("javascript:");
    expect(buildRichMessage(post).html).not.toContain("secret");
    expect(post.segments![0]!.relatedPost!.media).toHaveLength(1);
  });

  it("omits both quote and reply context without changing the source tweet", () => {
    const tweet = makeTweetData({
      text: "@parent only this post",
      media: [photo("https://pbs.twimg.com/main.jpg")],
      quotedTweet: makeTweetData({ text: "quoted context" }),
      repliedToTweet: makeTweetData({ text: "reply context" }),
    });
    const post = formatTweet(tweet, { includeRelated: false });
    for (const html of [post.html, post.richHtml, post.captionHtml, buildRichMessage(post).html!]) {
      expect(html).toContain("only this post");
      expect(html).not.toContain("quoted context");
      expect(html).not.toContain("reply context");
      expect(html).not.toContain("@parent");
    }
    expect(buildRichMessage(post).html).toContain("https://pbs.twimg.com/main.jpg");
    expect(tweet.quotedTweet!.text).toBe("quoted context");
    expect(tweet.repliedToTweet!.text).toBe("reply context");
    expect(buildRichMessage(formatTweet(tweet)).html).toContain("quoted context");
  });
});

describe("buildRichMessage threads", () => {
  function threadTweet(id: string, text: string, media: TweetMedia[] = []): TweetData {
    return makeTweetData({ tweetId: id, url: `https://x.com/user/status/${id}`, text, media });
  }

  it("interleaves each post's media right after its own text", () => {
    const post = formatThread([
      threadTweet("1", "first post", [photo("https://pbs.twimg.com/1.jpg")]),
      threadTweet("2", "second post", [photo("https://pbs.twimg.com/2.jpg")]),
    ]);
    const { html } = buildRichMessage(post);
    const text1 = html!.indexOf("first post");
    const img1 = html!.indexOf("https://pbs.twimg.com/1.jpg");
    const text2 = html!.indexOf("second post");
    const img2 = html!.indexOf("https://pbs.twimg.com/2.jpg");
    // Order: text1 → its photo → text2 → its photo.
    expect(text1).toBeGreaterThanOrEqual(0);
    expect(img1).toBeGreaterThan(text1);
    expect(text2).toBeGreaterThan(img1);
    expect(img2).toBeGreaterThan(text2);
  });

  it("chains posts with <hr/> dividers and no numbering", () => {
    const { html } = buildRichMessage(
      formatThread([
        threadTweet("1", "alpha"),
        threadTweet("2", "beta"),
        threadTweet("3", "gamma"),
      ]),
    );
    expect(html).toContain("<hr/>");
    expect(html).not.toContain("1. alpha");
    expect(html).toContain("🧵");
  });

  it("keeps a long thread in one rich message instead of truncating", () => {
    const tweets = Array.from({ length: 6 }, (_, index) =>
      threadTweet(String(index + 1), `post ${"слово ".repeat(300)}`),
    );
    const { html } = buildRichMessage(formatThread(tweets));
    expect(html!.length).toBeGreaterThan(4096);
  });

  it("does not drop a thread segment because media URLs inflate the HTML source", () => {
    const text = "@jack & < > ".repeat(1000);
    const message = buildRichMessage(
      formatThread([
        threadTweet("1", text + " FIRST END", [photo("https://pbs.twimg.com/1.jpg")]),
        threadTweet("2", text + " SECOND END", [photo("https://pbs.twimg.com/2.jpg")]),
      ]),
    );
    expect(message.html!.length).toBeGreaterThan(32768);
    expect(renderedTextLength(message.html!)).toBeLessThan(32768);
    expect(message.html).toContain("FIRST END");
    expect(message.html).toContain("SECOND END");
    expect(message.html).not.toContain("ещё");
  });

  it("keeps a thread quote and its media without repeating an already unrolled reply", () => {
    const parent = threadTweet("1", "parent text", [photo("https://pbs.twimg.com/parent.jpg")]);
    const child = {
      ...threadTweet("2", "child text"),
      repliedToTweet: parent,
      quotedTweet: makeTweetData({
        tweetId: "456",
        text: "quoted context",
        media: [photo("https://pbs.twimg.com/quoted.jpg")],
      }),
    };
    const post = formatThread([
      parent,
      child,
      { ...threadTweet("3", "last"), repliedToTweet: child },
    ]);
    const { html } = buildRichMessage(post);
    expect(html).toContain("quoted context");
    expect(html).toContain("https://pbs.twimg.com/quoted.jpg");
    expect(html!.match(/parent text/g)).toHaveLength(1);
    expect(html!.match(/child text/g)).toHaveLength(1);
    expect(html).not.toContain("Ответ на");
    expect(legacyTextHtml(post)).toContain("quoted context");
  });

  it("shares the 50-attachment budget between main and related media across a thread", () => {
    const tweets = Array.from({ length: 3 }, (_, index) => ({
      ...threadTweet(String(index + 1), `post ${index} END`, [
        photo(`https://pbs.twimg.com/main${index}.jpg`),
      ]),
      quotedTweet: makeTweetData({
        text: `quote ${index} END`,
        media: Array.from({ length: 30 }, (_, mediaIndex) =>
          photo(`https://pbs.twimg.com/quote${index}-${mediaIndex}.jpg`),
        ),
      }),
    }));
    const post = formatThread(tweets);
    const { html } = buildRichMessage(post);
    expect(html!.match(/<img /g)).toHaveLength(50);
    expect(html).toContain("post 2 END");
    expect(html).toContain("quote 2 END");
    const textOnly = buildRichMessage(withoutRichMedia(post)).html!;
    expect(textOnly).not.toContain("<img");
    expect(textOnly).toContain("quote 2 END");
    // Removing rejected attachments must not mutate the original rich post.
    expect(buildRichMessage(post).html!.match(/<img /g)).toHaveLength(50);
  });
});
