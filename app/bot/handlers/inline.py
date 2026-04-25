from __future__ import annotations

import logging
from html import escape

from aiogram import Bot, Router
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import (
    ChosenInlineResult,
    InlineQuery,
    InlineQueryResultArticle,
    InputMediaAnimation,
    InputMediaPhoto,
    InputMediaVideo,
    InputTextMessageContent,
)

from app.bot.ui import DISABLED_LINK_PREVIEW
from app.formatters.telegram import CAPTION_LIMIT, MESSAGE_LIMIT
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
        url_escaped = escape(parsed.normalized_url, quote=True)
        link = f'<a href="{url_escaped}">Открыть оригинальный пост</a>'
        error = (
            "⚠️ Не удалось получить пост."
            " Возможно, он удален, приватный или временно недоступен."
            f"\n\n{link}"
        )
        await _safe_edit(bot, result.inline_message_id, error)
        return

    original_url = share.tweet.url if share.tweet is not None else parsed.normalized_url
    if share.post.media:
        await _safe_edit_media(
            bot,
            result.inline_message_id,
            share.post.media[0],
            caption=_inline_caption(share.post.caption_html, len(share.post.media), original_url),
        )
        return

    await _safe_edit(
        bot,
        result.inline_message_id,
        _text_with_original_link(share.post.html, original_url),
    )


async def _safe_edit(
    bot: Bot,
    inline_message_id: str,
    text: str,
) -> None:
    try:
        await bot.edit_message_text(
            inline_message_id=inline_message_id,
            text=text,
            parse_mode=ParseMode.HTML,
            link_preview_options=DISABLED_LINK_PREVIEW,
        )
    except TelegramBadRequest:
        logger.exception("failed to edit inline message")


async def _safe_edit_media(
    bot: Bot,
    inline_message_id: str,
    item: TweetMedia,
    *,
    caption: str,
) -> None:
    try:
        await bot.edit_message_media(
            inline_message_id=inline_message_id,
            media=_input_media(item, caption),
        )
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
                        show_caption_above_media=True,
                    ),
                )
                return
            except TelegramBadRequest:
                logger.exception("failed to edit inline media preview")
        await _safe_edit(bot, inline_message_id, caption)


def _input_media(item: TweetMedia, caption: str):
    if item.type == "photo":
        return InputMediaPhoto(
            media=item.url,
            caption=caption,
            parse_mode=ParseMode.HTML,
            show_caption_above_media=True,
        )
    if item.type == "video":
        return InputMediaVideo(
            media=item.url,
            caption=caption,
            parse_mode=ParseMode.HTML,
            show_caption_above_media=True,
            width=item.width,
            height=item.height,
            duration=_duration_seconds(item.duration_ms),
        )
    return InputMediaAnimation(
        media=item.url,
        caption=caption,
        parse_mode=ParseMode.HTML,
        show_caption_above_media=True,
        width=item.width,
        height=item.height,
        duration=_duration_seconds(item.duration_ms),
    )


def _duration_seconds(duration_ms: int | None) -> int | None:
    if duration_ms is None:
        return None
    return max(1, round(duration_ms / 1000))


def _inline_caption(caption: str, media_count: int, original_url: str) -> str:
    link = f'\n\n<a href="{escape(original_url, quote=True)}">Оригинальный пост</a>'
    note = f"\n\n📎 Еще медиа в посте: {media_count - 1}." if media_count > 1 else ""
    suffix = note + link
    if len(caption) + len(suffix) <= CAPTION_LIMIT:
        return caption + suffix
    if len(caption) + len(link) <= CAPTION_LIMIT:
        return caption + link
    return caption


def _text_with_original_link(text: str, original_url: str) -> str:
    link = f'\n\n<a href="{escape(original_url, quote=True)}">Оригинальный пост</a>'
    if len(text) + len(link) <= MESSAGE_LIMIT:
        return text + link
    return text
