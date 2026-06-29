import type { TweetData, TweetMedia, TweetPoll } from "@/providers/base";

export const MESSAGE_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;
// Rich messages allow up to 32768 chars; a small margin covers markup and the
// newline-to-<br> expansion done when rendering the rich message.
export const RICH_MESSAGE_LIMIT = 32000;
export const MAX_MEDIA = 10;
export const ORIGINAL_POST_LABEL = "Оригинальный пост в 𝕏";

const LEADING_MENTIONS_RE = /^(@[A-Za-z0-9_]{1,50}(?:\s+|$))+/;

export interface TelegramThreadSegment {
  /** Rendered body for one thread post (text + poll, linkified; no author). */
  html: string;
  /** Media belonging to this specific post, attached right after its text. */
  media: readonly TweetMedia[];
}

export interface TelegramPost {
  /** Body for a plain message (capped at the 4096-char Telegram limit). */
  html: string;
  /** Body for a Rich Message (up to ~32k chars, so long posts aren't truncated). */
  richHtml: string;
  captionHtml: string;
  linkHtml: string;
  media: readonly TweetMedia[];
  extraMediaCount: number;
  /**
   * Present only for unrolled threads: one entry per post, in order. The Rich
   * Message builder interleaves each post's text with its own media instead of
   * merging everything into a single carousel.
   */
  segments?: readonly TelegramThreadSegment[];
  /** Author + thread marker rendered once above the segments (threads only). */
  threadHeaderHtml?: string;
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

/**
 * Format an unrolled thread (oldest → newest, all by the same author) as one
 * post: a single author header, then each tweet's text/poll as a `segment`
 * carrying its own media (the Rich Message builder interleaves text and media
 * per post and joins them with dividers — no numbering). The flat `html` /
 * `media` fields remain populated for the legacy non-rich fallbacks. The shared
 * (last) tweet supplies the canonical link.
 */
export function formatThread(
  tweets: readonly TweetData[],
  options: FormatOptions = {},
): TelegramPost {
  if (tweets.length <= 1) {
    return formatTweet(tweets[0]!, options);
  }
  const root = tweets[tweets.length - 1]!;
  const media = collectThreadMedia(tweets);
  const linkHtml = originalPostLinkHtml(root.url);
  const suffixLen = "\n\n".length + linkHtml.length;
  // Segments carry full (uncapped) bodies; the Rich Message builder enforces the
  // 32k char / 50 media limits while interleaving.
  const segments: TelegramThreadSegment[] = tweets.map((tweet) => ({
    html: threadBodyHtml(tweet, RICH_MESSAGE_LIMIT, true),
    media: tweet.media,
  }));
  return {
    html: renderThreadHtml(tweets, MESSAGE_LIMIT - suffixLen, options),
    richHtml: renderThreadHtml(tweets, RICH_MESSAGE_LIMIT - suffixLen, { ...options, rich: true }),
    captionHtml: renderThreadHtml(tweets, CAPTION_LIMIT - suffixLen, options),
    linkHtml,
    media: media.slice(0, MAX_MEDIA),
    extraMediaCount: Math.max(0, media.length - MAX_MEDIA),
    segments,
    threadHeaderHtml: threadHeaderHtml(root, tweets.length),
  };
}

export function originalPostLinkHtml(url: string): string {
  return `<a href="${escapeAttr(url)}">${ORIGINAL_POST_LABEL}</a>`;
}

function collectThreadMedia(tweets: readonly TweetData[]): TweetMedia[] {
  const media: TweetMedia[] = [];
  const seen = new Set<string>();
  for (const tweet of tweets) {
    for (const item of tweet.media) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      media.push(item);
    }
  }
  return media;
}

function threadHeaderHtml(root: TweetData, count: number): string {
  return `${authorHtml(root)}\n🧵 <i>Тред — ${count} ${pluralPosts(count)}</i>`;
}

// One thread post's body: linkified text plus an optional poll. No author and
// no numbering — posts are chained, not enumerated.
function threadBodyHtml(tweet: TweetData, cap: number, rich: boolean): string {
  const text = (tweet.text ?? "").trim();
  const parts: string[] = [];
  if (text) parts.push(linkifyEntities(truncateRaw(text, cap)));
  if (tweet.poll) {
    if (parts.length > 0) parts.push("");
    parts.push(rich ? richPollHtml(tweet.poll) : pollHtml(tweet.poll));
  }
  return parts.join("\n");
}

// Plain-text rendering used only by the non-rich fallbacks (the Rich Message
// path uses `segments`). Posts are separated by a blank line, not numbered.
function renderThreadHtml(
  tweets: readonly TweetData[],
  limit: number,
  options: FormatOptions,
): string {
  const root = tweets[tweets.length - 1]!;
  const total = tweets.length;
  const header = threadHeaderHtml(root, total);

  const footer: string[] = [];
  if (options.originalLanguageLabel) {
    footer.push(`<i>Язык оригинала: ${escapeHtml(options.originalLanguageLabel)}</i>`);
  }

  const segCap = options.rich ? 4000 : 800;
  const bodies = tweets.map((tweet) => threadBodyHtml(tweet, segCap, options.rich ?? false));

  const assemble = (count: number): string => {
    const parts: string[] = [header];
    for (let index = 0; index < count; index += 1) {
      parts.push("", bodies[index]!);
    }
    if (count < total) {
      parts.push("", `<i>… ещё ${total - count} ${pluralPosts(total - count)}</i>`);
    }
    for (const line of footer) {
      parts.push("", line);
    }
    return parts.join("\n");
  };

  // Drop trailing posts until it fits; keep at least the first one.
  for (let count = total; count >= 1; count -= 1) {
    const rendered = assemble(count);
    if (rendered.length <= limit) return rendered;
  }
  return `${header}\n\n...`;
}

export function pluralPosts(count: number): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return "постов";
  if (mod10 === 1) return "пост";
  if (mod10 >= 2 && mod10 <= 4) return "поста";
  return "постов";
}

export function pollHtml(poll: TweetPoll): string {
  const sumVotes = poll.options.reduce((sum, option) => sum + Math.max(0, option.votes), 0);
  const total = poll.totalVotes > 0 ? poll.totalVotes : sumVotes;
  const lines = ["🗳 <b>Опрос</b>"];
  for (const option of poll.options) {
    const percent = total > 0 ? Math.round((option.votes / total) * 100) : 0;
    lines.push(`▫️ ${escapeHtml(option.label)} — ${percent}% (${formatVotes(option.votes)})`);
  }
  const status = poll.closed ? "завершён" : "идёт";
  lines.push(`<i>Всего голосов: ${formatVotes(total)} · ${status}</i>`);
  return lines.join("\n");
}

// Width (in cells) of the monospace progress bar drawn for rich-message polls.
const POLL_BAR_WIDTH = 12;

/**
 * Poll rendering for Rich Messages: a monospace progress bar per option (so the
 * bars line up), the leading option in bold, plus percentage and vote count —
 * a poll-like widget rather than the plain bullet list used as a fallback.
 */
export function richPollHtml(poll: TweetPoll): string {
  const sumVotes = poll.options.reduce((sum, option) => sum + Math.max(0, option.votes), 0);
  const total = poll.totalVotes > 0 ? poll.totalVotes : sumVotes;
  const maxVotes = poll.options.reduce((max, option) => Math.max(max, option.votes), 0);

  const lines = ["🗳 <b>Опрос</b>"];
  for (const option of poll.options) {
    const fraction = total > 0 ? Math.max(0, option.votes) / total : 0;
    const filled = Math.max(0, Math.min(POLL_BAR_WIDTH, Math.round(fraction * POLL_BAR_WIDTH)));
    const bar = "█".repeat(filled) + "░".repeat(POLL_BAR_WIDTH - filled);
    const label = escapeHtml(option.label);
    const isLeader = maxVotes > 0 && option.votes === maxVotes;
    const name = isLeader ? `<b>${label}</b>` : label;
    lines.push(`${name} — ${Math.round(fraction * 100)}% · ${formatVotes(option.votes)}`);
    lines.push(`<code>${bar}</code>`);
  }
  const status = poll.closed ? "завершён" : "идёт";
  lines.push(`<i>Всего голосов: ${formatVotes(total)} · ${status}</i>`);
  return lines.join("\n");
}

function formatVotes(votes: number): string {
  return Math.round(Math.max(0, votes))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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
    if (tweet.poll) {
      parts.push("", options.rich ? richPollHtml(tweet.poll) : pollHtml(tweet.poll));
    }
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
  return `𝕏 <a href="${escapeAttr(tweet.authorUrl)}">${escapeHtml(label)}</a>`;
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
