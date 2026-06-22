import { Composer, GrammyError, type InlineKeyboard } from "grammy";
import type {
  InlineQueryResult,
  InputMediaAnimation,
  InputMediaPhoto,
  InputMediaVideo,
} from "grammy/types";

import type { AppContext } from "@/bot/context";
import {
  DISABLED_LINK_PREVIEW,
  INLINE_THUMBNAIL_INVALID,
  INLINE_THUMBNAIL_SHARE,
  INLINE_THUMBNAIL_SIZE,
  INLINE_THUMBNAIL_THREAD,
  INLINE_THUMBNAIL_TRANSLATE_RU,
  originalPostButton,
} from "@/bot/ui";
import { formatTweet, type TelegramPost } from "@/formatters/telegram";
import { buildRichMessage } from "@/formatters/richMessage";
import type { TweetMedia } from "@/providers/base";
import { languageNameInRussian, translateTweet, TranslationError } from "@/services/translation";
import { extractFirstTweetUrl } from "@/utils/urls";

// Result-id prefixes; order matters when matching since they share a stem.
const THREAD_ID_PREFIX = "tweet-thread-";
const TRANSLATED_ID_PREFIX = "tweet-ru-";
const DEFAULT_ID_PREFIX = "tweet-";

export const inlineComposer = new Composer<AppContext>();

inlineComposer.on("inline_query", async (ctx) => {
  const parsed = extractFirstTweetUrl(ctx.inlineQuery.query ?? "");
  if (parsed === null) {
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "invalid-link",
          title: "Нужна ссылка на пост X/Twitter",
          description: "Например: https://x.com/user/status/123",
          thumbnail_url: INLINE_THUMBNAIL_INVALID,
          thumbnail_width: INLINE_THUMBNAIL_SIZE,
          thumbnail_height: INLINE_THUMBNAIL_SIZE,
          input_message_content: {
            message_text: "🔗 Пришлите ссылку на пост X/Twitter.",
            link_preview_options: DISABLED_LINK_PREVIEW,
          },
        },
      ],
      { cache_time: 1, is_personal: true },
    );
    return;
  }

  const results: InlineQueryResult[] = [
    {
      type: "article",
      id: `${DEFAULT_ID_PREFIX}${parsed.tweetId}`,
      title: "Поделиться постом",
      description: parsed.normalizedUrl,
      thumbnail_url: INLINE_THUMBNAIL_SHARE,
      thumbnail_width: INLINE_THUMBNAIL_SIZE,
      thumbnail_height: INLINE_THUMBNAIL_SIZE,
      input_message_content: {
        message_text: "⏳ Загрузка поста...",
        parse_mode: "HTML",
        link_preview_options: DISABLED_LINK_PREVIEW,
      },
      reply_markup: originalPostButton(parsed.normalizedUrl),
    },
  ];

  // Offer unrolling the whole thread as a separate result (the user picks).
  if (ctx.settings.threadUnrollEnabled) {
    results.push({
      type: "article",
      id: `${THREAD_ID_PREFIX}${parsed.tweetId}`,
      title: "🧵 Поделиться тредом",
      description: "Развернуть весь тред",
      thumbnail_url: INLINE_THUMBNAIL_THREAD,
      thumbnail_width: INLINE_THUMBNAIL_SIZE,
      thumbnail_height: INLINE_THUMBNAIL_SIZE,
      input_message_content: {
        message_text: "⏳ Загрузка треда...",
        parse_mode: "HTML",
        link_preview_options: DISABLED_LINK_PREVIEW,
      },
      reply_markup: originalPostButton(parsed.normalizedUrl),
    });
  }

  if (ctx.runtimeConfig.russianTranslationEnabled) {
    results.push({
      type: "article",
      id: `${TRANSLATED_ID_PREFIX}${parsed.tweetId}`,
      title: "Отправить на русском (beta)",
      description: parsed.normalizedUrl,
      thumbnail_url: INLINE_THUMBNAIL_TRANSLATE_RU,
      thumbnail_width: INLINE_THUMBNAIL_SIZE,
      thumbnail_height: INLINE_THUMBNAIL_SIZE,
      input_message_content: {
        message_text: "⏳ Переводим пост на русский...",
        parse_mode: "HTML",
        link_preview_options: DISABLED_LINK_PREVIEW,
      },
      reply_markup: originalPostButton(parsed.normalizedUrl),
    });
  }

  await ctx.answerInlineQuery(results, { cache_time: 1, is_personal: true });
});

inlineComposer.on("chosen_inline_result", async (ctx) => {
  const inlineMessageId = ctx.chosenInlineResult.inline_message_id;
  if (!inlineMessageId) return;

  const resultId = ctx.chosenInlineResult.result_id;
  const shareThread = resultId.startsWith(THREAD_ID_PREFIX);
  const translateToRussian =
    !shareThread &&
    resultId.startsWith(TRANSLATED_ID_PREFIX) &&
    ctx.runtimeConfig.russianTranslationEnabled;

  const parsed = extractFirstTweetUrl(ctx.chosenInlineResult.query ?? "");
  if (parsed === null) {
    await safeEditText(ctx, inlineMessageId, "⚠️ Не удалось распознать ссылку на пост X/Twitter.");
    return;
  }

  const share = await ctx.services.tweetShare.processUrl(parsed, {
    telegramUserId: ctx.chosenInlineResult.from.id,
    chatId: null,
    mode: "inline",
    // Only the "thread" result unrolls; the plain/translate results stay single.
    unrollThread: shareThread,
  });
  if (!share.ok || share.post === null) {
    await safeEditText(
      ctx,
      inlineMessageId,
      "⚠️ Не удалось получить пост. Возможно, он удален, приватный или временно недоступен.",
      originalPostButton(parsed.normalizedUrl),
    );
    return;
  }

  const originalUrl = share.tweet?.url ?? parsed.normalizedUrl;
  const button = originalPostButton(originalUrl);

  let post = share.post;
  if (translateToRussian && share.tweet) {
    try {
      const translated = await translateTweet(share.tweet, ctx.translator);
      post = formatTweet(translated.tweet, {
        originalLanguageLabel: languageNameInRussian(translated.sourceLang),
      });
    } catch (error) {
      if (error instanceof TranslationError) {
        console.error("translation failed", error.code, error.message);
      } else {
        console.error("translation unexpected error", error);
      }
      await safeEditText(
        ctx,
        inlineMessageId,
        "⚠️ Не удалось перевести пост. Попробуйте поделиться оригиналом.",
        button,
      );
      return;
    }
  }

  await safeEditRich(ctx, inlineMessageId, post, button);
});

async function safeEditRich(
  ctx: AppContext,
  inlineMessageId: string,
  post: TelegramPost,
  replyMarkup: InlineKeyboard,
): Promise<void> {
  // Edit the placeholder into a Rich Message: long text plus a media carousel.
  try {
    await ctx.api.editMessageTextInline(inlineMessageId, buildRichMessage(post), {
      reply_markup: replyMarkup,
    });
    return;
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;

    console.error("failed to edit inline rich message", error);
  }

  // Fall back to the legacy single-media / text edit if rich messages are unavailable.
  if (post.media.length > 0) {
    await safeEditMedia(ctx, inlineMessageId, post.media[0]!, post.captionHtml, replyMarkup);
    return;
  }

  await safeEditText(ctx, inlineMessageId, post.html, replyMarkup);
}

async function safeEditText(
  ctx: AppContext,
  inlineMessageId: string,
  text: string,
  replyMarkup?: InlineKeyboard,
): Promise<void> {
  try {
    await ctx.api.editMessageTextInline(inlineMessageId, text, {
      parse_mode: "HTML",
      link_preview_options: DISABLED_LINK_PREVIEW,
      reply_markup: replyMarkup,
    });
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;

    console.error("failed to edit inline message", error);
  }
}

async function safeEditMedia(
  ctx: AppContext,
  inlineMessageId: string,
  item: TweetMedia,
  caption: string,
  replyMarkup: InlineKeyboard,
): Promise<void> {
  try {
    await ctx.api.editMessageMediaInline(inlineMessageId, inputMedia(item, caption), {
      reply_markup: replyMarkup,
    });
    return;
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;

    console.error("failed to edit inline media", error);
  }

  if (item.previewUrl) {
    try {
      await ctx.api.editMessageMediaInline(
        inlineMessageId,
        {
          type: "photo",
          media: item.previewUrl,
          caption,
          parse_mode: "HTML",
        },
        { reply_markup: replyMarkup },
      );
      return;
    } catch (error) {
      if (!(error instanceof GrammyError)) throw error;

      console.error("failed to edit inline media preview", error);
    }
  }

  await safeEditText(ctx, inlineMessageId, caption, replyMarkup);
}

function inputMedia(
  item: TweetMedia,
  caption: string,
): InputMediaPhoto | InputMediaVideo | InputMediaAnimation {
  if (item.type === "photo") {
    return { type: "photo", media: item.url, caption, parse_mode: "HTML" };
  }
  if (item.type === "video") {
    return {
      type: "video",
      media: item.url,
      caption,
      parse_mode: "HTML",
      width: item.width ?? undefined,
      height: item.height ?? undefined,
      duration: durationSeconds(item.durationMs) ?? undefined,
    };
  }
  return {
    type: "animation",
    media: item.url,
    caption,
    parse_mode: "HTML",
    width: item.width ?? undefined,
    height: item.height ?? undefined,
    duration: durationSeconds(item.durationMs) ?? undefined,
  };
}

function durationSeconds(durationMs: number | null): number | null {
  if (durationMs === null) return null;
  return Math.max(1, Math.round(durationMs / 1000));
}
