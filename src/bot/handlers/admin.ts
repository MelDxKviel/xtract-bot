import { Composer, InlineKeyboard } from "grammy";

import type { AppContext } from "@/bot/context";

const PANEL_TOGGLE_TRANSLATE = "panel:translate:toggle";

export const adminComposer = new Composer<AppContext>();

const privateChat = adminComposer.filter((ctx) => ctx.chat?.type === "private");

privateChat.command("allow", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const targetId = parseTelegramId(ctx.match);
  if (targetId === null) {
    await ctx.reply("ℹ️ Использование: /allow <telegram_id>");
    return;
  }
  await ctx.services.access.allowUser(targetId);
  await ctx.repositories.adminActions.create({
    adminTelegramId: ctx.from!.id,
    action: "allow",
    targetTelegramId: targetId,
  });
  await ctx.reply(`✅ Пользователь ${targetId} добавлен в whitelist.`);
});

privateChat.command("deny", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const targetId = parseTelegramId(ctx.match);
  if (targetId === null) {
    await ctx.reply("ℹ️ Использование: /deny <telegram_id>");
    return;
  }
  await ctx.services.access.denyUser(targetId);
  await ctx.repositories.adminActions.create({
    adminTelegramId: ctx.from!.id,
    action: "deny",
    targetTelegramId: targetId,
  });
  await ctx.reply(`🚫 Пользователь ${targetId} удален из whitelist.`);
});

privateChat.command("users", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const allowed = await ctx.services.access.listAllowedUsers({ limit: 100 });
  if (allowed.length === 0) {
    await ctx.reply("📭 Whitelist пуст.");
    return;
  }
  const lines = ["👥 Разрешенные пользователи:"];
  for (const user of allowed) {
    const username = user.username ? ` @${user.username}` : "";
    lines.push(`• ${user.telegramId}${username}`);
  }
  await ctx.reply(lines.join("\n"));
});

privateChat.command("stats", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const targetId = ctx.match ? parseTelegramId(ctx.match) : null;
  const summary = await ctx.services.stats.renderSummary({ telegramUserId: targetId });
  await ctx.reply(summary);
});

privateChat.command("whitelist", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const arg = ctx.match?.trim().toLowerCase();
  if (arg === "on") {
    ctx.runtimeConfig.whitelistEnabled = true;
    await ctx.reply("✅ Whitelist включён.");
  } else if (arg === "off") {
    ctx.runtimeConfig.whitelistEnabled = false;
    await ctx.reply("🔓 Whitelist выключен — доступ открыт для всех.");
  } else {
    const status = ctx.runtimeConfig.whitelistEnabled ? "✅ включён" : "🔓 выключен";
    await ctx.reply(
      `📋 Whitelist: ${status}\n\n` +
        "Управление:\n" +
        "/whitelist on — включить\n" +
        "/whitelist off — выключить",
    );
  }
});

privateChat.command("translate", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const arg = ctx.match?.trim().toLowerCase();
  if (arg === "on") {
    ctx.runtimeConfig.russianTranslationEnabled = true;
    await ctx.reply("✅ Перевод на русский (beta) включён.");
  } else if (arg === "off") {
    ctx.runtimeConfig.russianTranslationEnabled = false;
    await ctx.reply("🔕 Перевод на русский (beta) выключен.");
  } else {
    const status = ctx.runtimeConfig.russianTranslationEnabled ? "✅ включён" : "🔕 выключен";
    await ctx.reply(
      `🇷🇺 Перевод на русский (beta): ${status}\n\n` +
        "Управление:\n" +
        "/translate on — включить\n" +
        "/translate off — выключить",
    );
  }
});

privateChat.command("panel", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  await ctx.reply(await renderPanelText(ctx), {
    parse_mode: "HTML",
    reply_markup: renderPanelKeyboard(ctx),
  });
});

privateChat.callbackQuery(PANEL_TOGGLE_TRANSLATE, async (ctx) => {
  if (!ctx.from || !ctx.services.access.isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({
      text: "🔒 Только для администраторов",
      show_alert: true,
    });
    return;
  }
  ctx.runtimeConfig.russianTranslationEnabled = !ctx.runtimeConfig.russianTranslationEnabled;
  try {
    await ctx.editMessageText(await renderPanelText(ctx), {
      parse_mode: "HTML",
      reply_markup: renderPanelKeyboard(ctx),
    });
  } catch {
    // ignore "message is not modified" or other edit errors
  }
  await ctx.answerCallbackQuery({
    text: ctx.runtimeConfig.russianTranslationEnabled
      ? "✅ Перевод на русский включён"
      : "🔕 Перевод на русский выключен",
  });
});

privateChat.command("clearcache", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;
  const arg = ctx.match?.trim().toLowerCase();
  const expiredOnly = arg === "expired";
  const [tweets, profiles] = expiredOnly
    ? await Promise.all([
        ctx.repositories.tweetCache.clearExpired(),
        ctx.repositories.profileCache.clearExpired(),
      ])
    : await Promise.all([
        ctx.repositories.tweetCache.clearAll(),
        ctx.repositories.profileCache.clearAll(),
      ]);
  const removed = tweets + profiles;
  await ctx.repositories.adminActions.create({
    adminTelegramId: ctx.from!.id,
    action: expiredOnly ? "clearcache_expired" : "clearcache",
  });
  await ctx.reply(
    expiredOnly
      ? `🧹 Удалено просроченных записей кэша: ${removed}.`
      : `🗑 Кэш очищен. Удалено записей: ${removed}.`,
  );
});

privateChat.command("health", async (ctx) => {
  if (!(await requireAdmin(ctx))) return;

  let dbOk = false;
  let providerOk = false;
  try {
    // Reach into the db handle via the repositories — issue a trivial query
    // through the transaction-bound tx by calling a no-op via repositories.
    // We use the share events repo summary as a cheap round-trip.
    await ctx.repositories.shareEvents.summary({ telegramUserId: -1 });
    dbOk = true;
  } catch {
    dbOk = false;
  }

  try {
    providerOk = await ctx.provider.health();
  } catch {
    providerOk = false;
  }

  await ctx.reply(
    "🏥 Health\n" +
      `🗄 DB: ${dbOk ? "✅ ok" : "❌ error"}\n` +
      `🔌 Provider: ${providerOk ? "✅ ok" : "❌ error"}`,
  );
});

async function renderPanelText(ctx: AppContext): Promise<string> {
  const [summary, allowedCount, cacheCount, profileCacheCount] = await Promise.all([
    ctx.services.stats.getSummary(),
    ctx.services.access.countAllowedUsers(),
    ctx.repositories.tweetCache.count(),
    ctx.repositories.profileCache.count(),
  ]);
  const whitelistStatus = ctx.runtimeConfig.whitelistEnabled ? "✅ включён" : "🔓 выключен";
  const translateStatus = ctx.runtimeConfig.russianTranslationEnabled
    ? "✅ включён"
    : "🔕 выключен";
  const cleanupStatus = ctx.settings.cacheCleanupEnabled
    ? `✅ каждые ${ctx.settings.cacheCleanupIntervalSeconds}с`
    : "🔕 выключена";
  return (
    "🛠 Панель управления\n\n" +
    `📋 Whitelist: ${whitelistStatus}\n` +
    `🇷🇺 Перевод на русский (beta): ${translateStatus}\n` +
    `👥 В whitelist: ${allowedCount}\n` +
    `🗂 В кэше постов: ${cacheCount}\n` +
    `🗂 В кэше профилей: ${profileCacheCount}\n` +
    `🧹 Автоочистка кэша: ${cleanupStatus}\n\n` +
    "📊 Статистика\n" +
    `🔢 Всего: ${summary.total}\n` +
    `✅ Успешно: ${summary.success}\n` +
    `❌ Ошибки: ${summary.errors}\n` +
    `💬 Личный чат: ${summary.private}\n` +
    `🔍 Inline: ${summary.inline}\n` +
    `👤 Пользователей: ${summary.users}`
  );
}

function renderPanelKeyboard(ctx: AppContext): InlineKeyboard {
  const label = ctx.runtimeConfig.russianTranslationEnabled
    ? "🔕 Выключить перевод на русский (beta)"
    : "🇷🇺 Включить перевод на русский (beta)";
  return new InlineKeyboard().text(label, PANEL_TOGGLE_TRANSLATE);
}

async function requireAdmin(ctx: AppContext): Promise<boolean> {
  if (!ctx.from) return false;
  if (ctx.services.access.isAdmin(ctx.from.id)) return true;
  await ctx.reply("🔒 Команда доступна только администратору.");
  return false;
}

function parseTelegramId(value: string | undefined | null): number | null {
  if (!value) return null;
  const item = value.trim().split(/\s+/)[0];
  if (!item) return null;
  if (!/^-?\d+$/.test(item)) return null;
  return Number(item);
}
