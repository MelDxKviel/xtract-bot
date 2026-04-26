from __future__ import annotations

import logging

from aiogram import Bot, Router
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import (
    ChosenInlineResult,
    InlineKeyboardMarkup,
    InlineQuery,
    InlineQueryResultArticle,
    InputMediaAnimation,
    InputMediaPhoto,
    InputMediaVideo,
    InputTextMessageContent,
)

from app.bot.ui import DISABLED_LINK_PREVIEW, original_post_button
from app.providers.base import TweetMedia
from app.services import TweetShareService
from app.utils.urls import extract_first_tweet_url

router = Router(name="inline")
logger = logging.getLogger(__name__)


@router.inline_query()
async def inline_query(query: InlineQuery) -> None:
    parsed = extract_first_tweet_url(query.query or "")
    if parsed is None:
        await query.answer(
            [
                InlineQueryResultArticle(
                    id="invalid-link",
                    title="🔗 Нужна ссылка на пост X/Twitter",
                    description="Например: https://x.com/user/status/123",
                    input_message_content=InputTextMessageContent(
                        message_text="🔗 Пришлите ссылку на пост X/Twitter.",
                        link_preview_options=DISABLED_LINK_PREVIEW,
                    ),
                )
            ],
            cache_time=1,
            is_personal=True,
        )
        return

    await query.answer(
        [
            InlineQueryResultArticle(
                id=f"tweet-{parsed.tweet_id}",
                title="📤 Поделиться постом",
                description=parsed.normalized_url,
                input_message_content=InputTextMessageContent(
                    message_text="⏳ Загрузка поста...",
                    parse_mode=ParseMode.HTML,
                    link_preview_options=DISABLED_LINK_PREVIEW,
                ),
                reply_markup=original_post_button(parsed.normalized_url),
            )
        ],
        cache_time=1,
        is_personal=True,
    )


@router.chosen_inline_result()
async def chosen_inline_result(
    result: ChosenInlineResult,
    bot: Bot,
    tweet_share_service: TweetShareService,
) -> None:
    if not result.inline_message_id:
        return

    parsed = extract_first_tweet_url(result.query or "")
    if parsed is None:
        await _safe_edit(
            bot,
            result.inline_message_id,
            "⚠️ Не удалось распознать ссылку на пост X/Twitter.",
        )
        return

    share = await tweet_share_service.process_url(
        parsed,
        telegram_user_id=result.from_user.id,
        chat_id=None,
        mode="inline",
    )
    if not share.ok or share.post is None:
        await _safe_edit(
            bot,
            result.inline_message_id,
            "⚠️ Не удалось получить пост. Возможно, он удален, приватный или временно недоступен.",
            reply_markup=original_post_button(parsed.normalized_url),
        )
        return

    original_url = share.tweet.url if share.tweet is not None else parsed.normalized_url
    button = original_post_button(original_url)
    if share.post.media:
        media = list(share.post.media)
        caption = share.post.caption_html
        if len(media) >= 2:
            await _try_send_album_private(
                bot, result.from_user.id, media, caption=caption, reply_markup=button
            )
        await _safe_edit_media(
            bot,
            result.inline_message_id,
            media[0],
            caption=caption,
            reply_markup=button,
        )
        return

    await _safe_edit(bot, result.inline_message_id, share.post.html, reply_markup=button)


async def _try_send_album_private(
    bot: Bot,
    user_id: int,
    media: list[TweetMedia],
    *,
    caption: str,
    reply_markup: InlineKeyboardMarkup,
) -> None:
    group = [
        _input_group_media(item, caption if index == 0 else None)
        for index, item in enumerate(media)
    ]
    try:
        await bot.send_media_group(chat_id=user_id, media=group)
    except (TelegramBadRequest, TelegramForbiddenError):
        logger.exception("failed to send album to private chat for user %d", user_id)


def _input_group_media(item: TweetMedia, caption: str | None):
    parse_mode = ParseMode.HTML if caption else None
    if item.type == "photo":
        return InputMediaPhoto(media=item.url, caption=caption, parse_mode=parse_mode)
    if item.type == "video":
        return InputMediaVideo(
            media=item.url,
            caption=caption,
            parse_mode=parse_mode,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
        )
    return InputMediaAnimation(
        media=item.url,
        caption=caption,
        parse_mode=parse_mode,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


async def _safe_edit(
    bot: Bot,
    inline_message_id: str,
    text: str,
    *,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    try:
        await bot.edit_message_text(
            inline_message_id=inline_message_id,
            text=text,
            parse_mode=ParseMode.HTML,
            link_preview_options=DISABLED_LINK_PREVIEW,
            reply_markup=reply_markup,
        )
    except TelegramBadRequest:
        logger.exception("failed to edit inline message")


async def _safe_edit_media(
    bot: Bot,
    inline_message_id: str,
    item: TweetMedia,
    *,
    caption: str,
    reply_markup: InlineKeyboardMarkup,
) -> None:
    try:
        await bot.edit_message_media(
            inline_message_id=inline_message_id,
            media=_input_media(item, caption),
            reply_markup=reply_markup,
        )
        return
    except TelegramBadRequest:
        logger.exception("failed to edit inline media")
    if item.preview_url:
        try:
            await bot.edit_message_media(
                inline_message_id=inline_message_id,
                media=InputMediaPhoto(
                    media=item.preview_url,
                    caption=caption,
                    parse_mode=ParseMode.HTML,
                ),
                reply_markup=reply_markup,
            )
            return
        except TelegramBadRequest:
            logger.exception("failed to edit inline media preview")
    await _safe_edit(bot, inline_message_id, caption, reply_markup=reply_markup)


def _input_media(item: TweetMedia, caption: str):
    if item.type == "photo":
        return InputMediaPhoto(
            media=item.url,
            caption=caption,
            parse_mode=ParseMode.HTML,
        )
    if item.type == "video":
        return InputMediaVideo(
            media=item.url,
            caption=caption,
            parse_mode=ParseMode.HTML,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
        )
    return InputMediaAnimation(
        media=item.url,
        caption=caption,
        parse_mode=ParseMode.HTML,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


def _duration_seconds(duration_ms: int | None) -> int | None:
    if duration_ms is None:
        return None
    return max(1, round(duration_ms / 1000))
