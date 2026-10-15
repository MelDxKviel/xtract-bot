import type { InputRichMessage } from "grammy/types";
import { Parser } from "htmlparser2";

import {
  escapeAttr,
  escapeHtml,
  MESSAGE_LIMIT,
  safeWebUrl,
  type TelegramPost,
  type TelegramRelatedPost,
} from "@/formatters/telegram";
import type { TweetMedia } from "@/providers/base";

// Telegram caps a Rich Message at 50 media attachments in total.
const RICH_MEDIA_LIMIT = 50;

/**
 * Build a Bot API Rich Message from an already-formatted post.
 *
 * Each tweet's body is followed by its own media, then a separate quote/reply
 * block with the related post's media. Threads chain these segments with dividers.
 * All text is retained without a local HTML-length cap.
 */
export function buildRichMessage(post: TelegramPost): InputRichMessage {
  if (post.segments && post.segments.length > 0) {
    return buildSegmentedRichMessage(post);
  }
  const text = textToRichHtml(post.richHtml);
  const carousel = mediaCarouselHtml(post.media);
  return {
    html: carousel ? `${text}\n${carousel}` : text,
    // The body is already escaped/linked exactly as we want; skip Telegram's
    // auto-detection so Twitter @mentions and #hashtags aren't turned into
    // (wrong) Telegram mentions and hashtag searches.
    skip_entity_detection: true,
  };
}

function buildSegmentedRichMessage(post: TelegramPost): InputRichMessage {
  const segments = post.segments ?? [];
  const blocks: string[] = [];

  if (post.threadHeaderHtml) {
    const header = textToRichHtml(post.threadHeaderHtml);
    blocks.push(header);
  }

  let mediaBudget = RICH_MEDIA_LIMIT;
  for (const segment of segments) {
    const body = segment.html ? textToRichHtml(segment.html) : "";
    const allowed = segment.media.slice(0, Math.max(0, mediaBudget));
    const carousel = mediaCarouselHtml(allowed);
    let block = carousel ? (body ? `${body}\n${carousel}` : carousel) : body;
    mediaBudget -= allowed.length;
    if (segment.relatedPost) {
      const relatedMedia = segment.relatedPost.media.slice(0, Math.max(0, mediaBudget));
      block += relatedPostHtml(segment.relatedPost, relatedMedia);
      mediaBudget -= relatedMedia.length;
    }
    blocks.push(block);
  }

  return { html: blocks.join("<hr/>"), skip_entity_detection: true };
}

function relatedPostHtml(post: TelegramRelatedPost, media: readonly TweetMedia[]): string {
  const title = textToRichHtml(post.titleHtml);
  const body = textToRichHtml(post.html);
  const carousel = mediaCarouselHtml(media);
  const quote = `<blockquote>${body}${carousel ? `\n${carousel}` : ""}</blockquote>`;
  // Keep the entire context (including its carousel) inside the expandable block.
  return post.collapsed
    ? `<details><summary>${title}</summary>${quote}</details>`
    : `<p>${title}</p>${quote}`;
}

/** Drop every attachment for a text-only rich retry, including quote/reply media. */
export function withoutRichMedia(post: TelegramPost): TelegramPost {
  return {
    ...post,
    media: [],
    segments: post.segments?.map((segment) => ({
      ...segment,
      media: [],
      relatedPost: segment.relatedPost ? { ...segment.relatedPost, media: [] } : undefined,
    })),
  };
}

export function hasRichMedia(post: TelegramPost): boolean {
  return (
    post.media.length > 0 ||
    (post.segments?.some(
      (segment) => segment.media.length > 0 || (segment.relatedPost?.media.length ?? 0) > 0,
    ) ??
      false)
  );
}

/** Full Rich Message text in HTML supported by legacy text/caption methods. */
export function legacyTextHtml(post: TelegramPost): string {
  return post.richHtml
    .replace(/<details>/g, "<blockquote>")
    .replace(/<\/details>/g, "</blockquote>")
    .replace(/<summary>/g, "<b>")
    .replace(/<\/summary>/g, "</b>\n");
}

/** Lossless text-only fallback when private Rich Messages are unavailable. */
export function textOnlyFallbackMessages(post: TelegramPost): string[] {
  let text = "";
  new Parser({
    ontext: (part) => {
      text += part;
    },
  }).end(legacyTextHtml(post));

  const messages: string[] = [];
  let chunk = "";
  // Iterate code points so a message boundary cannot split an emoji surrogate pair.
  for (const character of text) {
    if (chunk.length + character.length > MESSAGE_LIMIT) {
      messages.push(escapeHtml(chunk));
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) messages.push(escapeHtml(chunk));
  return messages;
}

/** Length after entity parsing, used only to choose a lossless legacy fallback. */
export function renderedTextLength(html: string): number {
  let length = 0;
  new Parser({
    ontext: (text) => {
      length += text.length;
    },
  }).end(html);
  return length;
}

/**
 * Render media as a Rich HTML block: a single `<img>`/`<video>` for one item,
 * or a `<tg-slideshow>` carousel for several. Returns `null` when there is no
 * media. Media must live in its own block — never inline with the text.
 */
export function mediaCarouselHtml(media: readonly TweetMedia[]): string | null {
  const elements = media.map(mediaElementHtml).filter((item): item is string => item !== null);
  if (elements.length === 0) return null;
  return elements.length === 1 ? elements[0]! : `<tg-slideshow>${elements.join("")}</tg-slideshow>`;
}

function mediaElementHtml(item: TweetMedia): string | null {
  const safeUrl = safeWebUrl(item.url);
  if (safeUrl === null) return null;
  const src = escapeAttr(safeUrl);
  // Twitter animated GIFs are delivered as MP4s, so they map to <video> too.
  return item.type === "photo" ? `<img src="${src}"/>` : `<video src="${src}"></video>`;
}

// Rich HTML is block-structured and collapses raw newlines like ordinary HTML,
// so the message formatter's line breaks must become explicit <br> tags.
function textToRichHtml(html: string): string {
  return html.replace(/\n/g, "<br>");
}
