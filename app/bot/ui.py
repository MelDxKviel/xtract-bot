from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, LinkPreviewOptions

ORIGINAL_POST_LABEL = "🔗 Оригинальный пост"
DISABLED_LINK_PREVIEW = LinkPreviewOptions(is_disabled=True)


def original_post_button(url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=ORIGINAL_POST_LABEL, url=url)]],
    )
