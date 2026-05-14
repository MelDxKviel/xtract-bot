import { Composer, GrammyError, type InlineKeyboard } from "grammy";
import type { InputMediaAnimation, InputMediaPhoto, InputMediaVideo } from "grammy/types";

import type { AppContext } from "@/bot/context";
import { DISABLED_LINK_PREVIEW, originalPostButton } from "@/bot/ui";
import type { TweetMedia } from "@/providers/base";
import { extractFirstTweetUrl } from "@/utils/urls";

export const inlineComposer = new Composer<AppContext>();

inlineComposer.on("inline_query", async (ctx) => {
  const parsed = extractFirstTweetUrl(ctx.inlineQuery.query ?? "");
  if (parsed === null) {
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "invalid-link",
          title: "🔗 Нужна ссылка на пост X/Twitter",
          description: "Например: https://x.com/user/status/123",
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

  await ctx.answerInlineQuery(
    [
      {
        type: "article",
        id: `tweet-${parsed.tweetId}`,
        title: "📤 Поделиться постом",
        description: parsed.normalizedUrl,
        input_message_content: {
          message_text: "⏳ Загрузка поста...",
          parse_mode: "HTML",
          link_preview_options: DISABLED_LINK_PREVIEW,
        },
        reply_markup: originalPostButton(parsed.normalizedUrl),
      },
    ],
    { cache_time: 1, is_personal: true },
  );
});

inlineComposer.on("chosen_inline_result", async (ctx) => {
  const inlineMessageId = ctx.chosenInlineResult.inline_message_id;
  if (!inlineMessageId) return;

  const parsed = extractFirstTweetUrl(ctx.chosenInlineResult.query ?? "");
  if (parsed === null) {
    await safeEditText(ctx, inlineMessageId, "⚠️ Не удалось распознать ссылку на пост X/Twitter.");
    return;
  }

  const share = await ctx.services.tweetShare.processUrl(parsed, {
    telegramUserId: ctx.chosenInlineResult.from.id,
    chatId: null,
    mode: "inline",
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
  if (share.post.media.length > 0) {
    await safeEditMedia(ctx, inlineMessageId, share.post.media[0]!, share.post.captionHtml, button);
    return;
  }

  await safeEditText(ctx, inlineMessageId, share.post.html, button);
});

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
