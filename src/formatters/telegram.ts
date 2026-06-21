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
  /** Allow rich-only markup (e.g. collapsible `<details>` quotes). */
  rich?: boolean;
}

// Quoted/replied tweets longer than this collapse into a `<details>` block in
// rich messages so they don't dominate the screen.
const QUOTE_COLLAPSE_LIMIT = 200;

export function formatTweet(tweet: TweetData, options: FormatOptions = {}): TelegramPost {
  const media = tweet.media.slice(0, MAX_MEDIA);
  const linkHtml = originalPostLinkHtml(tweet.url);
  const suffixLen = "\n\n".length + linkHtml.length;
  return {
    html: renderTweetHtml(tweet, MESSAGE_LIMIT - suffixLen, options),
    richHtml: renderTweetHtml(tweet, RICH_MESSAGE_LIMIT - suffixLen, { ...options, rich: true }),
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
    const parts: string[] = text
      ? [authorHtml(tweet), "", linkifyEntities(text)]
      : [authorHtml(tweet)];
    const related = tweet.quotedTweet ?? tweet.repliedToTweet;
    if (related) {
      parts.push("", relatedBlockHtml(related, tweet.quotedTweet !== null, options.rich ?? false));
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

function relatedBlockHtml(tweet: TweetData, quoted: boolean, rich: boolean): string {
  const title = relatedTitleHtml(tweet, quoted);
  const body = relatedHtml(tweet);
  // Collapse long quotes into an expandable block (rich messages only).
  if (rich && (tweet.text ?? "").trim().length > QUOTE_COLLAPSE_LIMIT) {
    return `<details><summary>${title}</summary>${body}</details>`;
  }
  return `${title}:\n<blockquote>${body}</blockquote>`;
}

function relatedTitleHtml(tweet: TweetData, quoted: boolean): string {
  const label = quoted ? "Цитируемый пост" : "Ответ на";
  const emoji = quoted ? "💬" : "↩️";
  return `${emoji} <a href="${escapeAttr(tweet.url)}">${label}</a>`;
}

function relatedHtml(tweet: TweetData): string {
  const text = (tweet.text ?? "").trim();
  const label = `${tweet.authorName} (@${tweet.authorUsername})`;
  // Link the quoted/replied author's name to their profile.
  const author = `<a href="${escapeAttr(tweet.authorUrl)}">${escapeHtml(label)}</a>`;
  return text ? `${author}:\n${escapeHtml(truncateRaw(text, 500))}` : author;
}

const ENTITY_RE =
  /(?<url>https?:\/\/[^\s<]+)|(?<![\w@])@(?<mention>[A-Za-z0-9_]{1,15})|(?<![\w#])#(?<hashtag>[\p{L}\p{N}_]+)|(?<![\w$])\$(?<cashtag>[A-Za-z]{1,6})(?![A-Za-z])/gu;

/**
 * Escape tweet text and turn Twitter entities into links pointing back to X:
 * `@mentions`, `#hashtags`, `$cashtags`, and bare URLs.
 */
export function linkifyEntities(text: string): string {
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(ENTITY_RE)) {
    const groups = match.groups ?? {};
    const start = match.index ?? 0;
    result += escapeHtml(text.slice(lastIndex, start));
    if (groups.url !== undefined) {
      const url = trimTrailingPunctuation(groups.url);
      result += anchorHtml(url, url);
      lastIndex = start + url.length;
      continue;
    }
    if (groups.mention !== undefined) {
      result += anchorHtml(`https://x.com/${groups.mention}`, `@${groups.mention}`);
    } else if (groups.hashtag !== undefined) {
      result += anchorHtml(`https://x.com/hashtag/${groups.hashtag}`, `#${groups.hashtag}`);
    } else if (groups.cashtag !== undefined) {
      result += anchorHtml(`https://x.com/search?q=%24${groups.cashtag}`, `$${groups.cashtag}`);
    }
    lastIndex = start + match[0].length;
  }
  return result + escapeHtml(text.slice(lastIndex));
}

function anchorHtml(href: string, label: string): string {
  return `<a href="${escapeAttr(href)}">${escapeHtml(label)}</a>`;
}

function trimTrailingPunctuation(url: string): string {
  const trimmed = url.replace(/[.,!?;:)\]}'"]+$/, "");
  return trimmed.length > 0 ? trimmed : url;
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
