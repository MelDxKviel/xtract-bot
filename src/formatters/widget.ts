import { deflateSync } from "node:zlib";
import { Parser } from "htmlparser2";

import { escapeAttr, escapeHtml, safeWebUrl, type TelegramPost } from "@/formatters/telegram";
import type { TweetData, TweetMedia } from "@/providers/base";

// Leave room for differences between Node's zlib and Telegram's build.
export const WIDGET_COMPRESSED_LIMIT = 3900;
export const WIDGET_HTML_LIMIT = 32768;

const STYLE = `body{margin:0;padding:0;font-family:system-ui;color:var(--tg-theme-text-color,#17212b)}
article{position:relative;padding:16px 16px 12px;border-top:3px solid var(--tg-theme-link-color,#2481cc)}
header{display:flex;align-items:center;gap:11px;margin-bottom:16px}
.avatar{width:42px;height:42px;flex-shrink:0;border-radius:50%;object-fit:cover;background:var(--tg-theme-secondary-bg-color,#eef3f7);color:var(--tg-theme-link-color,#2481cc);display:flex;align-items:center;justify-content:center;font-weight:700}
.identity{min-width:0;flex:1}.name{font-size:16px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta,footer{font-size:12px;color:var(--tg-theme-hint-color,#71808e)}
a{color:var(--tg-theme-link-color,#2481cc);text-decoration:none}
.text{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;font-size:15px;line-height:1.5;user-select:text;-webkit-user-select:text}
.frame{height:300px;overflow:hidden}.measure{position:absolute;visibility:hidden;top:0;left:16px;right:16px}
nav{display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:10px}nav[hidden]{display:none}
button{min-width:48px;padding:7px 14px;border:0;border-radius:10px;background:var(--tg-theme-secondary-bg-color,#eef3f7);color:var(--tg-theme-link-color,#2481cc);font-size:16px}button:disabled{opacity:.35}
footer{display:flex;justify-content:space-between;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--tg-theme-section-separator-color,#e4e9ee)}`;

// Measure real wrapped text instead of guessing a character limit: no clipping
// at narrow widths, with emoji, newlines, CJK, or when a message bubble resizes.
// Only measure the current page (at most 13 layout reads per event). Telegram
// stops a widget after 128 blocking layout queries in a single task.
const SCRIPT = `(()=>{const source=document.getElementById('source'),body=document.getElementById('body'),measure=document.getElementById('measure'),nav=document.getElementById('nav'),prev=document.getElementById('prev'),next=document.getElementById('next'),count=document.getElementById('count'),frame=document.getElementById('frame');const chars=Array.from(source.textContent);let offsets=[0],index=0,width=0;function draw(){const start=offsets[index];let lo=0,hi=Math.min(chars.length-start,2400);while(lo<hi){const mid=Math.ceil((lo+hi)/2);measure.textContent=chars.slice(start,start+mid).join('');if(measure.getBoundingClientRect().height<=296)lo=mid;else hi=mid-1}let end=start+Math.max(lo,1);if(end<chars.length){let split=end;while(split>Math.max(start,end-80)&&!/\\s/.test(chars[split-1]))split--;if(split>Math.max(start,end-80))end=split}offsets[index+1]=Math.min(end,chars.length);body.textContent=chars.slice(start,end).join('');measure.textContent='';count.textContent='Страница '+(index+1);prev.disabled=index===0;next.disabled=end>=chars.length;nav.hidden=index===0&&next.disabled;frame.style.height=nav.hidden?'auto':'300px'}function layout(){const w=measure.getBoundingClientRect().width;if(!w||w===width)return;width=w;index=0;offsets=[0];draw()}prev.onclick=()=>{if(index>0){index--;draw()}};next.onclick=()=>{if(!next.disabled){index++;draw()}};layout();if(typeof ResizeObserver!=='undefined')new ResizeObserver(layout).observe(frame);if(window.TelegramWidget){TelegramWidget.onEvent('themeChanged',()=>{width=0;layout()});TelegramWidget.ready()}})();`;

export function widgetText(post: TelegramPost): string {
  let text = "";
  new Parser({
    ontext: (part) => {
      text += part;
    },
    onopentag: (tag) => {
      if (["br", "p", "tr", "blockquote", "details"].includes(tag)) text += "\n";
      if (tag === "td" || tag === "th") text += " ";
    },
    onclosetag: (tag) => {
      if (["p", "tr", "summary", "blockquote"].includes(tag)) text += "\n";
    },
  }).end(post.richHtml);
  return text
    .replace(/\u0000/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fitsWidget(html: string): boolean {
  return (
    !html.includes("\0") &&
    Buffer.byteLength(html) <= WIDGET_HTML_LIMIT &&
    deflateSync(html, { level: 9 }).byteLength <= WIDGET_COMPRESSED_LIMIT
  );
}

/** Returns null rather than dropping any post text to meet Telegram's limits. */
export function buildPostWidget(
  post: TelegramPost,
  tweet: TweetData,
  avatar: string | null = null,
): string | null {
  const name = tweet.authorName.replace(/\0/g, "");
  const fullText = widgetText(post);
  const heading = `𝕏 ${name} (@${tweet.authorUsername})`;
  const text = fullText.startsWith(heading) ? fullText.slice(heading.length).trimStart() : fullText;
  // The client enforces additional text budgets even when the server accepts
  // the compressed HTML. Keep complex scripts below its 8192 UTF-16-unit cap.
  if (text.length > 7600 && /[\u0590-\u0fff\u1780-\u18af\ua800-\uabff]/u.test(text + name))
    return null;
  const initials = Array.from(name.trim()).slice(0, 2).join("").toUpperCase() || "X";
  const authorUrl = widgetLink(tweet.authorUrl);
  const url = widgetLink(tweet.url);
  const date =
    tweet.createdAt?.toLocaleDateString("ru-RU", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: "numeric",
    }) ?? "";
  const count = widgetMediaBatches(post).reduce((sum, batch) => sum + batch.media.length, 0);
  const render = (image: string | null) =>
    `<style>${STYLE}</style><article><header>${image ? `<img class="avatar" src="${escapeAttr(image)}" alt=""/>` : `<div class="avatar">${escapeHtml(initials)}</div>`}<div class="identity"><div class="name">${escapeHtml(name)}</div><div class="meta">${authorUrl ? `<a href="${escapeAttr(authorUrl)}">@${escapeHtml(tweet.authorUsername)}</a>` : `@${escapeHtml(tweet.authorUsername)}`}${date ? ` · ${escapeHtml(date)}` : ""}</div></div><b>𝕏</b></header><div id="source" hidden>${escapeHtml(text)}</div><div id="frame" class="frame"><div id="body" class="text"></div></div><div id="measure" class="text measure"></div><nav id="nav" hidden><button id="prev" aria-label="Предыдущая страница">←</button><span id="count" class="meta"></span><button id="next" aria-label="Следующая страница">→</button></nav><footer><span>${count ? `Вложения ниже · ${count}` : "Xtract"}</span>${url ? `<a href="${escapeAttr(url)}">Открыть в X ↗</a>` : ""}</footer></article><script>${SCRIPT}</script>`;
  // Never accept arbitrary data: markup supplied by a provider.
  if (avatar && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar)) {
    const html = render(avatar);
    if (fitsWidget(html)) return html;
  }
  const html = render(null);
  return fitsWidget(html) ? html : null;
}

function widgetLink(value: string): string | null {
  const safe = safeWebUrl(value);
  if (!safe || safe.length > 256 || !safe.startsWith("https:")) return null;
  const url = new URL(safe);
  return url.username || url.password ? null : safe;
}

/** Preserve every segment and quote attachment, without the flat legacy 10-file cap. */
export function widgetMediaBatches(
  post: TelegramPost,
): Array<{ label: string; media: TweetMedia[] }> {
  const batches: Array<{ label: string; media: TweetMedia[] }> = [];
  const add = (label: string, media: readonly TweetMedia[]) => {
    const safe = media.filter((item) => safeWebUrl(item.url) !== null);
    for (let start = 0; start < safe.length; start += 10)
      batches.push({ label, media: safe.slice(start, start + 10) });
  };
  if (post.segments?.length) {
    post.segments.forEach((segment, index) => {
      add(post.segments!.length > 1 ? `Пост ${index + 1}` : "Вложения", segment.media);
      if (segment.relatedPost) add("Цитата / ответ", segment.relatedPost.media);
    });
  } else add("Вложения", post.media);
  return batches;
}
