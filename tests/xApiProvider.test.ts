import { describe, expect, it } from "vitest";

import { XApiTweetProvider } from "@/providers/xApi";

describe("X API long posts", () => {
  it("requests and prefers note_tweet for both the post and its quote", async () => {
    const text = "long text ".repeat(1000) + "THE END";
    const provider = new XApiTweetProvider("token", {
      fetch: async (input) => {
        expect(new URL(input).searchParams.get("tweet.fields")!.split(",")).toContain("note_tweet");
        return new Response(
          JSON.stringify({
            data: {
              id: "123",
              text: "truncated…",
              note_tweet: { text },
              referenced_tweets: [{ type: "quoted", id: "456" }],
            },
            includes: {
              tweets: [{ id: "456", text: "quote…", note_tweet: { text: "FULL QUOTE" } }],
            },
          }),
        );
      },
    });
    const tweet = await provider.getTweet("123", "https://x.com/user/status/123");
    expect(tweet.text).toBe(text);
    expect(tweet.quotedTweet!.text).toBe("FULL QUOTE");
  });
});

describe("X API video parsing", () => {
  it.each(["video", "animated_gif"])(
    "rejects %s without a playable variant instead of using the poster",
    async (type) => {
      const provider = new XApiTweetProvider("token", {
        fetch: async () =>
          new Response(
            JSON.stringify({
              data: {
                id: "123",
                author_id: "1",
                text: "video",
                attachments: { media_keys: ["media"] },
              },
              includes: {
                users: [{ id: "1", username: "user", name: "User" }],
                media: [
                  {
                    media_key: "media",
                    type,
                    preview_image_url: "https://pbs.twimg.com/preview.jpg",
                  },
                ],
              },
            }),
          ),
      });
      await expect(provider.getTweet("123", "https://x.com/user/status/123")).rejects.toMatchObject(
        { code: "provider_bad_response" },
      );
    },
  );
});
