import type { MiddlewareFn } from "grammy";

import type { AppContext } from "@/bot/context";
import { answerShareRetry } from "@/bot/shareRetry";

const PUBLIC_COMMANDS = new Set(["/start", "/help", "/id"]);

export const accessMiddleware: MiddlewareFn<AppContext> = async (ctx, next) => {
  const user = ctx.from;
  if (!user) return;

  await ctx.services.access.registerUser({
    id: user.id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
  });

  if (isPublicCommand(ctx) || (await ctx.services.access.hasAccess(user.id))) {
    return next();
  }

  if (ctx.chat?.type === "private" && ctx.callbackQuery?.data?.startsWith("retry:")) {
    await answerShareRetry(
      ctx,
      `Доступ закрыт. Отправьте администратору ваш Telegram ID: ${user.id}`,
      true,
    );
  } else if (ctx.message) {
    await ctx.reply(
      `Доступ закрыт. Отправьте администратору ваш Telegram ID: <code>${user.id}</code>`,
      { parse_mode: "HTML" },
    );
  } else if (ctx.inlineQuery) {
    await ctx.answerInlineQuery(
      [
        {
          type: "article",
          id: "access-denied",
          title: "Доступ закрыт",
          description: "Попросите администратора добавить ваш Telegram ID",
          input_message_content: {
            message_text: `Доступ закрыт. Telegram ID: ${user.id}`,
          },
        },
      ],
      { cache_time: 1, is_personal: true },
    );
  }
};

function isPublicCommand(ctx: AppContext): boolean {
  const text = ctx.message?.text;
  if (!text) return false;
  const head = text.split(/\s+/)[0]!.split("@")[0]!.toLowerCase();
  return PUBLIC_COMMANDS.has(head);
}
