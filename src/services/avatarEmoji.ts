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

/**
 * Thin abstraction over the bits of the Bot API the avatar-emoji service needs.
 * Keeping it small lets tests drive the service with an in-memory fake instead
 * of a real Telegram connection.
 */
export interface StickerClient {
  /** The bot's own username, needed to build a valid sticker-set short name. */
  getBotUsername(): Promise<string>;
  createSet(name: string, title: string, png: Uint8Array, glyph: string): Promise<void>;
  addToSet(name: string, png: Uint8Array, glyph: string): Promise<void>;
  /** `custom_emoji_id` of the most recently added sticker in the set. */
  lastCustomEmojiId(name: string): Promise<string | null>;
}

export interface AvatarEmojiService {
  /**
   * Return a custom-emoji id for the given avatar URL, creating one on first
   * sight. Best-effort: any failure (download, image, Telegram) resolves to
   * `null` so the caller simply sends the message without the avatar emoji.
   */
  resolve(avatarUrl: string | null | undefined): Promise<string | null>;
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

  // Avatars are created one-at-a-time per URL to avoid two concurrent shares of
  // the same handle each minting a sticker; in-flight work is shared via a map.
  const inFlight = new Map<string, Promise<string | null>>();

  const create = async (avatarUrl: string): Promise<string | null> => {
    const cached = await repository.getEmojiId(avatarUrl);
    if (cached) return cached;

    const png = await resize(await fetchImage(avatarUrl));
    const username = await client.getBotUsername();

    const open = await repository.pickOpenSet(capacity);
    let setName: string;
    if (open) {
      setName = open.name;
      await client.addToSet(setName, png, glyph);
    } else {
      const index = await repository.nextSetIndex();
      setName = buildSetName(setPrefix, index, username);
      await client.createSet(setName, `${titlePrefix} #${index + 1}`, png, glyph);
      await repository.registerSet(setName, index);
    }

    const emojiId = await client.lastCustomEmojiId(setName);
    if (!emojiId) return null;
    await repository.recordEmoji(avatarUrl, emojiId, setName);
    return emojiId;
  };

  return {
    fallbackGlyph: glyph,

    async resolve(avatarUrl): Promise<string | null> {
      if (!avatarUrl) return null;
      const existing = inFlight.get(avatarUrl);
      if (existing) return existing;

      const task = (async () => {
        try {
          return await create(avatarUrl);
        } catch (error) {
          console.error("avatar_emoji resolve failed", { avatarUrl, error });
          return null;
        } finally {
          inFlight.delete(avatarUrl);
        }
      })();
      inFlight.set(avatarUrl, task);
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

  return {
    async getBotUsername(): Promise<string> {
      if (cachedUsername) return cachedUsername;
      const me = await api.getMe();
      cachedUsername = me.username;
      return cachedUsername;
    },

    async createSet(name, title, png, glyph): Promise<void> {
      await api.createNewStickerSet(ownerId, name, title, [sticker(png, glyph)], {
        sticker_type: "custom_emoji",
      });
    },

    async addToSet(name, png, glyph): Promise<void> {
      await api.addStickerToSet(ownerId, name, sticker(png, glyph));
    },

    async lastCustomEmojiId(name): Promise<string | null> {
      const set = await api.getStickerSet(name);
      const last = set.stickers[set.stickers.length - 1];
      return last?.custom_emoji_id ?? null;
    },
  };
}
