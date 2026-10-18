import type { MiddlewareFn } from "grammy";

import type { AppContext } from "@/bot/context";
import { answerShareRetry, parseShareRetry } from "@/bot/shareRetry";
import type { RateLimiter } from "@/services/rateLimit";
import { extractFirstProfileUrl, extractFirstTweetUrl } from "@/utils/urls";

const RATE_LIMITED_TEXT = "🐢 Слишком много запросов. Подождите немного и попробуйте снова.";

type ShareKind = "private" | "inline";

// Only the actions that actually fetch (a tweet or a profile) count against the
// budget: private links, /text, retry buttons and chosen inline results.
// Cheap suggestions and malformed retry data are not limited.
function classify(ctx: AppContext): ShareKind | null {
  if (ctx.chosenInlineResult) return "inline";
  if (ctx.chat?.type === "private" && parseShareRetry(ctx.callbackQuery?.data)) return "private";
  const text = ctx.message?.text;
  if (ctx.hasCommand("text")) {
    return ctx.chat?.type === "private" && extractFirstTweetUrl(ctx.match) !== null
      ? "private"
      : null;
  }
  if (
    ctx.chat?.type === "private" &&
    text &&
    !text.startsWith("/") &&
    (extractFirstTweetUrl(text) !== null || extractFirstProfileUrl(text) !== null)
  ) {
    return "private";
  }
  return null;
}

export function rateLimitMiddleware(limiter: RateLimiter): MiddlewareFn<AppContext> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    const kind = userId === undefined ? null : classify(ctx);
    if (userId === undefined || kind === null || ctx.services.access.isAdmin(userId)) {
      return next();
    }

    const result = limiter.check(userId);
    if (result.allowed) return next();

    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    if (kind === "private") {
      if (ctx.callbackQuery) {
        await answerShareRetry(ctx, `${RATE_LIMITED_TEXT} (~${seconds} с)`, true);
        return;
      }
      await ctx.reply(`${RATE_LIMITED_TEXT} (~${seconds} с)`);
      return;
    }

    const inlineMessageId = ctx.chosenInlineResult?.inline_message_id;
    if (inlineMessageId) {
      try {
        await ctx.api.editMessageTextInline(inlineMessageId, RATE_LIMITED_TEXT);
      } catch {
        // The placeholder may be uneditable; nothing else we can do here.
      }
    }
    // Intentionally do not call next(): the share is dropped.
  };
}
