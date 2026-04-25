from __future__ import annotations

from aiogram import F, Router
from aiogram.enums import ChatType, ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.types import InputMediaPhoto, Message

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
        await message.answer(INVALID_LINK_TEXT)
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
        await message.answer(INVALID_LINK_TEXT)
        return
    if not result.ok or result.post is None:
        await message.answer(FETCH_ERROR_TEXT)
        return

    post = result.post
    photos = [item for item in post.media if item.type == "photo"]
    other_media = [item for item in post.media if item.type != "photo"]

    try:
        if photos:
            await _send_photos(message, photos, post.caption_html)
            for item in other_media:
                await _send_single_media(message, item)
            return

        if other_media:
            first, *rest = other_media
            await _send_single_media(message, first, caption=post.caption_html)
            for item in rest:
                await _send_single_media(message, item)
            return

        await message.answer(post.html, parse_mode=ParseMode.HTML)
    except TelegramBadRequest:
        await message.answer(post.html, parse_mode=ParseMode.HTML)


async def _send_photos(message: Message, photos: list[TweetMedia], caption: str) -> None:
    if len(photos) == 1:
        await message.answer_photo(photos[0].url, caption=caption, parse_mode=ParseMode.HTML)
        return

    media_group = []
    for index, item in enumerate(photos):
        media_group.append(
            InputMediaPhoto(
                media=item.url,
                caption=caption if index == 0 else None,
                parse_mode=ParseMode.HTML if index == 0 else None,
            )
        )
    await message.answer_media_group(media_group)


async def _send_single_media(
    message: Message, item: TweetMedia, caption: str | None = None
) -> None:
    try:
        if item.type == "video":
            await message.answer_video(item.url, caption=caption, parse_mode=ParseMode.HTML)
        elif item.type == "gif":
            await message.answer_animation(item.url, caption=caption, parse_mode=ParseMode.HTML)
    except TelegramBadRequest:
        await message.answer(f"Медиа: {item.url}")
