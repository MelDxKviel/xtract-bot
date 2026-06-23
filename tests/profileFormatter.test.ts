import { describe, expect, it } from "vitest";

import { CAPTION_LIMIT, MESSAGE_LIMIT } from "@/formatters/telegram";
import { formatProfile, OPEN_PROFILE_LABEL } from "@/formatters/profile";
import { makeProfile, type ProfileData } from "@/providers/profileBase";

function profile(overrides: Partial<ProfileData> = {}): ProfileData {
  return makeProfile({
    username: "jack",
    name: "Jack <Dorsey>",
    url: "https://x.com/jack",
    bio: "Hello <b>world</b> #bitcoin @x",
    location: "California",
    website: "https://block.xyz",
    avatarUrl: "https://pbs.twimg.com/profile_images/1_400x400.jpg",
    bannerUrl: "https://pbs.twimg.com/profile_banners/1",
    joinedAt: new Date("2007-03-21T00:00:00Z"),
    followersCount: 6500000,
    followingCount: 4321,
    tweetCount: 28000,
    verified: true,
    ...overrides,
  });
}

describe("formatProfile", () => {
  it("escapes user-supplied text and links the handle", () => {
    const post = formatProfile(profile());
    expect(post.html).toContain("Jack &lt;Dorsey&gt;");
    expect(post.html).not.toContain("<b>world</b>");
    expect(post.html).toContain('<a href="https://x.com/jack">@jack</a>');
  });

  it("renders the verified badge and stats with separators", () => {
    const post = formatProfile(profile());
    expect(post.html).toContain("✅");
    expect(post.html).toContain("6 500 000");
    expect(post.html).toContain("подписчиков");
    expect(post.html).toContain("подписка"); // 4321 → "подписка"
    expect(post.html).toContain("📍 California");
    expect(post.html).toContain("На X с марта 2007");
  });

  it("linkifies entities inside the bio", () => {
    const post = formatProfile(profile());
    expect(post.html).toContain('href="https://x.com/hashtag/bitcoin"');
    expect(post.html).toContain('href="https://x.com/x"');
  });

  it("exposes avatar then banner as media", () => {
    const post = formatProfile(profile());
    expect(post.media.map((m) => m.url)).toEqual([
      "https://pbs.twimg.com/profile_images/1_400x400.jpg",
      "https://pbs.twimg.com/profile_banners/1",
    ]);
  });

  it("omits empty rows", () => {
    const post = formatProfile(
      makeProfile({
        username: "min",
        name: "Minimal",
        url: "https://x.com/min",
      }),
    );
    expect(post.html).not.toContain("📍");
    expect(post.html).not.toContain("🔗");
    expect(post.html).not.toContain("👥");
    expect(post.media).toEqual([]);
  });

  it("uses a profile-specific original link label", () => {
    const post = formatProfile(profile());
    expect(post.linkHtml).toContain(OPEN_PROFILE_LABEL);
  });

  it("stays within Telegram limits even for a huge bio", () => {
    const post = formatProfile(profile({ bio: "x".repeat(10_000) }));
    expect(post.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(post.captionHtml.length).toBeLessThanOrEqual(CAPTION_LIMIT);
  });
});
