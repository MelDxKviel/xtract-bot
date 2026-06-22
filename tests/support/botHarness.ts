import { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";

import type { AppContext } from "@/bot/context";

export interface RecordedCall {
  method: string;
  payload: Record<string, unknown>;
}

export interface HarnessOptions {
  register: (bot: Bot<AppContext>) => void;
  inject?: (ctx: AppContext) => void;
  /** Telegram methods that should reject with a GrammyError (to test fallbacks). */
  failMethods?: string[];
}

export interface Harness {
  calls: RecordedCall[];
  handle: (update: Record<string, unknown>) => Promise<void>;
  callsTo: (method: string) => RecordedCall[];
  lastCall: (method: string) => RecordedCall | undefined;
}

const BOT_INFO = {
  id: 42,
  is_bot: true,
  first_name: "Test Bot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: true,
} as unknown as UserFromGetMe;

/**
 * Spin up a real grammY bot whose API calls are intercepted by a transformer:
 * every call is recorded (and optionally forced to fail) instead of hitting
 * Telegram. This drives the actual handler/composer plumbing — command parsing,
 * filters, context shortcuts — without any network.
 */
export function createHarness(options: HarnessOptions): Harness {
  const calls: RecordedCall[] = [];
  const fail = new Set(options.failMethods ?? []);
  const bot = new Bot<AppContext>("12345:TEST", { botInfo: BOT_INFO });

  const transformer = (async (_prev, method, payload) => {
    calls.push({ method, payload: (payload ?? {}) as Record<string, unknown> });
    if (fail.has(method)) {
      return { ok: false, error_code: 400, description: `forced failure: ${method}` };
    }
    return { ok: true, result: resultFor(method) };
  }) as Parameters<typeof bot.api.config.use>[0];
  bot.api.config.use(transformer);

  const inject = options.inject;
  if (inject) {
    bot.use(async (ctx, next) => {
      inject(ctx);
      await next();
    });
  }
  options.register(bot);

  return {
    calls,
    handle: (update) => bot.handleUpdate(update as never),
    callsTo: (method) => calls.filter((call) => call.method === method),
    lastCall: (method) => [...calls].reverse().find((call) => call.method === method),
  };
}

function resultFor(method: string): unknown {
  if (
    method.startsWith("edit") ||
    method === "answerInlineQuery" ||
    method === "answerCallbackQuery" ||
    method === "sendRichMessageDraft"
  ) {
    return true;
  }
  // A minimal Message-like object for send* methods; handlers never read it.
  return { message_id: 1, date: 0, chat: { id: 0, type: "private" } };
}
