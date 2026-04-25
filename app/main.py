import asyncio
import logging

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from app.bot.dispatcher import build_dispatcher
from app.config import get_settings
from app.db.session import create_engine, create_session_factory
from app.logging_config import configure_logging
from app.providers import create_tweet_provider

logger = logging.getLogger(__name__)


async def run_bot() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)

    engine = create_engine(settings.database_url)
    session_factory = create_session_factory(engine)
    provider = create_tweet_provider(settings)
    bot = Bot(
        token=settings.bot_token.get_secret_value(),
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = build_dispatcher(settings, session_factory, provider)

    try:
        if not settings.polling_enabled:
            msg = "Webhook mode is not implemented in MVP. Set POLLING_ENABLED=true."
            raise RuntimeError(msg)

        logger.info("starting bot in polling mode")
        await bot.delete_webhook(drop_pending_updates=True)
        await dispatcher.start_polling(bot)
    finally:
        await provider.close()
        await bot.session.close()
        await engine.dispose()


def cli() -> None:
    asyncio.run(run_bot())


if __name__ == "__main__":
    cli()
