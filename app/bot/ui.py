from html import escape

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, LinkPreviewOptions

ORIGINAL_POST_LABEL = "🔗 Оригинальный пост"
DISABLED_LINK_PREVIEW = LinkPreviewOptions(is_disabled=True)


def original_post_button(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=ORIGINAL_POST_LABEL, url=url)]],
    )


def original_post_link_html(url: str) -> str:
    return f'<a href="{escape(url, quote=True)}">{ORIGINAL_POST_LABEL}</a>'


def append_original_link(content: str, url: str, *, limit: int) -> str:
    link = "\n\n" + original_post_link_html(url)
    if len(content) + len(link) <= limit:
        return content + link
    available = limit - len(link)
    if available <= 0:
        return content[:limit]
    return content[:available] + link
