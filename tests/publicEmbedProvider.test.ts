import { describe, expect, it } from "vitest";

import { TweetProviderError } from "@/providers/base";
import type { FetchLike } from "@/providers/http";
import { PublicEmbedTweetProvider } from "@/providers/publicEmbed";

type Handler = (input: string, init?: RequestInit) => Response | Promise<Response>;

function fetchFromHandler(handler: Handler): FetchLike {
  return async (input, init) => {
    const result = await handler(input, init);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("PublicEmbedTweetProvider", () => {
  it("reads fxtwitter payload first", async () => {
    const calls: string[] = [];
    const handler: Handler = (input) => {
      const host = new URL(input).host;
      calls.push(host);
      return jsonResponse({
        code: 200,
        message: "OK",
        tweet: {
          url: "https://x.com/fillpackart/status/2047970725802242311",
          id: "2047970725802242311",
          text:
            "А твиттер тем временем всё лучше и лучше становится\n\n" +
            "Маску следует разыскать этих чмошников, которых он тогда " +
            "поувольнял нахуй, и уволить их ещё раз",
          author: {
            screen_name: "fillpackart",
            url: "https://x.com/fillpackart",
            name: "Фил Ранжин",
            avatar_url: "https://pbs.twimg.com/profile_images/fillpackart.jpg",
          },
          created_at: "Sat Apr 25 09:27:25 +0000 2026",
          lang: "ru",
          media: {
            all: [
              {
                type: "photo",
                url: "https://pbs.twimg.com/media/HGvaTpqXsAAPE9w.jpg?name=orig",
                width: 937,
                height: 445,
              },
            ],
          },
          quote: {
            id: "2047000000000000000",
            text: "Quoted tweet text",
            author: { screen_name: "quoted_user", name: "Quoted User" },
          },
        },
      });
    };

    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet(
      "2047970725802242311",
      "https://x.com/i/status/2047970725802242311",
    );

    expect(calls).toEqual(["api.fxtwitter.com"]);
    expect(tweet.tweetId).toBe("2047970725802242311");
    expect(tweet.url).toBe("https://x.com/fillpackart/status/2047970725802242311");
    expect(tweet.authorName).toBe("Фил Ранжин");
    expect(tweet.authorUsername).toBe("fillpackart");
    expect(tweet.authorAvatarUrl).toBe("https://pbs.twimg.com/profile_images/fillpackart.jpg");
    expect(tweet.text).toContain("А твиттер тем временем");
    expect(tweet.text).toContain("\n\n");
    expect(tweet.lang).toBe("ru");
    expect(tweet.media[0]!.type).toBe("photo");
    expect(tweet.media[0]!.width).toBe(937);
    expect(tweet.quotedTweet).not.toBeNull();
    expect(tweet.quotedTweet!.authorUsername).toBe("quoted_user");
    expect(tweet.quotedTweet!.text).toBe("Quoted tweet text");
  });

  it("reads syndication payload", async () => {
    const payload = {
      id_str: "123",
      text: "Hello &amp; world",
      created_at: "2026-04-25T10:00:00Z",
      lang: "en",
      user: {
        name: "Display Name",
        screen_name: "user",
        profile_image_url_https: "https://pbs.twimg.com/profile_images/user_normal.jpg",
      },
      photos: [{ url: "https://pbs.twimg.com/media/photo.jpg", width: 640, height: 480 }],
      video: {
        poster: "https://pbs.twimg.com/media/poster.jpg",
        duration_ms: 1200,
        variants: [
          {
            content_type: "application/x-mpegURL",
            url: "https://video.twimg.com/video.m3u8",
          },
          {
            content_type: "video/mp4",
            bitrate: 256000,
            url: "https://video.twimg.com/low.mp4",
          },
          {
            content_type: "video/mp4",
            bitrate: 2176000,
            url: "https://video.twimg.com/high.mp4",
          },
        ],
      },
      quoted_tweet: {
        id_str: "456",
        text: "Quoted text",
        user: { name: "Quoted", screen_name: "quoted" },
      },
    };
    // Make fxtwitter and vxtwitter fail so syndication is used.
    const handler: Handler = (input) => {
      const host = new URL(input).host;
      if (host === "api.fxtwitter.com" || host === "api.vxtwitter.com") {
        return new Response(null, { status: 503 });
      }
      return jsonResponse(payload);
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet("123", "https://x.com/user/status/123");

    expect(tweet.tweetId).toBe("123");
    expect(tweet.authorName).toBe("Display Name");
    expect(tweet.authorUsername).toBe("user");
    expect(tweet.authorAvatarUrl).toBe("https://pbs.twimg.com/profile_images/user_normal.jpg");
    expect(tweet.text).toBe("Hello & world");
    expect(tweet.lang).toBe("en");
    expect(tweet.media[0]!.type).toBe("photo");
    expect(tweet.media[0]!.url).toBe("https://pbs.twimg.com/media/photo.jpg");
    expect(tweet.media[1]!.type).toBe("video");
    expect(tweet.media[1]!.url).toBe("https://video.twimg.com/high.mp4");
    expect(tweet.quotedTweet).not.toBeNull();
    expect(tweet.quotedTweet!.authorUsername).toBe("quoted");
  });

  it("fetches replied-to tweet from fxtwitter", async () => {
    const handler: Handler = (input) => {
      const url = new URL(input);
      if (url.pathname.includes("2047970725802242311")) {
        return jsonResponse({
          code: 200,
          tweet: {
            id: "2047970725802242311",
            text: "This is a reply",
            author: { screen_name: "replier", name: "Replier" },
            replying_to: "original_user",
            replying_to_status: "1000000000000000001",
          },
        });
      }
      return jsonResponse({
        code: 200,
        tweet: {
          id: "1000000000000000001",
          text: "Original tweet text",
          author: { screen_name: "original_user", name: "Original User" },
        },
      });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet(
      "2047970725802242311",
      "https://x.com/replier/status/2047970725802242311",
    );
    expect(tweet.repliedToTweet).not.toBeNull();
    expect(tweet.repliedToTweet!.authorUsername).toBe("original_user");
    expect(tweet.repliedToTweet!.text).toBe("Original tweet text");
    expect(tweet.inReplyToTweetId).toBe("1000000000000000001");
  });

  it("parses a poll from fxtwitter", async () => {
    const handler: Handler = () =>
      jsonResponse({
        code: 200,
        tweet: {
          id: "5",
          url: "https://x.com/user/status/5",
          text: "vote now",
          author: { screen_name: "user", name: "User" },
          poll: {
            choices: [
              { label: "Yes", count: 3 },
              { label: "No", count: 7 },
            ],
            total_votes: 10,
            ends_at: "2020-01-01T00:00:00Z",
          },
        },
      });
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet("5", "https://x.com/user/status/5");
    expect(tweet.poll).not.toBeNull();
    expect(tweet.poll!.options.map((option) => option.label)).toEqual(["Yes", "No"]);
    expect(tweet.poll!.options[0]!.votes).toBe(3);
    expect(tweet.poll!.totalVotes).toBe(10);
    // ends_at is in the past, so the poll is closed.
    expect(tweet.poll!.closed).toBe(true);
  });

  it("fetches replied-to tweet from syndication", async () => {
    const handler: Handler = (input) => {
      const url = new URL(input);
      if (url.host !== "cdn.syndication.twimg.com") {
        return new Response(null, { status: 503 });
      }
      const tweetId = url.searchParams.get("id") ?? "";
      if (tweetId === "222") {
        return jsonResponse({
          id_str: "222",
          text: "Reply tweet",
          user: { name: "Replier", screen_name: "replier" },
          in_reply_to_status_id_str: "111",
        });
      }
      return jsonResponse({
        id_str: "111",
        text: "Parent tweet",
        user: { name: "Parent User", screen_name: "parent_user" },
      });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet("222", "https://x.com/replier/status/222");
    expect(tweet.repliedToTweet).not.toBeNull();
    expect(tweet.repliedToTweet!.authorUsername).toBe("parent_user");
    expect(tweet.repliedToTweet!.text).toBe("Parent tweet");
  });

  it("silently skips unavailable replied-to tweet", async () => {
    let callCount = 0;
    const handler: Handler = () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({
          code: 200,
          tweet: {
            id: "2047970725802242311",
            text: "This is a reply",
            author: { screen_name: "replier", name: "Replier" },
            replying_to: "gone_user",
            replying_to_status: "999",
          },
        });
      }
      return new Response(null, { status: 404 });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet(
      "2047970725802242311",
      "https://x.com/replier/status/2047970725802242311",
    );
    expect(tweet.text).toBe("This is a reply");
    expect(tweet.repliedToTweet).toBeNull();
  });

  it("falls back to oembed when other endpoints fail", async () => {
    const handler: Handler = (input) => {
      const url = new URL(input);
      if (url.host === "cdn.syndication.twimg.com") {
        return new Response(null, { status: 503 });
      }
      if (url.host === "api.fxtwitter.com" || url.host === "api.vxtwitter.com") {
        return new Response(null, { status: 503 });
      }
      return jsonResponse({
        author_name: "Display Name",
        author_url: "https://twitter.com/user",
        html:
          '<blockquote class="twitter-tweet">' +
          '<p lang="en" dir="ltr">Hello <a href="https://t.co/a">link</a>' +
          "<br>line 2</p>" +
          '<img src="https://pbs.twimg.com/media/photo.jpg">' +
          "&mdash; Display Name (@user)" +
          '<a href="https://twitter.com/user/status/123">Date</a>' +
          "</blockquote>",
      });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet("123", "https://x.com/user/status/123");
    expect(tweet.tweetId).toBe("123");
    expect(tweet.authorName).toBe("Display Name");
    expect(tweet.authorUsername).toBe("user");
    expect(tweet.text).toBe("Hello link\nline 2");
    expect(tweet.lang).toBe("en");
    expect(tweet.media[0]!.url).toBe("https://pbs.twimg.com/media/photo.jpg");
  });

  it("skips empty syndication payload", async () => {
    const handler: Handler = (input) => {
      const url = new URL(input);
      if (url.host === "api.fxtwitter.com" || url.host === "api.vxtwitter.com") {
        return new Response(null, { status: 503 });
      }
      if (url.host === "cdn.syndication.twimg.com") {
        return jsonResponse({});
      }
      return jsonResponse({
        url: "https://twitter.com/fillpackart/status/2047970725802242311",
        author_name: "Фил Ранжин",
        author_url: "https://twitter.com/fillpackart",
        html:
          '<blockquote class="twitter-tweet">' +
          '<p lang="ru" dir="ltr">А твиттер тем временем всё лучше</p>' +
          "&mdash; Фил Ранжин (@fillpackart)" +
          '<a href="https://twitter.com/fillpackart/status/2047970725802242311">' +
          "Date</a></blockquote>",
      });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    const tweet = await provider.getTweet(
      "2047970725802242311",
      "https://x.com/i/status/2047970725802242311",
    );
    expect(tweet.authorUsername).toBe("fillpackart");
    expect(tweet.authorName).toBe("Фил Ранжин");
    expect(tweet.text).toBe("А твиттер тем временем всё лучше");
    expect(tweet.url).toBe("https://x.com/fillpackart/status/2047970725802242311");
  });

  it("keeps rate limit error code", async () => {
    const provider = new PublicEmbedTweetProvider({
      fetch: fetchFromHandler(() => new Response(null, { status: 429 })),
    });
    try {
      await provider.getTweet("123", "https://x.com/user/status/123");
      throw new Error("expected provider_rate_limited");
    } catch (error) {
      expect(error).toBeInstanceOf(TweetProviderError);
      expect((error as TweetProviderError).code).toBe("provider_rate_limited");
    }
  });

  it("reports unavailable tweet", async () => {
    const handler: Handler = (input) => {
      const url = new URL(input);
      if (url.host === "cdn.syndication.twimg.com") {
        return jsonResponse({ __typename: "TweetTombstone" });
      }
      return new Response(null, { status: 404 });
    };
    const provider = new PublicEmbedTweetProvider({ fetch: fetchFromHandler(handler) });
    try {
      await provider.getTweet("123", "https://x.com/user/status/123");
      throw new Error("expected not_found");
    } catch (error) {
      expect(error).toBeInstanceOf(TweetProviderError);
      expect((error as TweetProviderError).code).toBe("not_found");
    }
  });
});
