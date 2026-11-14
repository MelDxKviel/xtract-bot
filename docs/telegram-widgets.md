# Experimental Telegram post cards

**Availability correction — November 14, 2026:** Telegram has disabled widgets for
general bots even in private chats. A Telegram maintainer confirmed this on
[November 13 in telegram-bot-api issue #947](https://github.com/tdlib/telegram-bot-api/issues/947).
The guide below still describes the intended API; it is not proof of production
availability. A real request from `@twxtract_test_bot` returned
`400 INPUT_MEDIA_WIDGET_NOT_ALLOWED` on November 14. The bot explicitly explains
this restriction before using an ordinary post, and backs off widget requests
for 15 minutes. PR Deploy performs a real delivery check and reports a blocked
feature separately from a running bot. It does not report accepted widget
delivery based on the existence of the API method or mocked tests.

Telegram introduced HTML Widgets in Bot API 10.4 on November 9, 2026:

- [Widget guide and supported HTML/CSS/JavaScript](https://core.telegram.org/bots/widgets)
- [sendWidget](https://core.telegram.org/bots/api#sendwidget)
- [Bot API changelog](https://core.telegram.org/bots/api-changelog)

Production Telegram currently allows widgets only in private bot chats. They have
protected content and cannot be forwarded or copied. Inline mode, groups and
forwarding widgets are available only on Telegram's separate test server. The PR
bot uses the normal production API, so inline sharing keeps its existing format.

## Behavior

Set `POST_WIDGETS_ENABLED=true` to turn private post replies into themed cards.
It defaults to `false`; PR Deploy enables it for the test bot. Profiles keep their
existing Rich Message layout. `/text` cards omit all media, including quote media.

Cards show the author's name, handle, optional avatar, date, full post text,
thread/context text and poll results. Long text has previous/next page buttons.
Pagination measures one page at a time, staying below Telegram's 128 layout reads
per task. There is no internal scrolling; each card remains below the 600 px
height limit. The ordinary-post button produces the previous forwardable format
and passes through the same access checks and rate limiter as other shares.

Widgets have no network, video, audio, external image or stylesheet support.
Photos, videos and MP4 GIFs are sent **after** the card as native attachments.
Thread and quote attachments keep their order, in batches of at most 10. If an
album fails, files are attempted separately. A rejected video URL is retried as a
binary upload; it is never replaced with a still thumbnail. Missing attachments
are reported with a link to the original.

Avatar metadata is retained in the existing JSON cache without a schema change.
Old cache entries without an avatar still work. Only HTTPS avatars under
`pbs.twimg.com/profile_images/` are fetched, without redirects, with a 2-second
timeout and 3072-byte streaming limit. The tiny `_mini` variant is requested when
available. Raster signatures are checked before making a data URL. Images that
do not fit are replaced with initials.

Every card is checked against 32768 UTF-8 bytes and a conservative 3900-byte zlib
level-9 budget (Telegram allows 4096 bytes, but zlib implementations can differ).
The formatter never clips post text to meet those limits. If text cannot fit, or
Telegram rejects `sendWidget`, the complete existing Rich Message path is used.
Older clients display the widget caption and can request an ordinary post using
its inline keyboard. Links inside the text are displayed as text; the author,
original-post links and ordinary-post keyboard remain clickable.

## Validation and local preview

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run scripts/preview-widgets.ts
```

The last command writes ignored browser previews under `output/playwright/`.
Optionally set `WIDGET_PREVIEW_AVATAR_URL` to a CDN avatar URL. The surrounding
browser palette in `preview.html` is for QA only and is never sent to Telegram.
Test at widths 200, 320, 430 and 600 px, in light and dark themes, then page to the
end of the text. Browser rendering verifies layout and navigation; Telegram's
client renderer still needs an actual client check against the deployed PR bot.

The automated suite covers size limits, escaping, cache compatibility, avatar
validation, fallback, `/text`, ordinary-post requests, individual media types,
mixed albums, thread/quote media, more than ten files and video upload retry.
