import { describe, expect, it } from "vitest";

import type { AvatarEmojiRepository, OpenStickerSet } from "@/repositories/avatarEmoji";
import {
  buildSetName,
  createAvatarEmojiService,
  type AvatarEmojiDeps,
  type StickerClient,
} from "@/services/avatarEmoji";

// In-memory stand-in for the DB repository, mirroring its pooling semantics.
class FakeRepo implements AvatarEmojiRepository {
  readonly emojis = new Map<string, string>();
  readonly sets: { name: string; setIndex: number; count: number }[] = [];

  async getEmojiId(avatarUrl: string): Promise<string | null> {
    return this.emojis.get(avatarUrl) ?? null;
  }
  async pickOpenSet(capacity: number): Promise<OpenStickerSet | null> {
    const open = this.sets.find((s) => s.count < capacity);
    return open ? { name: open.name, setIndex: open.setIndex } : null;
  }
  async nextSetIndex(): Promise<number> {
    return this.sets.length === 0 ? 0 : Math.max(...this.sets.map((s) => s.setIndex)) + 1;
  }
  async registerSet(name: string, setIndex: number): Promise<void> {
    this.sets.push({ name, setIndex, count: 0 });
  }
  async recordEmoji(avatarUrl: string, customEmojiId: string, setName: string): Promise<void> {
    if (this.emojis.has(avatarUrl)) return;
    this.emojis.set(avatarUrl, customEmojiId);
    const set = this.sets.find((s) => s.name === setName);
    if (set) set.count += 1;
  }
}

// Fake sticker API: each create/add appends a uniquely-numbered emoji id to the
// named set so `lastCustomEmojiId` returns the freshest one.
class FakeClient implements StickerClient {
  created: { name: string; title: string }[] = [];
  added: string[] = [];
  private counter = 0;
  private stickers = new Map<string, string[]>();

  constructor(private readonly username = "xtractbot") {}

  async getBotUsername(): Promise<string> {
    return this.username;
  }
  async createSet(name: string): Promise<void> {
    this.created.push({ name, title: "" });
    this.stickers.set(name, [`emoji${(this.counter += 1)}`]);
  }
  async addToSet(name: string): Promise<void> {
    this.added.push(name);
    const list = this.stickers.get(name) ?? [];
    list.push(`emoji${(this.counter += 1)}`);
    this.stickers.set(name, list);
  }
  async lastCustomEmojiId(name: string): Promise<string | null> {
    const list = this.stickers.get(name) ?? [];
    return list[list.length - 1] ?? null;
  }
}

function makeService(repo: FakeRepo, client: FakeClient, overrides: Partial<AvatarEmojiDeps> = {}) {
  return createAvatarEmojiService({
    client,
    repository: repo,
    fetchImage: async () => new Uint8Array([1, 2, 3]),
    resize: async (bytes) => bytes,
    ...overrides,
  });
}

describe("buildSetName", () => {
  it("ends with _by_<lowercased bot username>", () => {
    expect(buildSetName("xtravatars_", 2, "XtractBot")).toBe("xtravatars_2_by_xtractbot");
  });
});

describe("createAvatarEmojiService", () => {
  it("creates a set and returns the new custom emoji id on first sight", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const id = await service.resolve("https://pbs.twimg.com/a.jpg");

    expect(id).toBe("emoji1");
    expect(client.created).toEqual([{ name: "xtravatars_0_by_xtractbot", title: "" }]);
    expect(repo.emojis.get("https://pbs.twimg.com/a.jpg")).toBe("emoji1");
  });

  it("reuses the cached emoji without touching Telegram on a repeat", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const first = await service.resolve("https://pbs.twimg.com/a.jpg");
    const second = await service.resolve("https://pbs.twimg.com/a.jpg");

    expect(second).toBe(first);
    expect(client.created).toHaveLength(1);
    expect(client.added).toHaveLength(0);
  });

  it("adds to an open set instead of creating a new one", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    await service.resolve("https://pbs.twimg.com/a.jpg");
    const id = await service.resolve("https://pbs.twimg.com/b.jpg");

    expect(id).toBe("emoji2");
    expect(client.created).toHaveLength(1);
    expect(client.added).toEqual(["xtravatars_0_by_xtractbot"]);
  });

  it("rolls over to a fresh set when the current one is full", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client, { capacity: 1 });

    await service.resolve("https://pbs.twimg.com/a.jpg");
    await service.resolve("https://pbs.twimg.com/b.jpg");

    expect(client.created.map((s) => s.name)).toEqual([
      "xtravatars_0_by_xtractbot",
      "xtravatars_1_by_xtractbot",
    ]);
    expect(client.added).toHaveLength(0);
  });

  it("returns null (best-effort) when the download fails", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client, {
      fetchImage: async () => {
        throw new Error("network down");
      },
    });

    expect(await service.resolve("https://pbs.twimg.com/a.jpg")).toBeNull();
    expect(repo.emojis.size).toBe(0);
  });

  it("returns null for a missing avatar url without calling Telegram", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    expect(await service.resolve(null)).toBeNull();
    expect(await service.resolve(undefined)).toBeNull();
    expect(await service.resolve("")).toBeNull();
    expect(client.created).toHaveLength(0);
  });

  it("dedupes concurrent resolves of the same avatar into one creation", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const [a, b] = await Promise.all([
      service.resolve("https://pbs.twimg.com/a.jpg"),
      service.resolve("https://pbs.twimg.com/a.jpg"),
    ]);

    expect(a).toBe("emoji1");
    expect(b).toBe("emoji1");
    expect(client.created).toHaveLength(1);
  });

  it("exposes the fallback glyph", () => {
    const service = makeService(new FakeRepo(), new FakeClient(), { glyph: "🐦" });
    expect(service.fallbackGlyph).toBe("🐦");
  });
});
