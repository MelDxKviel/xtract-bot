import { describe, expect, it } from "vitest";

import type {
  AvatarEmojiEntry,
  AvatarEmojiRepository,
  NewAvatarEmoji,
  OpenStickerSet,
} from "@/repositories/avatarEmoji";
import {
  buildSetName,
  createAvatarEmojiService,
  type AvatarEmojiDeps,
  type StickerClient,
  type StickerRef,
} from "@/services/avatarEmoji";

// In-memory stand-in for the DB repository, mirroring its semantics: one row per
// user, with set fill counts bumped on insert (not on in-place replacement).
class FakeRepo implements AvatarEmojiRepository {
  readonly rows = new Map<string, AvatarEmojiEntry>();
  readonly sets: { name: string; setIndex: number; count: number }[] = [];

  async getByUsername(username: string): Promise<AvatarEmojiEntry | null> {
    return this.rows.get(username) ?? null;
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
  async insertEmoji(entry: NewAvatarEmoji): Promise<void> {
    if (this.rows.has(entry.username)) return;
    const { username, ...rest } = entry;
    this.rows.set(username, rest);
    const set = this.sets.find((s) => s.name === entry.setName);
    if (set) set.count += 1;
  }
  async updateEmoji(
    username: string,
    avatarUrl: string,
    customEmojiId: string,
    stickerFileId: string,
  ): Promise<void> {
    const row = this.rows.get(username);
    if (row) Object.assign(row, { avatarUrl, customEmojiId, stickerFileId });
  }
}

// Fake sticker API: each create/add mints a uniquely-numbered sticker appended
// to the named set; delete removes it. lastRef equivalent reads the last one.
class FakeClient implements StickerClient {
  created: { name: string; title: string }[] = [];
  added: string[] = [];
  deleted: string[] = [];
  private counter = 0;
  private stickers = new Map<string, StickerRef[]>();

  constructor(private readonly username = "xtractbot") {}

  async getBotUsername(): Promise<string> {
    return this.username;
  }
  private mint(name: string): StickerRef {
    this.counter += 1;
    const ref = { customEmojiId: `emoji${this.counter}`, fileId: `file${this.counter}` };
    const list = this.stickers.get(name) ?? [];
    list.push(ref);
    this.stickers.set(name, list);
    return ref;
  }
  async createSet(name: string, title: string): Promise<StickerRef | null> {
    this.created.push({ name, title });
    return this.mint(name);
  }
  async addToSet(name: string): Promise<StickerRef | null> {
    this.added.push(name);
    return this.mint(name);
  }
  async deleteSticker(fileId: string): Promise<void> {
    this.deleted.push(fileId);
    for (const list of this.stickers.values()) {
      const index = list.findIndex((ref) => ref.fileId === fileId);
      if (index >= 0) {
        list.splice(index, 1);
        return;
      }
    }
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

const AVATAR_A = "https://pbs.twimg.com/profile_images/a.jpg";
const AVATAR_B = "https://pbs.twimg.com/profile_images/b.jpg";

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

    const id = await service.resolve("user", AVATAR_A);

    expect(id).toBe("emoji1");
    expect(client.created).toEqual([
      { name: "xtravatars_0_by_xtractbot", title: "Xtract avatars #1" },
    ]);
    expect(repo.rows.get("user")).toMatchObject({ avatarUrl: AVATAR_A, customEmojiId: "emoji1" });
  });

  it("reuses the same emoji while the avatar is unchanged", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const first = await service.resolve("user", AVATAR_A);
    const second = await service.resolve("user", AVATAR_A);

    expect(second).toBe(first);
    expect(client.created).toHaveLength(1);
    expect(client.added).toHaveLength(0);
    expect(client.deleted).toHaveLength(0);
  });

  it("normalizes the username (case and leading @)", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const first = await service.resolve("@User", AVATAR_A);
    const second = await service.resolve("user", AVATAR_A);

    expect(second).toBe(first);
    expect(client.created).toHaveLength(1);
    expect([...repo.rows.keys()]).toEqual(["user"]);
  });

  it("adds a second user to the open set instead of creating a new one", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    await service.resolve("alice", AVATAR_A);
    const id = await service.resolve("bob", AVATAR_B);

    expect(id).toBe("emoji2");
    expect(client.created).toHaveLength(1);
    expect(client.added).toEqual(["xtravatars_0_by_xtractbot"]);
  });

  it("rolls over to a fresh set when the current one is full", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client, { capacity: 1 });

    await service.resolve("alice", AVATAR_A);
    await service.resolve("bob", AVATAR_B);

    expect(client.created.map((s) => s.name)).toEqual([
      "xtravatars_0_by_xtractbot",
      "xtravatars_1_by_xtractbot",
    ]);
    expect(client.added).toHaveLength(0);
  });

  it("replaces the sticker in place when the avatar changes", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    await service.resolve("user", AVATAR_A); // emoji1 / file1
    const id = await service.resolve("user", AVATAR_B);

    expect(id).toBe("emoji2");
    // Old sticker dropped, new one added to the same set; no new set created.
    expect(client.created).toHaveLength(1);
    expect(client.added).toEqual(["xtravatars_0_by_xtractbot"]);
    expect(client.deleted).toEqual(["file1"]);
    // Net zero stickers added to the set, so the fill count is unchanged.
    expect(repo.sets[0]!.count).toBe(1);
    expect(repo.rows.get("user")).toMatchObject({
      avatarUrl: AVATAR_B,
      customEmojiId: "emoji2",
      stickerFileId: "file2",
    });
  });

  it("returns null (best-effort) when the download fails", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client, {
      fetchImage: async () => {
        throw new Error("network down");
      },
    });

    expect(await service.resolve("user", AVATAR_A)).toBeNull();
    expect(repo.rows.size).toBe(0);
  });

  it("returns null for a missing username or avatar url", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    expect(await service.resolve(null, AVATAR_A)).toBeNull();
    expect(await service.resolve("user", null)).toBeNull();
    expect(await service.resolve("", AVATAR_A)).toBeNull();
    expect(await service.resolve("@", AVATAR_A)).toBeNull();
    expect(client.created).toHaveLength(0);
  });

  it("dedupes concurrent resolves of the same user into one creation", async () => {
    const repo = new FakeRepo();
    const client = new FakeClient();
    const service = makeService(repo, client);

    const [a, b] = await Promise.all([
      service.resolve("user", AVATAR_A),
      service.resolve("user", AVATAR_A),
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
