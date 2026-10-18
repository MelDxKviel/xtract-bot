import { GrammyError, type InlineKeyboard } from "grammy";

import type { AppContext } from "@/bot/context";
import { openProfileButton, originalPostButton } from "@/bot/ui";
import { safeError } from "@/logging";
import {
  parseProfileUrl,
  parseTweetUrl,
  type ParsedProfileUrl,
  type ParsedTweetUrl,
} from "@/utils/urls";

type RetryKind = "tweet" | "text" | "profile";
type ShareRetry =
  | { kind: "tweet" | "text"; parsed: ParsedTweetUrl }
  | { kind: "profile"; parsed: ParsedProfileUrl };

const NON_RETRYABLE_ERRORS = new Set([
  "not_found",
  "private_or_deleted",
  "provider_auth",
  "invalid_url",
]);

// Only compact identifiers travel through Telegram callback_data. Reconstruct
// a validated canonical URL rather than accepting a URL supplied by a client.
export function parseShareRetry(data: string | undefined): ShareRetry | null {
  if (!data || data.length > 64 || data.trim() !== data) return null;
  const [prefix, kind, target, ...extra] = data.split(":");
  if (prefix !== "retry" || !target || extra.length > 0) return null;

  if (kind === "profile" && /^[A-Za-z0-9_]{1,15}$/.test(target)) {
    const parsed = parseProfileUrl(`https://x.com/${target}`);
    return parsed ? { kind, parsed } : null;
  }
  if ((kind === "tweet" || kind === "text") && /^[1-9]\d{0,19}$/.test(target)) {
    const parsed = parseTweetUrl(`https://x.com/i/status/${target}`);
    return parsed ? { kind, parsed } : null;
  }
  return null;
}

export function shareErrorKeyboard(
  url: string | null,
  errorCode: string | null,
  kind: RetryKind,
): InlineKeyboard | undefined {
  if (!url) return undefined;
  const parsed = kind === "profile" ? parseProfileUrl(url) : parseTweetUrl(url);
  if (!parsed) return undefined;
  const keyboard =
    kind === "profile"
      ? openProfileButton(parsed.normalizedUrl)
      : originalPostButton(parsed.normalizedUrl);
  const target = "tweetId" in parsed ? parsed.tweetId : parsed.username;
  const data = `retry:${kind}:${target}`;
  if (errorCode && !NON_RETRYABLE_ERRORS.has(errorCode) && parseShareRetry(data)) {
    keyboard.row().text("🔄 Повторить", data);
  }
  return keyboard;
}

export async function answerShareRetry(
  ctx: AppContext,
  text: string,
  showAlert = false,
): Promise<void> {
  try {
    await ctx.answerCallbackQuery({ text, show_alert: showAlert });
  } catch (error) {
    if (!(error instanceof GrammyError)) throw error;
    // An expired acknowledgement must not prevent the requested share.
    console.error("failed to answer share retry", safeError(error));
  }
}
