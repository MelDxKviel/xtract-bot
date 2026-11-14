import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { formatTweet } from "../src/formatters/telegram";
import { buildPostWidget } from "../src/formatters/widget";
import { makeMedia, makeTweet } from "../src/providers/base";
import { loadWidgetAvatar } from "../src/services/widgetAvatar";

const tweet = makeTweet({
  tweetId: "123",
  url: "https://x.com/xtract/status/123",
  authorName: "Александр Волков",
  authorUsername: "xtract",
  authorUrl: "https://x.com/xtract",
  createdAt: new Date("2026-11-14T09:00:00Z"),
  text:
    "Маленькие детали меняют всё. ✨\n\nСегодня пробуем новый способ делиться постами: аккуратная карточка, живые цвета вашей темы и все вложения в исходном качестве.\n\nФото, видео и GIF остаются настоящими файлами Telegram — их удобно открыть, сохранить и отправить друзьям.\n\n" +
    "Длинный текст тоже на месте. Листайте страницы стрелками: ни одно слово не теряется, а карточка остаётся компактной. 🐦\n\n".repeat(
      12,
    ) +
    "КОНЕЦ ПОСТА — всё на месте!",
  media: [
    makeMedia({ type: "photo", url: "https://pbs.twimg.com/demo.jpg" }),
    makeMedia({ type: "video", url: "https://video.twimg.com/demo.mp4" }),
  ],
  quotedTweet: makeTweet({
    tweetId: "122",
    url: "https://x.com/anna/status/122",
    authorName: "Анна",
    authorUsername: "anna",
    authorUrl: "https://x.com/anna",
    text: "Красивое оформление начинается с читабельности.",
  }),
  poll: {
    options: [
      { label: "Карточка с аватаркой", votes: 84 },
      { label: "Обычный пост", votes: 16 },
    ],
    totalVotes: 100,
    closed: true,
  },
});

const avatar = await loadWidgetAvatar(process.env["WIDGET_PREVIEW_AVATAR_URL"]);
const html = buildPostWidget(formatTweet(tweet), tweet, avatar);
if (!html) throw new Error("Preview exceeds Telegram widget limits");
await mkdir("output/playwright", { recursive: true });
await writeFile("output/playwright/widget.html", html);
// Browser-only stand-in: never sent to Telegram.
await writeFile(
  "output/playwright/preview.html",
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:#dce6dc;--tg-theme-text-color:#17212b;--tg-theme-hint-color:#71808e;--tg-theme-link-color:#2481cc;--tg-theme-secondary-bg-color:#eef3f7;--tg-theme-section-separator-color:#e4e9ee}html.dark{background:#0e1621;--tg-theme-text-color:#f5f5f5;--tg-theme-hint-color:#8b9bab;--tg-theme-link-color:#6ab3f3;--tg-theme-secondary-bg-color:#233344;--tg-theme-section-separator-color:#304254}body{max-width:420px;margin:20px auto!important;background:white;border-radius:16px;overflow:hidden}.dark body{background:#182533}*{box-sizing:border-box}button{cursor:pointer}</style></head><body>${html}</body></html>`,
);
console.log(
  JSON.stringify({
    htmlBytes: Buffer.byteLength(html),
    compressedBytes: deflateSync(html, { level: 9 }).length,
    avatar: Boolean(avatar),
    preview: "output/playwright/preview.html",
  }),
);
