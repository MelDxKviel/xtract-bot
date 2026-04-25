from __future__ import annotations

import logging
from html import escape

from aiogram import Bot, Router
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramBadRequest
from aiogram.types import (
    ChosenInlineResult,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InlineQuery,
    InlineQueryResultArticle,
    InputTextMessageContent,
)

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
                    title="Нужна ссылка на пост X/Twitter",
                    description="Например: https://x.com/user/status/123",
                    input_message_content=InputTextMessageContent(
                        message_text="Пришлите ссылку на пост X/Twitter."
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
                title="Поделиться постом",
                description=parsed.normalized_url,
                input_message_content=InputTextMessageContent(
                    message_text="Загрузка поста...",
                    parse_mode=ParseMode.HTML,
                ),
                reply_markup=_original_button(parsed.normalized_url),
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
            "Не удалось распознать ссылку на пост X/Twitter.",
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
            "Не удалось получить пост. Возможно, он удален, приватный или временно недоступен.",
            reply_markup=_original_button(parsed.normalized_url),
        )
        return

    text = share.post.html
    if share.post.media:
        text += f"\n\nМедиа: {escape(share.post.media[0].url)}"
    await _safe_edit(
        bot,
        result.inline_message_id,
        text,
        reply_markup=_original_button(parsed.normalized_url),
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
            reply_markup=reply_markup,
        )
    except TelegramBadRequest:
        logger.exception("failed to edit inline message")


def _original_button(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="Оригинал", url=url)]],
    )
