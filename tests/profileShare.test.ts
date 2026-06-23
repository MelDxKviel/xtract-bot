import { describe, expect, it } from "vitest";

import { TweetProviderError } from "@/providers/base";
import { makeProfile, type ProfileData, type ProfileProvider } from "@/providers/profileBase";
import type { ProfileCacheEntry, ProfileCacheRepository } from "@/repositories/profileCache";
import { createProfileShareService, type ProcessOptions } from "@/services/profileShare";

function makeProfileData(overrides: Partial<ProfileData> = {}): ProfileData {
  return makeProfile({
    username: "jack",
    name: "Jack",
    url: "https://x.com/jack",
    bio: "bio",
    ...overrides,
  });
}

const OPTIONS: ProcessOptions = { telegramUserId: 1, chatId: 10, mode: "private" };

class FakeCache implements ProfileCacheRepository {
  readonly entries = new Map<string, { profile?: ProfileData; errorCode?: string }>();
  setCalls = 0;
  negativeCalls = 0;

  constructor(seed?: ProfileData) {
    if (seed) this.entries.set(seed.username.toLowerCase(), { profile: seed });
  }

  async getEntry(username: string): Promise<ProfileCacheEntry | null> {
    const entry = this.entries.get(username.toLowerCase());
    if (!entry) return null;
    if (entry.profile) return { kind: "hit", profile: entry.profile };
    return { kind: "negative", errorCode: entry.errorCode ?? "not_found" };
  }

  async set(profile: ProfileData): Promise<void> {
    this.entries.set(profile.username.toLowerCase(), { profile });
    this.setCalls += 1;
  }

  async setNegative(username: string, _sourceUrl: string, errorCode: string): Promise<void> {
    this.entries.set(username.toLowerCase(), { errorCode });
    this.negativeCalls += 1;
  }

  async count(): Promise<number> {
    return this.entries.size;
  }

  async clearAll(): Promise<number> {
    const removed = this.entries.size;
    this.entries.clear();
    return removed;
  }

  async clearExpired(): Promise<number> {
    return 0;
  }
}

class FakeEvents {
  readonly items: Record<string, unknown>[] = [];
  async create(input: unknown): Promise<void> {
    this.items.push(input as Record<string, unknown>);
  }
}

class FakeProvider implements ProfileProvider {
  readonly calls: string[] = [];

  constructor(
    private readonly profiles: Map<string, ProfileData> = new Map(),
    private readonly failCode: string | null = null,
  ) {}

  async getProfile(username: string, sourceUrl: string): Promise<ProfileData> {
    this.calls.push(username);
    if (this.failCode) {
      throw new TweetProviderError("failed", { code: this.failCode });
    }
    return this.profiles.get(username) ?? makeProfileData({ username, url: sourceUrl });
  }

  async close(): Promise<void> {
    // no-op
  }
}

function makeService(
  options: {
    provider?: FakeProvider;
    cache?: FakeCache;
    negativeCacheTtlSeconds?: number;
  } = {},
): {
  provider: FakeProvider;
  cache: FakeCache;
  events: FakeEvents;
  service: ReturnType<typeof createProfileShareService>;
} {
  const provider = options.provider ?? new FakeProvider();
  const cache = options.cache ?? new FakeCache();
  const events = new FakeEvents();
  const service = createProfileShareService({
    provider,
    cacheRepository: cache,
    shareEventsRepository: events,
    cacheTtlSeconds: 60,
    negativeCacheTtlSeconds: options.negativeCacheTtlSeconds ?? 600,
  });
  return { provider, cache, events, service };
}

describe("ProfileShareService", () => {
  it("fetches via provider and records success", async () => {
    const { provider, events, service } = makeService();
    const result = await service.processText("https://x.com/jack", OPTIONS);

    expect(result.ok).toBe(true);
    expect(result.post).not.toBeNull();
    expect(provider.calls).toEqual(["jack"]);
    expect(events.items[0]!.status).toBe("success");
  });

  it("uses the cache when present", async () => {
    const { provider, service } = makeService({ cache: new FakeCache(makeProfileData()) });
    const result = await service.processText("https://x.com/jack", OPTIONS);

    expect(result.ok).toBe(true);
    expect(result.cacheHit).toBe(true);
    expect(provider.calls).toEqual([]);
  });

  it("returns invalid_url for text without a profile link", async () => {
    const { provider, service } = makeService();
    const result = await service.processText("just some text", OPTIONS);
    expect(result.status).toBe("invalid_url");
    expect(provider.calls).toEqual([]);
  });

  it("negative-caches terminal errors and short-circuits the provider", async () => {
    const provider = new FakeProvider(new Map(), "not_found");
    const cache = new FakeCache();
    const { service } = makeService({ provider, cache });

    const first = await service.processText("https://x.com/ghost", OPTIONS);
    expect(first.errorCode).toBe("not_found");
    expect(cache.negativeCalls).toBe(1);

    const second = await service.processText("https://x.com/ghost", OPTIONS);
    expect(second.errorCode).toBe("not_found");
    expect(provider.calls).toEqual(["ghost"]);
  });

  it("does not negative-cache transient errors", async () => {
    const provider = new FakeProvider(new Map(), "provider_rate_limited");
    const cache = new FakeCache();
    const { service } = makeService({ provider, cache });

    await service.processText("https://x.com/jack", OPTIONS);
    await service.processText("https://x.com/jack", OPTIONS);

    expect(cache.negativeCalls).toBe(0);
    expect(provider.calls).toEqual(["jack", "jack"]);
  });
});
