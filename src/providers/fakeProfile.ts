import { makeProfile, type ProfileData, type ProfileProvider } from "@/providers/profileBase";

export class FakeProfileProvider implements ProfileProvider {
  async getProfile(username: string, sourceUrl: string): Promise<ProfileData> {
    return makeProfile({
      username,
      name: "Xtract Demo",
      url: sourceUrl,
      bio: `Demo profile for @${username}. Replace TWEET_PROVIDER to fetch real X/Twitter profiles.`,
      location: "Internet",
      website: "https://example.com",
      avatarUrl: null,
      bannerUrl: null,
      joinedAt: new Date("2020-01-01T00:00:00Z"),
      followersCount: 1234,
      followingCount: 567,
      tweetCount: 8901,
      likeCount: 2345,
      verified: true,
    });
  }

  async close(): Promise<void> {
    // no-op
  }
}
