import type { InputRichMessage } from "grammy/types";

import {
  escapeAttr,
  pluralPosts,
  RICH_MESSAGE_LIMIT,
  type TelegramPost,
} from "@/formatters/telegram";
import type { TweetMedia } from "@/providers/base";

// Telegram caps a Rich Message at 50 media attachments in total.
const RICH_MEDIA_LIMIT = 50;

/**
 * Build a Bot API Rich Message from an already-formatted post.
 *
 * For a single tweet the body is the tweet text followed by one media carousel.
 * For an unrolled thread (`post.segments`), each post's text is followed by its
 * own media and the posts are chained with `<hr/>` dividers — no numbering, and
 * the long-message limit (not the 4096 plain limit) is used so nothing is cut.
 */
export function buildRichMessage(post: TelegramPost): InputRichMessage {
  if (post.segments && post.segments.length > 0) {
    return buildThreadRichMessage(post);
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

/**
 * Prepend a custom-emoji avatar to a Rich Message body. The `<tg-emoji>` tag
 * wraps a plain fallback glyph shown wherever the custom emoji can't render
 * (non-premium forwards, system notifications). Telegram only delivers the
 * custom emoji when the bot is eligible (owner has Premium, or a Fragment
 * username), so callers should retry without it if the send is rejected.
 */
export function withAvatarEmoji(
  rich: InputRichMessage,
  customEmojiId: string,
  fallbackGlyph: string,
): InputRichMessage {
  if (!("html" in rich) || typeof rich.html !== "string") return rich;
  const emoji = `<tg-emoji emoji-id="${escapeAttr(customEmojiId)}">${fallbackGlyph}</tg-emoji> `;
  return { ...rich, html: `${emoji}${rich.html}` };
}

function buildThreadRichMessage(post: TelegramPost): InputRichMessage {
  const segments = post.segments ?? [];
  const blocks: string[] = [];
  let used = 0;

  if (post.threadHeaderHtml) {
    const header = textToRichHtml(post.threadHeaderHtml);
    blocks.push(header);
    used += header.length;
  }

  let mediaBudget = RICH_MEDIA_LIMIT;
  let included = 0;
  for (const segment of segments) {
    const body = segment.html ? textToRichHtml(segment.html) : "";
    const allowed = segment.media.slice(0, Math.max(0, mediaBudget));
    const carousel = mediaCarouselHtml(allowed);
    const block = carousel ? (body ? `${body}\n${carousel}` : carousel) : body;

    // Keep the whole message under the rich-text limit; always include the
    // first post, then stop before overflowing rather than truncating mid-post.
    const projected = used + block.length + "<hr/>".length;
    if (included > 0 && projected > RICH_MESSAGE_LIMIT) break;

    blocks.push(block);
    mediaBudget -= allowed.length;
    used = projected;
    included += 1;
  }

  if (included < segments.length) {
    const rest = segments.length - included;
    blocks.push(`<i>… ещё ${rest} ${pluralPosts(rest)} — откройте оригинал</i>`);
  }

  return { html: blocks.join("<hr/>"), skip_entity_detection: true };
}

/**
 * Render media as a Rich HTML block: a single `<img>`/`<video>` for one item,
 * or a `<tg-slideshow>` carousel for several. Returns `null` when there is no
 * media. Media must live in its own block — never inline with the text.
 */
export function mediaCarouselHtml(media: readonly TweetMedia[]): string | null {
  if (media.length === 0) return null;
  const elements = media.map(mediaElementHtml).join("");
  return media.length === 1 ? elements : `<tg-slideshow>${elements}</tg-slideshow>`;
}

function mediaElementHtml(item: TweetMedia): string {
  const src = escapeAttr(item.url);
  // Twitter animated GIFs are delivered as MP4s, so they map to <video> too.
  return item.type === "photo" ? `<img src="${src}"/>` : `<video src="${src}"></video>`;
}

// Rich HTML is block-structured and collapses raw newlines like ordinary HTML,
// so the message formatter's line breaks must become explicit <br> tags.
function textToRichHtml(html: string): string {
  return html.replace(/\n/g, "<br>");
}
