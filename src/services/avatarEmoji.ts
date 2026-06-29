import { InputFile, type Api } from "grammy";

import type { AvatarEmojiRepository } from "@/repositories/avatarEmoji";
import { resizeToEmojiPng } from "@/utils/image";

// Telegram caps a custom-emoji set at 200 emoji; stop a little short so a small
// race never overflows a set.
const DEFAULT_CAPACITY = 190;
const DEFAULT_GLYPH = "👤";
const DEFAULT_SET_PREFIX = "xtravatars_";
const DEFAULT_TITLE_PREFIX = "Xtract avatars";
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/** A sticker as it lives in a set: its custom-emoji id plus its file id. */
export interface StickerRef {
  customEmojiId: string;
  fileId: string;
}

/**
 * Thin abstraction over the bits of the Bot API the avatar-emoji service needs.
 * Keeping it small lets tests drive the service with an in-memory fake instead
 * of a real Telegram connection.
 */
export interface StickerClient {
  /** The bot's own username, needed to build a valid sticker-set short name. */
  getBotUsername(): Promise<string>;
  /** Create a new set seeded with one sticker; returns that sticker's ref. */
  createSet(
    name: string,
    title: string,
    png: Uint8Array,
    glyph: string,
  ): Promise<StickerRef | null>;
  /** Append a sticker to an existing set; returns the new sticker's ref. */
  addToSet(name: string, png: Uint8Array, glyph: string): Promise<StickerRef | null>;
  /** Remove a sticker (by file id) from its set. */
  deleteSticker(fileId: string): Promise<void>;
}

export interface AvatarEmojiService {
  /**
   * Return a stable custom-emoji id for the given X user, creating one on first
   * sight and replacing it when their avatar changes. Best-effort: any failure
   * (download, image, Telegram) resolves to `null` so the caller simply sends
   * the message without the avatar emoji.
   */
  resolve(
    username: string | null | undefined,
    avatarUrl: string | null | undefined,
  ): Promise<string | null>;
  /** Plain emoji shown wherever the custom emoji can't be rendered. */
  readonly fallbackGlyph: string;
}

export interface AvatarEmojiDeps {
  client: StickerClient;
  repository: AvatarEmojiRepository;
  fetchImage?: (url: string) => Promise<Uint8Array>;
  resize?: (bytes: Uint8Array) => Promise<Uint8Array>;
  setPrefix?: string;
  titlePrefix?: string;
  glyph?: string;
  capacity?: number;
  timeoutMs?: number;
}

export function createAvatarEmojiService(deps: AvatarEmojiDeps): AvatarEmojiService {
  const {
    client,
    repository,
    fetchImage = defaultFetchImage(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    resize = resizeToEmojiPng,
    setPrefix = DEFAULT_SET_PREFIX,
    titlePrefix = DEFAULT_TITLE_PREFIX,
    glyph = DEFAULT_GLYPH,
    capacity = DEFAULT_CAPACITY,
  } = deps;

  // Resolve one user at a time so two concurrent shares of the same handle don't
  // each mint a sticker; in-flight work is shared via this map (keyed by user).
  const inFlight = new Map<string, Promise<string | null>>();

  // The user's avatar changed: drop the old sticker and add the replacement to
  // the same set, then repoint the row. Deleting first frees the slot so a full
  // set can still take the new sticker; it's best-effort (the old one may be
  // gone already), and the count nets out to zero so the set tracking is left
  // untouched.
  const replace = async (
    username: string,
    avatarUrl: string,
    existing: { stickerFileId: string; setName: string },
    png: Uint8Array,
  ): Promise<string | null> => {
    try {
      await client.deleteSticker(existing.stickerFileId);
    } catch (error) {
      console.error("avatar_emoji delete old sticker failed", { username, error });
    }
    const ref = await client.addToSet(existing.setName, png, glyph);
    if (!ref) return null;
    await repository.updateEmoji(username, avatarUrl, ref.customEmojiId, ref.fileId);
    return ref.customEmojiId;
  };

  // First time we've seen this user: add to a set with room, or roll a new one.
  const create = async (
    username: string,
    avatarUrl: string,
    png: Uint8Array,
  ): Promise<string | null> => {
    const open = await repository.pickOpenSet(capacity);
    let setName: string;
    let ref: StickerRef | null;
    if (open) {
      setName = open.name;
      ref = await client.addToSet(setName, png, glyph);
    } else {
      const index = await repository.nextSetIndex();
      setName = buildSetName(setPrefix, index, await client.getBotUsername());
      ref = await client.createSet(setName, `${titlePrefix} #${index + 1}`, png, glyph);
      if (ref) await repository.registerSet(setName, index);
    }
    if (!ref) return null;
    await repository.insertEmoji({
      username,
      avatarUrl,
      customEmojiId: ref.customEmojiId,
      stickerFileId: ref.fileId,
      setName,
    });
    return ref.customEmojiId;
  };

  const run = async (username: string, avatarUrl: string): Promise<string | null> => {
    const existing = await repository.getByUsername(username);
    if (existing && existing.avatarUrl === avatarUrl) return existing.customEmojiId;

    const png = await resize(await fetchImage(avatarUrl));
    return existing
      ? replace(username, avatarUrl, existing, png)
      : create(username, avatarUrl, png);
  };

  return {
    fallbackGlyph: glyph,

    async resolve(username, avatarUrl): Promise<string | null> {
      if (!username || !avatarUrl) return null;
      const key = username.replace(/^@+/, "").toLowerCase();
      if (!key) return null;

      const existing = inFlight.get(key);
      if (existing) return existing;

      const task = (async () => {
        try {
          return await run(key, avatarUrl);
        } catch (error) {
          console.error("avatar_emoji resolve failed", { username: key, avatarUrl, error });
          return null;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, task);
      return task;
    },
  };
}

/**
 * Build a Telegram-valid custom-emoji set short name. Bot-owned sets must end in
 * `_by_<bot_username>` and contain only english letters, digits and underscores.
 */
export function buildSetName(prefix: string, index: number, botUsername: string): string {
  return `${prefix}${index}_by_${botUsername.toLowerCase()}`;
}

function defaultFetchImage(timeoutMs: number): (url: string) => Promise<Uint8Array> {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`avatar fetch failed: HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > DEFAULT_MAX_BYTES) {
        throw new Error(`avatar too large: ${buffer.byteLength} bytes`);
      }
      return new Uint8Array(buffer);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Back the sticker client with a real grammY `Api`. Sets are owned by
 * `ownerId` (a Telegram user who has interacted with the bot — typically an
 * admin), since the Bot API attributes created sets to a user.
 */
export function createGrammyStickerClient(api: Api, ownerId: number): StickerClient {
  let cachedUsername: string | null = null;

  const sticker = (png: Uint8Array, glyph: string) => ({
    sticker: new InputFile(png, "avatar.png"),
    format: "static" as const,
    emoji_list: [glyph],
  });

  // The freshly added sticker is always the last one in the set.
  const lastRef = async (name: string): Promise<StickerRef | null> => {
    const set = await api.getStickerSet(name);
    const last = set.stickers[set.stickers.length - 1];
    if (!last?.custom_emoji_id) return null;
    return { customEmojiId: last.custom_emoji_id, fileId: last.file_id };
  };

  return {
    async getBotUsername(): Promise<string> {
      if (cachedUsername) return cachedUsername;
      const me = await api.getMe();
      cachedUsername = me.username;
      return cachedUsername;
    },

    async createSet(name, title, png, glyph): Promise<StickerRef | null> {
      await api.createNewStickerSet(ownerId, name, title, [sticker(png, glyph)], {
        sticker_type: "custom_emoji",
      });
      return lastRef(name);
    },

    async addToSet(name, png, glyph): Promise<StickerRef | null> {
      await api.addStickerToSet(ownerId, name, sticker(png, glyph));
      return lastRef(name);
    },

    async deleteSticker(fileId): Promise<void> {
      await api.deleteStickerFromSet(fileId);
    },
  };
}
