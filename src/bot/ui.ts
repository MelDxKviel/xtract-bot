import { InlineKeyboard } from "grammy";

export const ORIGINAL_POST_LABEL = "🔗 Оригинальный пост";
export const OPEN_PROFILE_LABEL = "👤 Открыть профиль";

export function originalPostButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(ORIGINAL_POST_LABEL, url);
}

export function openProfileButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(OPEN_PROFILE_LABEL, url);
}

export const DISABLED_LINK_PREVIEW = { is_disabled: true } as const;

const TWEMOJI_BASE = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72";

export const INLINE_THUMBNAIL_SIZE = 72;
export const INLINE_THUMBNAIL_SHARE = `${TWEMOJI_BASE}/1f4e4.png`;
export const INLINE_THUMBNAIL_THREAD = `${TWEMOJI_BASE}/1f9f5.png`;
export const INLINE_THUMBNAIL_PROFILE = `${TWEMOJI_BASE}/1f464.png`;
export const INLINE_THUMBNAIL_TRANSLATE_RU = `${TWEMOJI_BASE}/1f1f7-1f1fa.png`;
export const INLINE_THUMBNAIL_INVALID = `${TWEMOJI_BASE}/1f517.png`;
