from __future__ import annotations

from aiogram import F, Router
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import InputMediaPhoto, InputMediaVideo, Message

from app.bot.ui import DISABLED_LINK_PREVIEW, append_original_link
from app.formatters.telegram import CAPTION_LIMIT, MESSAGE_LIMIT
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
    original_url = _result_original_url(result)
    caption = append_original_link(post.caption_html, original_url, limit=CAPTION_LIMIT)
    text = append_original_link(post.html, original_url, limit=MESSAGE_LIMIT)

    if post.media:
        await _send_media(message, list(post.media), caption=caption, fallback_text=text)
        return

    await message.answer(
        text,
        parse_mode=ParseMode.HTML,
        link_preview_options=DISABLED_LINK_PREVIEW,
    )


async def _send_media(
    message: Message,
    media: list[TweetMedia],
    *,
    caption: str,
    fallback_text: str,
) -> None:
    try:
        if len(media) == 1:
            await _send_single_media(message, media[0], caption=caption)
            return
        await message.answer_media_group(
            [
                _input_group_media(item, caption if index == 0 else None)
                for index, item in enumerate(media)
            ]
        )
    except TelegramBadRequest:
        await _send_media_fallback(message, media, caption=caption, fallback_text=fallback_text)


async def _send_single_media(
    message: Message,
    item: TweetMedia,
    *,
    caption: str | None,
) -> None:
    parse_mode = ParseMode.HTML if caption else None
    show_above = True if caption else None
    if item.type == "photo":
        await message.answer_photo(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            show_caption_above_media=show_above,
        )
    elif item.type == "gif":
        await message.answer_animation(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            show_caption_above_media=show_above,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
        )
    else:
        await message.answer_video(
            item.url,
            caption=caption,
            parse_mode=parse_mode,
            show_caption_above_media=show_above,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
        )


async def _send_media_fallback(
    message: Message,
    media: list[TweetMedia],
    *,
    caption: str,
    fallback_text: str,
) -> None:
    sent_caption = False
    for item in media:
        item_caption = caption if not sent_caption else None
        try:
            await _send_single_media(message, item, caption=item_caption)
            if item_caption:
                sent_caption = True
            continue
        except TelegramBadRequest:
            pass
        if item.preview_url:
            try:
                await message.answer_photo(
                    item.preview_url,
                    caption=item_caption,
                    parse_mode=ParseMode.HTML if item_caption else None,
                    show_caption_above_media=True if item_caption else None,
                )
                if item_caption:
                    sent_caption = True
                continue
            except TelegramBadRequest:
                pass
    if not sent_caption:
        await message.answer(
            fallback_text,
            parse_mode=ParseMode.HTML,
            link_preview_options=DISABLED_LINK_PREVIEW,
        )


def _input_group_media(item: TweetMedia, caption: str | None):
    parse_mode = ParseMode.HTML if caption else None
    show_above = True if caption else None
    if item.type == "photo":
        return InputMediaPhoto(
            media=item.url,
            caption=caption,
            parse_mode=parse_mode,
            show_caption_above_media=show_above,
        )
    return InputMediaVideo(
        media=item.url,
        caption=caption,
        parse_mode=parse_mode,
        show_caption_above_media=show_above,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


def _duration_seconds(duration_ms: int | None) -> int | None:
    if duration_ms is None:
        return None
    return max(1, round(duration_ms / 1000))


def _result_original_url(result: ShareResult) -> str:
    if result.tweet is not None:
        return result.tweet.url
    return result.normalized_url or result.source_url or "https://x.com"
