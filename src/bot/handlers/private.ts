import { Composer, GrammyError, InputFile, type InlineKeyboard } from "grammy";
import type { InputMediaPhoto, InputMediaVideo } from "grammy/types";

import { DISABLED_LINK_PREVIEW, openProfileButton, originalPostButton } from "@/bot/ui";
import type { AppContext } from "@/bot/context";
import { buildRichMessage, withAvatarEmoji } from "@/formatters/richMessage";
import type { TelegramPost } from "@/formatters/telegram";
import type { TweetMedia } from "@/providers/base";
import type { ProfileShareResult } from "@/services/profileShare";
import type { ShareResult } from "@/services/tweetShare";
import { extractFirstProfileUrl, extractFirstTweetUrl } from "@/utils/urls";

const INVALID_LINK_TEXT =
  "🔗 Пришлите ссылку на пост или профиль X/Twitter, например " +
  "https://x.com/user/status/123 или https://x.com/user";
const FETCH_ERROR_TEXT =
  "⚠️ Не удалось получить пост. Возможно, он удален, приватный или временно недоступен.";
const PROFILE_ERROR_TEXT =
  "⚠️ Не удалось получить профиль. Возможно, он удален, приватный или временно недоступен.";
// Caption shown inside the animated "generating" placeholder (rich draft).
const THINKING_CAPTION = "Загружаю пост…";

export const privateComposer = new Composer<AppContext>();

const privateChat = privateComposer.filter((ctx) => ctx.chat?.type === "private");

privateChat.command("start", async (ctx) => {
  await ctx.reply(
    "👋 <b>Xtract Bot</b> помогает красиво пересылать посты и профили X/Twitter в Telegram.\n\n" +
      "📨 Отправьте ссылку на пост X/Twitter в личный чат — бот вытащит текст, медиа " +
      "и оформит сообщение.\n" +
      "👤 Отправьте ссылку на профиль (например <code>https://x.com/user</code>) — бот " +
      "красиво оформит карточку профиля.\n" +
      "🔍 Или используйте inline режим: <code>@bot_username &lt;ссылка&gt;</code> в любом чате.\n\n" +
      "ℹ️ Подробнее: /help",
    { parse_mode: "HTML", link_preview_options: DISABLED_LINK_PREVIEW },
  );
});

privateChat.command("help", async (ctx) => {
  const isAdmin = ctx.from ? ctx.services.access.isAdmin(ctx.from.id) : false;
  const baseHelp =
    "📖 <b>Как пользоваться ботом</b>\n\n" +
    "📨 Отправьте ссылку на пост X/Twitter в личный чат с ботом.\n" +
    "👤 Отправьте ссылку на профиль (<code>https://x.com/user</code>) — бот оформит " +
    "карточку профиля.\n" +
    "✅ Поддерживаются: x.com, twitter.com, mobile.twitter.com, vxtwitter.com.\n\n" +
    "🔍 <b>Inline режим:</b> введите " +
    "<code>@bot_username &lt;ссылка&gt;</code> в любом чате.\n\n" +
    "🆔 /id — покажет ваш Telegram ID.";
  const adminHelp =
    "\n\n🛠 <b>Команды администратора</b>\n" +
    "/panel — сводка по боту и whitelist\n" +
    "/stats [telegram_id] — статистика (общая или по пользователю)\n" +
    "/users — список пользователей в whitelist\n" +
    "/allow &lt;telegram_id&gt; — добавить в whitelist\n" +
    "/deny &lt;telegram_id&gt; — удалить из whitelist\n" +
    "/whitelist [on|off] — статус/включить/выключить whitelist\n" +
    "/translate [on|off] — перевод на русский в inline (beta)\n" +
    "/health — проверка БД и провайдера";
  await ctx.reply(baseHelp + (isAdmin ? adminHelp : ""), {
    parse_mode: "HTML",
    link_preview_options: DISABLED_LINK_PREVIEW,
  });
});

privateChat.command("id", async (ctx) => {
  if (!ctx.from) return;
  await ctx.reply(`🆔 Ваш Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: "HTML" });
});

privateChat.on("message:text", async (ctx) => {
  if (!ctx.from) return;
  const text = ctx.message.text;
  if (text.startsWith("/")) {
    await ctx.reply("❓ Неизвестная команда. Используйте /help.");
    return;
  }

  // A status link is a post; otherwise a bare handle link is a profile.
  const tweetUrl = extractFirstTweetUrl(text);
  const profileUrl = tweetUrl ? null : extractFirstProfileUrl(text);

  // Show an animated "generating" placeholder while we fetch (private chats only).
  if (tweetUrl !== null || profileUrl !== null) {
    await sendThinkingDraft(ctx);
  }

  if (profileUrl !== null) {
    const result = await ctx.services.profileShare.processUrl(profileUrl, {
      telegramUserId: ctx.from.id,
      chatId: ctx.chat.id,
      mode: "private",
    });
    await sendProfileResult(ctx, result);
    return;
  }

  const result = await ctx.services.tweetShare.processText(text, {
    telegramUserId: ctx.from.id,
    chatId: ctx.chat.id,
    mode: "private",
  });
  await sendShareResult(ctx, result);
});

// Stream a short-lived rich draft with a <tg-thinking> animation. It's a
// nice-to-have, so any failure is swallowed and the real reply still follows.
async function sendThinkingDraft(ctx: AppContext): Promise<void> {
  try {
    await ctx.replyWithRichMessageDraft(
      { html: `<tg-thinking>${THINKING_CAPTION}</tg-thinking>` },
      { draft_id: ctx.message?.message_id ?? 1 },
    );
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;
  }
}

async function sendShareResult(ctx: AppContext, result: ShareResult): Promise<void> {
  if (result.status === "invalid_url") {
    await ctx.reply(INVALID_LINK_TEXT, { link_preview_options: DISABLED_LINK_PREVIEW });
    return;
  }
  if (!result.ok || result.post === null) {
    await ctx.reply(FETCH_ERROR_TEXT);
    return;
  }

  const url = result.tweet?.url ?? result.normalizedUrl ?? "";
  const avatarEmoji = await resolveAvatarEmoji(ctx, result.tweet?.authorAvatarUrl);
  await replyWithPost(ctx, result.post, originalPostButton(url), avatarEmoji);
}

async function sendProfileResult(ctx: AppContext, result: ProfileShareResult): Promise<void> {
  if (result.status === "invalid_url") {
    await ctx.reply(INVALID_LINK_TEXT, { link_preview_options: DISABLED_LINK_PREVIEW });
    return;
  }
  if (!result.ok || result.post === null) {
    await ctx.reply(PROFILE_ERROR_TEXT);
    return;
  }

  const url = result.profile?.url ?? result.normalizedUrl ?? "";
  const avatarEmoji = await resolveAvatarEmoji(ctx, result.profile?.avatarUrl);
  await replyWithPost(ctx, result.post, openProfileButton(url), avatarEmoji);
}

interface AvatarEmoji {
  id: string;
  glyph: string;
}

// Best-effort: turn the avatar into a custom emoji to show inline. Returns
// undefined when the feature is off or anything fails (it never throws).
async function resolveAvatarEmoji(
  ctx: AppContext,
  avatarUrl: string | null | undefined,
): Promise<AvatarEmoji | undefined> {
  const service = ctx.services.avatarEmoji;
  if (!service || !avatarUrl) return undefined;
  const id = await service.resolve(avatarUrl);
  return id ? { id, glyph: service.fallbackGlyph } : undefined;
}

// Send an already-formatted post: prefer a Rich Message (long text, up to ~32k
// chars, plus an inline media carousel), then fall back to the legacy senders.
// When an avatar emoji is given, try it first and retry without it if Telegram
// rejects the custom emoji (e.g. the bot isn't eligible to send one).
async function replyWithPost(
  ctx: AppContext,
  post: TelegramPost,
  button: InlineKeyboard,
  avatarEmoji?: AvatarEmoji,
): Promise<void> {
  const rich = buildRichMessage(post);
  const candidates = avatarEmoji
    ? [withAvatarEmoji(rich, avatarEmoji.id, avatarEmoji.glyph), rich]
    : [rich];
  for (const candidate of candidates) {
    try {
      await ctx.replyWithRichMessage(candidate, { reply_markup: button });
      return;
    } catch (error) {
      if (!(error instanceof GrammyError)) throw error;

      console.error("failed to send rich message", error);
    }
  }

  if (post.media.length > 0) {
    await sendMedia(ctx, [...post.media], {
      caption: post.captionHtml,
      captionGroup: `${post.captionHtml}\n\n${post.linkHtml}`,
      fallbackText: post.html,
      replyMarkup: button,
    });
    return;
  }

  await ctx.reply(post.html, {
    parse_mode: "HTML",
    link_preview_options: DISABLED_LINK_PREVIEW,
    reply_markup: button,
  });
}

interface SendMediaOptions {
  caption: string;
  captionGroup: string;
  fallbackText: string;
  replyMarkup: InlineKeyboard;
}

async function sendMedia(
  ctx: AppContext,
  media: TweetMedia[],
  options: SendMediaOptions,
): Promise<void> {
  if (media.length >= 2) {
    try {
      await ctx.replyWithMediaGroup(
        media.map((item, index) =>
          inputGroupMedia(item, index === 0 ? options.captionGroup : null),
        ),
      );
      return;
    } catch (error) {
      if (!(error instanceof GrammyError)) throw error;
    }

    const previewGroup = previewInputGroup(media, options.captionGroup);
    if (previewGroup !== null) {
      try {
        await ctx.replyWithMediaGroup(previewGroup);
        return;
      } catch (error) {
        if (!(error instanceof GrammyError)) throw error;
      }
    }
  }

  let captionSent = false;
  let anySent = false;
  for (const item of media) {
    const itemCaption = captionSent ? null : options.caption;
    const itemMarkup = captionSent ? null : options.replyMarkup;
    if (await trySendOne(ctx, item, itemCaption, itemMarkup)) {
      anySent = true;
      if (itemCaption !== null) captionSent = true;
    }
  }

  if (!anySent || !captionSent) {
    await ctx.reply(options.fallbackText, {
      parse_mode: "HTML",
      link_preview_options: DISABLED_LINK_PREVIEW,
      reply_markup: options.replyMarkup,
    });
  }
}

async function trySendOne(
  ctx: AppContext,
  item: TweetMedia,
  caption: string | null,
  replyMarkup: InlineKeyboard | null,
): Promise<boolean> {
  try {
    await sendSingleMedia(ctx, item, caption, replyMarkup);
    return true;
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;
  }
  if (item.previewUrl) {
    try {
      await ctx.replyWithPhoto(item.previewUrl, {
        caption: caption ?? undefined,
        parse_mode: caption ? "HTML" : undefined,
        reply_markup: replyMarkup ?? undefined,
      });
      return true;
    } catch (error) {
      if (!(error instanceof GrammyError)) throw error;
    }
  }
  return false;
}

async function sendSingleMedia(
  ctx: AppContext,
  item: TweetMedia,
  caption: string | null,
  replyMarkup: InlineKeyboard | null,
): Promise<void> {
  const parseMode = caption ? ("HTML" as const) : undefined;
  if (item.type === "photo") {
    await ctx.replyWithPhoto(item.url, {
      caption: caption ?? undefined,
      parse_mode: parseMode,
      reply_markup: replyMarkup ?? undefined,
    });
    return;
  }
  if (item.type === "gif") {
    await ctx.replyWithAnimation(item.url, {
      caption: caption ?? undefined,
      parse_mode: parseMode,
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      duration: durationSeconds(item.durationMs) ?? undefined,
      reply_markup: replyMarkup ?? undefined,
    });
    return;
  }
  await ctx.replyWithVideo(item.url, {
    caption: caption ?? undefined,
    parse_mode: parseMode,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    duration: durationSeconds(item.durationMs) ?? undefined,
    reply_markup: replyMarkup ?? undefined,
  });
}

function inputGroupMedia(
  item: TweetMedia,
  caption: string | null,
): InputMediaPhoto | InputMediaVideo {
  if (item.type === "photo") {
    return {
      type: "photo",
      media: item.url,
      caption: caption ?? undefined,
      parse_mode: caption ? "HTML" : undefined,
    };
  }
  return {
    type: "video",
    media: item.url,
    caption: caption ?? undefined,
    parse_mode: caption ? "HTML" : undefined,
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    duration: durationSeconds(item.durationMs) ?? undefined,
  };
}

function previewInputGroup(media: TweetMedia[], caption: string): InputMediaPhoto[] | null {
  const items: InputMediaPhoto[] = [];
  for (const item of media) {
    let url: string;
    if (item.type === "photo") {
      url = item.previewUrl ?? item.url;
    } else if (item.previewUrl) {
      url = item.previewUrl;
    } else {
      return null;
    }
    const isFirst = items.length === 0;
    items.push({
      type: "photo",
      media: url,
      caption: isFirst ? caption : undefined,
      parse_mode: isFirst ? "HTML" : undefined,
    });
  }
  return items.length >= 2 ? items : null;
}

function durationSeconds(durationMs: number | null): number | null {
  if (durationMs === null) return null;
  return Math.max(1, Math.round(durationMs / 1000));
}

// Re-export to satisfy bundlers in case helpers tree-shake unevenly.
export { InputFile };
