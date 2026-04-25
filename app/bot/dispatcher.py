from aiogram import Dispatcher

from app.bot.handlers import admin, inline, private
from app.bot.middlewares.access import AccessMiddleware, DatabaseSessionMiddleware
from app.config import Settings
from app.providers.base import TweetProvider


def build_dispatcher(settings: Settings, session_factory, provider: TweetProvider) -> Dispatcher:
    dispatcher = Dispatcher()
    database_middleware = DatabaseSessionMiddleware(
        session_factory=session_factory,
        settings=settings,
        provider=provider,
    )
    access_middleware = AccessMiddleware()

    for observer in (
        dispatcher.message,
        dispatcher.inline_query,
        dispatcher.chosen_inline_result,
    ):
        observer.middleware(database_middleware)
        observer.middleware(access_middleware)

    dispatcher.include_router(admin.router)
    dispatcher.include_router(private.router)
    dispatcher.include_router(inline.router)
    return dispatcher
