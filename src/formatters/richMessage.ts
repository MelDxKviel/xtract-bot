import type { InputRichMessage } from "grammy/types";

import { escapeAttr, type TelegramPost } from "@/formatters/telegram";
import type { TweetMedia } from "@/providers/base";

/**
 * Build a Bot API Rich Message from an already-formatted post.
 *
 * The tweet text is rendered as the message body and every media item is
 * attached as a swipeable carousel (`<tg-slideshow>`), so a post with several
 * photos/videos is shown in a single message instead of just the first one.
 */
export function buildRichMessage(post: TelegramPost): InputRichMessage {
  const text = textToRichHtml(post.html);
  const carousel = mediaCarouselHtml(post.media);
  return { html: carousel ? `${text}\n${carousel}` : text };
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
