import { InlineKeyboard } from "grammy";

export const ORIGINAL_POST_LABEL = "🔗 Оригинальный пост";

export function originalPostButton(url: string): InlineKeyboard {
  return new InlineKeyboard().url(ORIGINAL_POST_LABEL, url);
}

export const DISABLED_LINK_PREVIEW = { is_disabled: true } as const;
