import type { TweetData, TweetMedia } from "@/providers/base";

export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;
// Rich messages allow up to 32768 chars; a small margin covers markup and the
// newline-to-<br> expansion done when rendering the rich message.
export const RICH_MESSAGE_LIMIT = 32000;
export const MAX_MEDIA = 10;
export const ORIGINAL_POST_LABEL = "🔗 Оригинальный пост";

const LEADING_MENTIONS_RE = /^(@[A-Za-z0-9_]{1,50}(?:\s+|$))+/;

export interface TelegramPost {
  /** Body for a plain message (capped at the 4096-char Telegram limit). */
  html: string;
  /** Body for a Rich Message (up to ~32k chars, so long posts aren't truncated). */
  richHtml: string;
  captionHtml: string;
  linkHtml: string;
  media: readonly TweetMedia[];
  extraMediaCount: number;
}

export interface FormatOptions {
  originalLanguageLabel?: string | null;
}

export function formatTweet(tweet: TweetData, options: FormatOptions = {}): TelegramPost {
  const media = tweet.media.slice(0, MAX_MEDIA);
  const linkHtml = originalPostLinkHtml(tweet.url);
  const suffixLen = "\n\n".length + linkHtml.length;
  return {
    html: renderTweetHtml(tweet, MESSAGE_LIMIT - suffixLen, options),
    richHtml: renderTweetHtml(tweet, RICH_MESSAGE_LIMIT - suffixLen, options),
    captionHtml: renderTweetHtml(tweet, CAPTION_LIMIT - suffixLen, options),
    linkHtml,
    media,
    extraMediaCount: Math.max(0, tweet.media.length - MAX_MEDIA),
  };
}

export function originalPostLinkHtml(url: string): string {
  return `<a href="${escapeAttr(url)}">${ORIGINAL_POST_LABEL}</a>`;
}

export function renderTweetHtml(
  tweet: TweetData,
  limit: number = MESSAGE_LIMIT,
  options: FormatOptions = {},
): string {
  let rawText = (tweet.text ?? "").trim();
  if (tweet.repliedToTweet) {
    const stripped = rawText.replace(LEADING_MENTIONS_RE, "").trim();
    if (stripped) rawText = stripped;
  }

  const languageFooter = options.originalLanguageLabel
    ? `<i>Язык оригинала: ${escapeHtml(options.originalLanguageLabel)}</i>`
    : null;

  const build = (text: string): string => {
    const parts: string[] = text ? [authorHtml(tweet), "", escapeHtml(text)] : [authorHtml(tweet)];
    const related = tweet.quotedTweet ?? tweet.repliedToTweet;
    const relatedBody = related ? relatedHtml(related) : null;
    if (related && relatedBody) {
      const relatedTitle = relatedTitleHtml(related, tweet.quotedTweet !== null);
      parts.push("", relatedTitle, `<blockquote>${relatedBody}</blockquote>`);
    }
    if (tweet.media.length > MAX_MEDIA) {
      parts.push("", `📎 Показаны первые ${MAX_MEDIA} медиа из ${tweet.media.length}.`);
    }
    if (languageFooter) {
      parts.push("", languageFooter);
    }
    return parts.join("\n");
  };

  let rendered = build(rawText);
  if (rendered.length <= limit) return rendered;

  let maxRawLen = rawText.length;
  while (maxRawLen > 0) {
    maxRawLen -= Math.max(1, Math.floor((rendered.length - limit) / 2));
    const clipped = truncateRaw(rawText, maxRawLen);
    rendered = build(clipped);
    if (rendered.length <= limit) return rendered;
  }

  const fallback = `${authorHtml(tweet)}\n\n...`;
  return fallback.length <= limit ? fallback : "...";
}

function authorHtml(tweet: TweetData): string {
  const label = `${tweet.authorName} (@${tweet.authorUsername})`;
  return `🐦 <a href="${escapeAttr(tweet.authorUrl)}">${escapeHtml(label)}</a>`;
}

function relatedTitleHtml(tweet: TweetData, quoted: boolean): string {
  if (quoted) {
    return `💬 <a href="${escapeAttr(tweet.url)}">Цитируемый пост</a>:`;
  }
  return `↩️ <a href="${escapeAttr(tweet.url)}">Ответ на</a>:`;
}

function relatedHtml(tweet: TweetData): string {
  const text = (tweet.text ?? "").trim();
  const label = `${tweet.authorName} (@${tweet.authorUsername})`;
  return text ? `${escapeHtml(label)}:\n${escapeHtml(truncateRaw(text, 500))}` : escapeHtml(label);
}

function truncateRaw(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return "...".slice(0, Math.max(0, maxLength));
  return value.slice(0, maxLength - 3).replace(/\s+$/, "") + "...";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
