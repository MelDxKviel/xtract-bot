from __future__ import annotations

from aiogram import F, Router
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import InlineKeyboardMarkup, InputMediaPhoto, InputMediaVideo, Message

from app.bot.ui import DISABLED_LINK_PREVIEW, original_post_button
from app.providers.base import TweetMedia
from app.services import AccessService, ShareResult, TweetShareService
from app.utils.urls import extract_first_tweet_url

router = Router(name="private")
router.message.filter(F.chat.type == ChatType.PRIVATE)

INVALID_LINK_TEXT = "🔗 Пришлите ссылку на пост X/Twitter, например https://x.com/user/status/123"
FETCH_ERROR_TEXT = (
    "⚠️ Не удалось получить пост. Возможно, он удален, приватный или временно недоступен."
)


@router.message(Command("start"))
async def start(message: Message, access_service: AccessService) -> None:
    assert message.from_user is not None
    has_access = await access_service.has_access(message.from_user.id)
    status = "🟢 доступ открыт" if has_access else "🔒 доступ закрыт"
    await message.answer(
        "👋 <b>Xtract Bot</b> помогает красиво пересылать посты X/Twitter в Telegram.\n\n"
        f"🆔 Ваш Telegram ID: <code>{message.from_user.id}</code>\n"
        f"📌 Статус: {status}\n\n"
        "📨 Отправьте ссылку на пост после получения доступа.",
        parse_mode=ParseMode.HTML,
        link_preview_options=DISABLED_LINK_PREVIEW,
    )


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer(
        "📖 <b>Как пользоваться ботом</b>\n\n"
        "📨 Отправьте ссылку на пост X/Twitter в личный чат с ботом.\n"
        "✅ Поддерживаются: x.com, twitter.com, mobile.twitter.com, vxtwitter.com.\n\n"
        "🔍 <b>Inline режим:</b> введите "
        "<code>@bot_username &lt;ссылка&gt;</code> в любом чате.\n\n"
        "🆔 /id — покажет ваш Telegram ID.",
        parse_mode=ParseMode.HTML,
        link_preview_options=DISABLED_LINK_PREVIEW,
    )


@router.message(Command("id"))
async def id_command(message: Message) -> None:
    assert message.from_user is not None
    await message.answer(
        f"🆔 Ваш Telegram ID: <code>{message.from_user.id}</code>", parse_mode=ParseMode.HTML
    )


@router.message(F.text)
async def handle_text(message: Message, tweet_share_service: TweetShareService) -> None:
    assert message.from_user is not None
    text = message.text or ""
    if text.startswith("/"):
        await message.answer("❓ Неизвестная команда. Используйте /help.")
        return
    if extract_first_tweet_url(text) is None:
        await message.answer(INVALID_LINK_TEXT, link_preview_options=DISABLED_LINK_PREVIEW)
        return

    result = await tweet_share_service.process_text(
        text,
        telegram_user_id=message.from_user.id,
        chat_id=message.chat.id,
        mode="private",
    )
    await _send_share_result(message, result)


async def _send_share_result(message: Message, result: ShareResult) -> None:
    if result.status == "invalid_url":
        await message.answer(INVALID_LINK_TEXT, link_preview_options=DISABLED_LINK_PREVIEW)
        return
    if not result.ok or result.post is None:
        await message.answer(FETCH_ERROR_TEXT)
        return

    post = result.post
    url = result.tweet.url if result.tweet is not None else (result.normalized_url or "")
    button = original_post_button(url)
    caption_group = f"{post.caption_html}\n\n{post.link_html}"

    if post.media:
        await _send_media(
            message,
            list(post.media),
            caption=post.caption_html,
            caption_group=caption_group,
            fallback_text=post.html,
            reply_markup=button,
        )
        return

    await message.answer(
        post.html,
        parse_mode=ParseMode.HTML,
        link_preview_options=DISABLED_LINK_PREVIEW,
        reply_markup=button,
    )


async def _send_media(
    message: Message,
    media: list[TweetMedia],
    *,
    caption: str,
    caption_group: str,
    fallback_text: str,
    reply_markup: InlineKeyboardMarkup,
) -> None:
    if len(media) >= 2:
        try:
            await message.answer_media_group(
                [
                    _input_group_media(item, caption_group if index == 0 else None)
                    for index, item in enumerate(media)
                ]
            )
            return
        except TelegramBadRequest:
            pass

        preview_group = _preview_input_group(media, caption_group)
        if preview_group is not None:
            try:
                await message.answer_media_group(preview_group)
                return
            except TelegramBadRequest:
                pass

    sent_caption = False
    any_sent = False
    for item in media:
        item_caption = caption if not sent_caption else None
        item_markup = reply_markup if not sent_caption else None
        if await _try_send_one(message, item, caption=item_caption, reply_markup=item_markup):
            any_sent = True
            if item_caption is not None:
                sent_caption = True

    if not any_sent or not sent_caption:
        await message.answer(
            fallback_text,
            parse_mode=ParseMode.HTML,
            link_preview_options=DISABLED_LINK_PREVIEW,
            reply_markup=reply_markup,
        )


async def _try_send_one(
    message: Message,
    item: TweetMedia,
    *,
    caption: str | None,
    reply_markup: InlineKeyboardMarkup | None,
) -> bool:
    try:
        await _send_single_media(message, item, caption=caption, reply_markup=reply_markup)
        return True
    except TelegramBadRequest:
        pass
    if item.preview_url:
        try:
            await message.answer_photo(
                item.preview_url,
                caption=caption,
                parse_mode=ParseMode.HTML if caption else None,
                reply_markup=reply_markup,
            )
            return True
        except TelegramBadRequest:
            pass
    return False


async def _send_single_media(
    message: Message,
    item: TweetMedia,
    *,
    caption: str | None,
    reply_markup: InlineKeyboardMarkup | None,
) -> None:
    parse_mode = ParseMode.HTML if caption else None
    if item.type == "photo":
        await message.answer_photo(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            reply_markup=reply_markup,
        )
    elif item.type == "gif":
        await message.answer_animation(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
            reply_markup=reply_markup,
        )
    else:
        await message.answer_video(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
            reply_markup=reply_markup,
        )


def _input_group_media(item: TweetMedia, caption: str | None):
    parse_mode = ParseMode.HTML if caption else None
    if item.type == "photo":
        return InputMediaPhoto(
            media=item.url,
            caption=caption,
            parse_mode=parse_mode,
        )
    return InputMediaVideo(
        media=item.url,
        caption=caption,
        parse_mode=parse_mode,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


def _preview_input_group(media: list[TweetMedia], caption: str) -> list[InputMediaPhoto] | None:
    items: list[InputMediaPhoto] = []
    for item in media:
        if item.type == "photo":
            url = item.preview_url or item.url
        elif item.preview_url:
            url = item.preview_url
        else:
            return None
        is_first = not items
        items.append(
            InputMediaPhoto(
                media=url,
                caption=caption if is_first else None,
                parse_mode=ParseMode.HTML if is_first else None,
            )
        )
    return items if len(items) >= 2 else None


def _duration_seconds(duration_ms: int | None) -> int | None:
    if duration_ms is None:
        return None
    return max(1, round(duration_ms / 1000))
