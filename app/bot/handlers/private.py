from __future__ import annotations

from html import escape

from aiogram import F, Router
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import InputMediaPhoto, InputMediaVideo, Message

from app.bot.ui import DISABLED_LINK_PREVIEW, original_post_button
from app.formatters.telegram import CAPTION_LIMIT
from app.providers.base import TweetMedia
from app.services import AccessService, ShareResult, TweetShareService
from app.utils.urls import extract_first_tweet_url

router = Router(name="private")
router.message.filter(F.chat.type == ChatType.PRIVATE)

INVALID_LINK_TEXT = "Пришлите ссылку на пост X/Twitter, например https://x.com/user/status/123"
FETCH_ERROR_TEXT = (
    "Не удалось получить пост. Возможно, он удален, приватный или временно недоступен."
)


@router.message(Command("start"))
async def start(message: Message, access_service: AccessService) -> None:
    assert message.from_user is not None
    has_access = await access_service.has_access(message.from_user.id)
    status = "доступ открыт" if has_access else "доступ закрыт"
    await message.answer(
        "Xtract Bot помогает красиво пересылать посты X/Twitter в Telegram.\n\n"
        f"Ваш Telegram ID: <code>{message.from_user.id}</code>\n"
        f"Статус: {status}\n\n"
        "Отправьте ссылку на пост после получения доступа.",
        parse_mode=ParseMode.HTML,
        link_preview_options=DISABLED_LINK_PREVIEW,
    )


@router.message(Command("help"))
async def help_command(message: Message) -> None:
    await message.answer(
        "Отправьте ссылку на пост X/Twitter в личный чат с ботом.\n"
        "Поддерживаются x.com, twitter.com, mobile.twitter.com и vxtwitter.com.\n\n"
        "Inline режим: введите @bot_username <ссылка> в любом чате.\n"
        "Команда /id покажет ваш Telegram ID."
    )


@router.message(Command("id"))
async def id_command(message: Message) -> None:
    assert message.from_user is not None
    await message.answer(
        f"Ваш Telegram ID: <code>{message.from_user.id}</code>", parse_mode=ParseMode.HTML
    )


@router.message(F.text)
async def handle_text(message: Message, tweet_share_service: TweetShareService) -> None:
    assert message.from_user is not None
    text = message.text or ""
    if text.startswith("/"):
        await message.answer("Неизвестная команда. Используйте /help.")
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
    reply_markup = original_post_button(original_url)
    groupable_media = [item for item in post.media if item.type in {"photo", "video"}]
    animation_media = [item for item in post.media if item.type == "gif"]

    try:
        if groupable_media:
            await _send_groupable_media(
                message,
                groupable_media,
                post.caption_html,
                reply_markup=reply_markup,
                original_url=original_url,
            )
            for item in animation_media:
                await _send_single_media(message, item, original_url=original_url)
            return

        if animation_media:
            first, *rest = animation_media
            await _send_single_media(
                message,
                first,
                caption=post.caption_html,
                reply_markup=reply_markup,
                original_url=original_url,
            )
            for item in rest:
                await _send_single_media(message, item, original_url=original_url)
            return

        await message.answer(
            post.html,
            parse_mode=ParseMode.HTML,
            reply_markup=reply_markup,
            link_preview_options=DISABLED_LINK_PREVIEW,
        )
    except TelegramBadRequest:
        await message.answer(
            post.html,
            parse_mode=ParseMode.HTML,
            reply_markup=reply_markup,
            link_preview_options=DISABLED_LINK_PREVIEW,
        )


async def _send_groupable_media(
    message: Message,
    media: list[TweetMedia],
    caption: str,
    *,
    reply_markup,
    original_url: str,
) -> None:
    if len(media) == 1:
        await _send_single_groupable_media(
            message,
            media[0],
            caption=caption,
            reply_markup=reply_markup,
            original_url=original_url,
        )
        return

    album_caption = _caption_with_original_link(caption, original_url)
    media_group = [
        _input_group_media(item, album_caption if index == 0 else None)
        for index, item in enumerate(media)
    ]
    try:
        await message.answer_media_group(media_group)
    except TelegramBadRequest:
        for index, item in enumerate(media):
            await _send_single_groupable_media(
                message,
                item,
                caption=caption if index == 0 else None,
                reply_markup=reply_markup if index == 0 else None,
                original_url=original_url,
            )
        return


async def _send_single_groupable_media(
    message: Message,
    item: TweetMedia,
    caption: str | None,
    *,
    reply_markup=None,
    original_url: str,
) -> None:
    try:
        if item.type == "photo":
            await message.answer_photo(
                item.url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=reply_markup,
                show_caption_above_media=True,
            )
        else:
            await message.answer_video(
                item.url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=reply_markup,
                show_caption_above_media=True,
                width=item.width,
                height=item.height,
                duration=_duration_seconds(item.duration_ms),
            )
    except TelegramBadRequest:
        if item.preview_url:
            await message.answer_photo(
                item.preview_url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=reply_markup,
                show_caption_above_media=True,
            )
            return
        await _send_media_error(message, original_url)


async def _send_single_media(
    message: Message,
    item: TweetMedia,
    caption: str | None = None,
    *,
    reply_markup=None,
    original_url: str,
) -> None:
    try:
        if item.type == "gif":
            await message.answer_animation(
                item.url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=reply_markup,
                show_caption_above_media=True,
            )
    except TelegramBadRequest:
        if item.preview_url:
            await message.answer_photo(
                item.preview_url,
                caption=caption,
                parse_mode=ParseMode.HTML,
                reply_markup=reply_markup,
                show_caption_above_media=True,
            )
            return
        await _send_media_error(message, original_url)


def _input_group_media(item: TweetMedia, caption: str | None):
    if item.type == "photo":
        return InputMediaPhoto(
            media=item.url,
            caption=caption,
            parse_mode=ParseMode.HTML if caption else None,
            show_caption_above_media=True if caption else None,
        )
    return InputMediaVideo(
        media=item.url,
        caption=caption,
        parse_mode=ParseMode.HTML if caption else None,
        show_caption_above_media=True if caption else None,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


async def _send_media_error(message: Message, original_url: str) -> None:
    await message.answer(
        "Telegram не смог отправить медиа из поста.",
        reply_markup=original_post_button(original_url),
        link_preview_options=DISABLED_LINK_PREVIEW,
    )


def _duration_seconds(duration_ms: int | None) -> int | None:
    if duration_ms is None:
        return None
    return max(1, round(duration_ms / 1000))


def _caption_with_original_link(caption: str, original_url: str) -> str:
    link = f'\n\n<a href="{escape(original_url, quote=True)}">Оригинальный пост</a>'
    if len(caption) + len(link) <= CAPTION_LIMIT:
        return caption + link
    return caption


def _result_original_url(result: ShareResult) -> str:
    if result.tweet is not None:
        return result.tweet.url
    return result.normalized_url or result.source_url or "https://x.com"
