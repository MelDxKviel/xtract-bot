import { describe, expect, it } from "vitest";

import { TweetProviderError } from "@/providers/base";
import { PublicEmbedProfileProvider } from "@/providers/publicEmbedProfile";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const FXTWITTER_USER = {
  code: 200,
  message: "OK",
  user: {
    url: "https://twitter.com/jack",
    id: "12",
    screen_name: "jack",
    name: "jack",
    description: "bitcoin & #nostr, founder @block",
    location: "California",
    website: { url: "https://block.xyz", display_url: "block.xyz" },
    avatar_url: "https://pbs.twimg.com/profile_images/1_normal.jpg",
    banner_url: "https://pbs.twimg.com/profile_banners/12/1",
    joined: "Tue Mar 21 20:50:14 +0000 2006",
    followers: 6500000,
    following: 4321,
    tweets: 28000,
    likes: 35000,
    verified: true,
  },
};

describe("PublicEmbedProfileProvider", () => {
  it("parses the FxTwitter user payload", async () => {
    const provider = new PublicEmbedProfileProvider({
      fetch: async () => jsonResponse(FXTWITTER_USER),
    });
    const profile = await provider.getProfile("jack", "https://x.com/jack");

    expect(profile.username).toBe("jack");
    expect(profile.name).toBe("jack");
    expect(profile.url).toBe("https://x.com/jack");
    expect(profile.bio).toContain("bitcoin");
    expect(profile.location).toBe("California");
    expect(profile.website).toBe("https://block.xyz");
    expect(profile.followersCount).toBe(6500000);
    expect(profile.followingCount).toBe(4321);
    expect(profile.tweetCount).toBe(28000);
    expect(profile.verified).toBe(true);
    expect(profile.joinedAt).not.toBeNull();
    // The "_normal" avatar is widened to a larger variant.
    expect(profile.avatarUrl).toBe("https://pbs.twimg.com/profile_images/1_400x400.jpg");
    expect(profile.bannerUrl).toBe("https://pbs.twimg.com/profile_banners/12/1");
  });

  it("maps a 404 to a not_found provider error", async () => {
    const provider = new PublicEmbedProfileProvider({
      fetch: async () => jsonResponse({ message: "not found" }, 404),
    });
    await expect(provider.getProfile("ghost", "https://x.com/ghost")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("maps an in-body error code to a provider error", async () => {
    const provider = new PublicEmbedProfileProvider({
      fetch: async () => jsonResponse({ code: 401, message: "private" }),
    });
    await expect(provider.getProfile("priv", "https://x.com/priv")).rejects.toBeInstanceOf(
      TweetProviderError,
    );
  });
});
