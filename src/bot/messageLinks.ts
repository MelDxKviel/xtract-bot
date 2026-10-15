import type { Message } from "grammy/types";

import { parseProfileUrl, parseTweetUrl } from "@/utils/urls";

/** Text used for link discovery by both the private handler and rate limiter. */
export function messageShareText(
  message: Pick<Message, "text" | "caption" | "entities" | "caption_entities">,
): string {
  const text = message.text ?? message.caption ?? "";
  const entities = message.text !== undefined ? message.entities : message.caption_entities;
  const links = (entities ?? [])
    .filter((entity) => entity.type === "text_link")
    .sort((a, b) => a.offset - b.offset);
  const parts: string[] = [];
  let cursor = 0;

  for (const link of links) {
    const end = link.offset + link.length;
    if (
      !Number.isInteger(link.offset) ||
      !Number.isInteger(link.length) ||
      link.offset < cursor ||
      link.length <= 0 ||
      end > text.length
    ) {
      continue;
    }

    // Telegram offsets and JS string slicing both use UTF-16 code units.
    // A hidden link's target is authoritative; never fetch its visible label.
    // Parse the whole target so an unrelated URL containing x.com is rejected.
    const parsed = parseTweetUrl(link.url) ?? parseProfileUrl(link.url);
    parts.push(text.slice(cursor, link.offset), "\n", parsed?.normalizedUrl ?? "", "\n");
    cursor = end;
  }

  parts.push(text.slice(cursor));
  return parts.join("");
}
