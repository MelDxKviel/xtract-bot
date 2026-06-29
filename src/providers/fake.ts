import { makeTweet, type TweetData, type TweetProvider } from "@/providers/base";

export class FakeTweetProvider implements TweetProvider {
  async getTweet(tweetId: string, sourceUrl: string): Promise<TweetData> {
    return makeTweet({
      tweetId,
      url: sourceUrl,
      authorName: "Xtract Demo",
      authorUsername: "xtract_demo",
      authorUrl: "https://x.com/xtract_demo",
      authorAvatarUrl: "https://pbs.twimg.com/profile_images/xtract_demo.jpg",
      text: `Demo tweet ${tweetId}. Replace TWEET_PROVIDER to fetch real X/Twitter posts.`,
      createdAt: new Date(),
      lang: "en",
    });
  }

  async health(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // no-op
  }
}
